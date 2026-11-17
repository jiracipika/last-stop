// Server-authoritative world: players, items, doors, van, mission state.
// The GameRoom drives this at a fixed 30 Hz; everything gameplay-relevant is
// decided here and mirrored into the Colyseus schema.

import { randomInt } from "node:crypto";
import {
  AABB, Body, MoveInput, stepPlayer, stepFreeItem, stepVan, carrySpeedFactor, vanLocalToWorld, vanWorldToLocal,
  stepVehicle, VAN_CFG, CART_CFG, CART, CART_START, SEAT, SLOTS, SHOP,
  PLAYER, CARRY, NOISE, VAN, MISSION, FRAGILE_IMPACT_V, FRAGILE_DPS, WRECKED_AT, WRECKED_VALUE_FACTOR,
  ITEM_DEFS, planSpawns, planValue, quotaFor, missionSeconds, pickModifiers, stowable,
  STATIC_COLLIDERS, LOS_BLOCKERS, DOORS, DoorDef, doorAabb, PLAYER_SPAWNS, VAN_START, FINISH_X, GATE, COURSE,
  HIDE_SPOTS, HIDE,
  mulberry32, clamp, dist2d, hasLineOfSight,
  PlayerState, ItemState, EnemyState, VanState, CartState, CourseState, MarkerState, DoorState, RoomState,
  ArraySchema, computeAwards, type ItemDef, type MissionAwardRow,
} from "@last-stop/shared";
import { CaretakerAI } from "./enemy.js";

export interface GameEvent {
  t: string;
  [k: string]: unknown;
}

export interface RPlayer {
  sid: string;
  nick: string;
  color: number;
  ready: boolean;
  host: boolean;
  connected: boolean;
  body: Body;
  yaw: number;
  pitch: number;
  input: MoveInput & { interact: boolean };
  lastSeq: number;
  stamina: number;
  sprinting: boolean;
  flashlight: boolean;
  hp: number;
  downed: boolean;
  dead: boolean;
  bleedAt: number;
  carrying: string;
  /** body inventory: item ids ("", "" … = empty); length SLOTS.COUNT */
  slots: string[];
  slotSel: number;
  /** gas-station money (lobby shop); purchases below */
  budget: number;
  hasFlashlight: boolean;
  caffeinated: boolean;
  seat: number;
  hidden: boolean;
  hideSpot: string;
  /** sid of the dead teammate whose body this player is hauling ("" = none) */
  carryBody: string;
  /** this (dead) player's body has been loaded into the van */
  bodyVan: boolean;
  hat: number;
  stabilize: boolean;
  interactKind: "" | "revive" | "install";
  interactTarget: string;
  interactT: number;
  stepAcc: number;
  noiseScore: number;
  deliveredValue: number;
  deliveredCount: number;
  rescues: number;
  biggestLoss: number;
  lossItem: string;
  downedCount: number;
  grabCd: number;
  spawn: number;
  /** server time until which a disconnected player's seat is held */
  graceUntil: number;
}

export interface RItem {
  id: string;
  defId: string;
  body: Body;
  // 0 world, 1 carried (hands), 2 stored in van, 3 consumed, 4 stowed on a body
  state: 0 | 1 | 2 | 3 | 4;
  value: number;
  damage: number;
  h0: string;
  h1: string;
  lastH0: string;
  lastH1: string;
  yaw: number;
  secured: boolean;
  sleeping: boolean;
  restTimer: number;
  ringCd: number;
}

export interface RDoor {
  def: DoorDef;
  open: boolean;
}

export type Phase = "lobby" | "briefing" | "arrive" | "scavenge" | "escape" | "results";

export class World {
  state: RoomState;
  phase: Phase = "lobby";
  t = 0;
  seed = 0;
  endsAt = 0;
  escalation = 1;
  quota = 0;
  lootTotal = 0;
  salvage = 0;
  cargoDamage = 0;
  modifiers: string[] = [];
  soloMode = false;
  gateOpen = false;

  players = new Map<string, RPlayer>();
  items = new Map<string, RItem>();
  doors = new Map<string, RDoor>();
  van: { x: number; z: number; yaw: number; speed: number } = { ...VAN_START, speed: 0 };
  vanDoorsOpen = false;
  vanLightsOn = false;
  vanStrapped = false;
  partInstalled = false;
  vanDriver = "";
  vanCargo: string[] = [];
  headlightsPulseT = 0;
  // the crew's golf cart (lot shuttle — no repair needed, two seats)
  cart: { x: number; z: number; yaw: number; speed: number } = { ...CART_START, speed: 0 };
  cartDriver = "";
  cartNoiseT = 0;
  extractWarnUntil = 0;
  extractConfirmed = false;
  // success end-beat: the van pulls away before results (finish/stepPull)
  pulling = false;
  pullElapsed = 0;
  pullT = 0;
  // ---- drive-in course ----
  /** Production rooms run the drive-in (GameRoom flips this on); the test
   *  server defaults it off so existing suites opt in per-room. */
  arriveEnabled = false;
  /** gates threaded so far (0..3; 3 = course complete, park reached) */
  courseStage = 0;
  /** seconds since the last gate was threaded -> stall failsafe */
  courseStall = 0;
  /** stall/dc failsafe: the server steers the van in itself */
  courseAuto = false;
  /** designated EXIT driver — the wheel-holder when the course completes;
   *  the van may not leave without them (or their recovered body) aboard */
  exitDriver = "";

  enemy: CaretakerAI;
  events: GameEvent[] = [];
  briefUntil = 0;
  nextItemId = 0;
  rng: () => number = mulberry32(1);
  /** test-only overrides (set by GameRoom under LS_TEST_MODE=1) */
  testQuota = -1;
  /** When set, startMission uses these modifiers instead of a random pick
   *  (tests pin specific modifier behaviors deterministically). */
  modifiersOverride: string[] | null = null;
  testSeconds = 0;
  testEnemyAt: { x: number; z: number } | null = null;
  testFreezeEnemyAfterDown = false;
  /** test knob: startMission jumps straight to the escape phase */
  testAtEscape = false;
  /** test knob: also drop a toolbox on the asphalt beside spawn (e2e stow probe) */
  testItemAt = false;

  constructor() {
    this.state = new RoomState();
    this.state.markers = new ArraySchema<MarkerState>() as never;
    this.state.modifiers = new ArraySchema<string>() as never;
    this.state.van = new VanState();
    this.state.van.cargo = new ArraySchema<string>() as never;
    this.state.cart = new CartState();
    this.state.course = new CourseState();
    this.state.enemy = new EnemyState();
    this.enemy = new CaretakerAI(this);
    for (const d of DOORS) {
      this.doors.set(d.id, { def: d, open: d.startOpen });
      const ds = new DoorState();
      ds.id = d.id;
      ds.open = d.startOpen;
      this.state.doors.set(d.id, ds);
    }
    this.resetVan();
  }

  // ---------------------------------------------------------------- helpers
  emit(e: GameEvent): void {
    this.events.push(e);
  }

  say(msg: string, by = ""): void {
    this.emit({ t: "toast", msg, by });
  }

  /** Axis-aligned approximation of the van's oriented body. */
  vanAabb(): AABB {
    const c = Math.abs(Math.cos(this.van.yaw));
    const s = Math.abs(Math.sin(this.van.yaw));
    const hx = c * VAN.HALF_W + s * VAN.HALF_L;
    const hz = s * VAN.HALF_W + c * VAN.HALF_L;
    return { x0: this.van.x - hx, x1: this.van.x + hx, z0: this.van.z - hz, z1: this.van.z + hz };
  }

  /** Axis-aligned approximation of the cart's oriented body. */
  cartAabb(): AABB {
    const c = Math.abs(Math.cos(this.cart.yaw));
    const s = Math.abs(Math.sin(this.cart.yaw));
    const hx = c * CART.HALF_W + s * CART.HALF_L;
    const hz = s * CART.HALF_W + c * CART.HALF_L;
    return { x0: this.cart.x - hx, x1: this.cart.x + hx, z0: this.cart.z - hz, z1: this.cart.z + hz };
  }

  playerColliders(): AABB[] {
    const closed: AABB[] = [];
    for (const d of this.doors.values()) if (!d.open) closed.push(doorAabb(d.def));
    return STATIC_COLLIDERS.concat(closed, [this.vanAabb(), this.cartAabb()]);
  }

  hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    const closed: AABB[] = [];
    for (const d of this.doors.values()) if (!d.open) closed.push(doorAabb(d.def));
    return hasLineOfSight(x0, z0, x1, z1, LOS_BLOCKERS.concat(closed, [this.vanAabb()]));
  }

  /** LOS ignoring the van — used for grab reachability at the loading zone. */
  losWallsOnly(x0: number, z0: number, x1: number, z1: number): boolean {
    const closed: AABB[] = [];
    for (const d of this.doors.values()) if (!d.open) closed.push(doorAabb(d.def));
    return hasLineOfSight(x0, z0, x1, z1, LOS_BLOCKERS.concat(closed));
  }

  gateCollider(): AABB | null {
    // the drive-in pulls through the gate before the shift locks it behind
    // the crew — it swings open for the arrival and again once quota is met
    if (this.gateOpen || this.phase === "results" || this.phase === "arrive") return null;
    return { x0: GATE.x - 0.2, x1: GATE.x + 0.2, z0: GATE.z0, z1: GATE.z1 };
  }

  vanColliders(): AABB[] {
    const g = this.gateCollider();
    const base = g ? STATIC_COLLIDERS.concat([g]) : STATIC_COLLIDERS;
    // the parked cart is a bump hazard for the van too
    return base.concat([this.cartAabb()]);
  }

  /** Colliders the cart drives against: the static lot + gate + the van hull. */
  cartColliders(): AABB[] {
    const g = this.gateCollider();
    const base = g ? STATIC_COLLIDERS.concat([g]) : STATIC_COLLIDERS;
    return base.concat([this.vanAabb()]);
  }

  itemDef(it: RItem): ItemDef {
    return ITEM_DEFS[it.defId]!;
  }

  livingPlayers(): RPlayer[] {
    return [...this.players.values()].filter((p) => p.connected && !p.dead && !p.downed);
  }

  // ---------------------------------------------------------------- lobby
  addPlayer(sid: string, nick: string, color: number, host: boolean, hat = 0, atVan = false): RPlayer {
    const used = new Set([...this.players.values()].map((p) => p.color));
    if (used.has(color)) {
      for (let i = 0; i < 8; i++) {
        if (!used.has(i)) {
          color = i;
          break;
        }
      }
    }
    const p: RPlayer = {
      sid, nick, color, hat, ready: false, host, connected: true,
      body: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true },
      yaw: Math.PI, pitch: 0,
      input: { mx: 0, mz: 0, yaw: Math.PI, sprint: false, jump: false, interact: false },
      lastSeq: 0, stamina: PLAYER.STAMINA_MAX, sprinting: false, flashlight: false,
      hp: 100, downed: false, dead: false, bleedAt: 0,
      carrying: "", slots: ["", "", ""], slotSel: 0,
      budget: SHOP.BUDGET, hasFlashlight: false, caffeinated: false,
      seat: 0, hidden: false, hideSpot: "", carryBody: "", bodyVan: false, stabilize: false,
      interactKind: "", interactTarget: "", interactT: 0,
      stepAcc: 0, noiseScore: 0, deliveredValue: 0, deliveredCount: 0,
      rescues: 0, biggestLoss: 0, lossItem: "", downedCount: 0, grabCd: 0, spawn: 0,
      graceUntil: 0,
    };
    this.players.set(sid, p);
    if (atVan) this.placeAtVan(p);
    else this.placeAtSpawn(p);
    this.syncPlayerSchema(p, true);
    return p;
  }

  removePlayer(sid: string): void {
    this.releaseCarries(sid, "leave");
    const p = this.players.get(sid);
    if (p) {
      // their hauled body stays where they stood; and if THEY were the body
      // being hauled, the carrier's hands come free
      if (p.carryBody) this.dropBody(p);
      const carrier = this.bodyCarrier(sid);
      if (carrier) {
        const c = this.players.get(carrier);
        if (c) c.carryBody = "";
      }
      this.dropSlots(p, "leave");
      if (p.seat > 0) {
        if (p.seat === 1) this.vanDriver = "";
        if (p.seat === SEAT.CART_DRIVER) this.cartDriver = "";
        p.seat = 0;
      }
    }
    this.players.delete(sid);
    this.state.players.delete(sid);
    if (p?.host) {
      const next = [...this.players.values()][0];
      if (next) {
        next.host = true;
        const ns = this.state.players.get(next.sid);
        if (ns) ns.host = true;
        this.say(`${next.nick} is running the crew now`);
      }
    }
  }

  placeAtSpawn(p: RPlayer): void {
    const s = PLAYER_SPAWNS[p.spawn % PLAYER_SPAWNS.length]!;
    p.body.x = s.x;
    p.body.z = s.z;
    p.body.y = 0;
    p.body.vx = 0;
    p.body.vz = 0;
    p.body.vy = 0;
    p.yaw = s.yaw;
    p.input.yaw = s.yaw;
    p.hidden = false;
    p.hideSpot = "";
  }

  /** Late join: place at the van so a mid-shift arrival starts at the ride. */
  placeAtVan(p: RPlayer): void {
    const s = this.vanPoint({ x: 0, z: MISSION.LATE_SPAWN_LOCAL_Z });
    p.body.x = s.x;
    p.body.z = s.z;
    p.body.y = 0;
    p.body.vx = 0;
    p.body.vz = 0;
    p.body.vy = 0;
    p.yaw = this.van.yaw;
    p.input.yaw = this.van.yaw;
    p.hidden = false;
    p.hideSpot = "";
  }

  // ---------------------------------------------------------------- mission
  startMission(): void {
    const count = Math.max(1, this.players.size);
    this.soloMode = count === 1;
    this.seed = randomInt(0, 0xffffffff);
    const rng = mulberry32(this.seed);
    this.rng = rng;
    this.modifiers = this.modifiersOverride ?? pickModifiers(rng);
    const plan = planSpawns(rng, count);

    let i = 0;
    for (const p of this.players.values()) {
      p.spawn = i++;
      p.hp = 100;
      p.downed = false;
      p.dead = false;
      p.bleedAt = 0;
      p.carrying = "";
      p.carryBody = "";
      p.bodyVan = false;
      // gas-station purchases (budget/hasFlashlight/caffeinated) carry INTO the
      // shift; finalize() restocks the budget and clears them for the next stop
      p.slots = ["", "", ""];
      p.slotSel = 0;
      p.seat = 0;
      p.stamina = PLAYER.STAMINA_MAX;
      p.noiseScore = 0;
      p.deliveredValue = 0;
      p.deliveredCount = 0;
      p.rescues = 0;
      p.biggestLoss = 0;
      p.lossItem = "";
      p.downedCount = 0;
      p.interactKind = "";
      p.interactT = 0;
      p.flashlight = false;
      this.placeAtSpawn(p);
    }

    this.items.clear();
    this.state.items.clear();
    const all = [...plan.items, plan.part];
    if (this.testItemAt) {
      // deterministic probe item on the open asphalt by the van's rear-right
      all.push({ defId: "toolbox", x: 4.2, z: 16.6, yaw: 0 });
    }
    for (const planned of all) {
      const id = `i${this.nextItemId++}`;
      const def = ITEM_DEFS[planned.defId]!;
      const it: RItem = {
        id, defId: planned.defId,
        body: { x: planned.x, y: def.restY, z: planned.z, vx: 0, vy: 0, vz: 0, grounded: true },
        state: 0, value: def.value, damage: 0,
        h0: "", h1: "", lastH0: "", lastH1: "",
        yaw: planned.yaw, secured: false, sleeping: true, restTimer: 0, ringCd: 0,
      };
      this.items.set(id, it);
    }

    for (const d of this.doors.values()) {
      d.open = d.def.startOpen;
      const ds = this.state.doors.get(d.def.id);
      if (ds) ds.open = d.open;
    }

    this.resetVan();
    this.cart = { x: CART_START.x, z: CART_START.z, yaw: CART_START.yaw, speed: 0 };
    this.cartDriver = "";
    this.vanCargo = [];
    (this.state.van.cargo as unknown as string[]).length = 0;
    this.quota = this.testQuota >= 0 ? this.testQuota : quotaFor(planValue(plan.items), count, this.modifiers);
    this.lootTotal = planValue(plan.items);
    this.salvage = 0;
    this.cargoDamage = 0;
    this.escalation = 1;
    this.gateOpen = false;
    this.state.gateOpen = false;
    this.state.outcome = "";
    this.state.resultsJson = "";
    this.extractWarnUntil = 0;
    this.extractConfirmed = false;
    this.pulling = false;
    this.pullElapsed = 0;
    this.pullT = 0;

    // drive-in course state; the crew boards right away (below) so briefing
    // plays over the parked van on the old road
    this.courseStage = 0;
    this.courseStall = 0;
    this.courseAuto = false;
    this.exitDriver = "";

    this.phase = "briefing";
    this.briefUntil = this.t + 5;
    this.endsAt = this.t + 5 + (this.testSeconds > 0 ? this.testSeconds : missionSeconds(this.modifiers));

    if (this.arriveEnabled && !this.testAtEscape) {
      // the van waits on the old road west of the gate, doors shut; the crew
      // is already aboard — ONE RANDOM member takes the wheel and drives in
      this.van = { x: COURSE.START.x, z: COURSE.START.z, yaw: COURSE.START.yaw, speed: 0 };
      const crew = [...this.players.values()];
      for (let c = crew.length - 1; c > 0; c--) {
        const j = Math.floor(rng() * (c + 1));
        [crew[c], crew[j]] = [crew[j]!, crew[c]!];
      }
      crew.forEach((p, idx) => {
        p.seat = idx === 0 ? 1 : idx + 1;
        if (idx === 0) this.vanDriver = p.sid;
      });
      const driver = crew[0]!;
      this.exitDriver = driver.sid;
      this.say(`${driver.nick} has the wheel — drive us in through the gates`);
    }

    this.enemy.reset(rng);
    if (this.testEnemyAt) {
      this.enemy.x = this.testEnemyAt.x;
      this.enemy.z = this.testEnemyAt.z;
    }
    this.syncAll();
    const mods = this.state.modifiers as unknown as string[];
    mods.length = 0;
    for (const m of this.modifiers) mods.push(m);
    this.emit({ t: "phase", p: "briefing", seed: this.seed, quota: this.quota, lootTotal: this.lootTotal, modifiers: this.modifiers });
    if (this.testAtEscape) {
      // test knob: skip briefing/scavenge, land in escape with objectives done
      this.partInstalled = true;
      this.gateOpen = true;
      this.state.gateOpen = true;
      this.briefUntil = this.t;
      this.setPhase("escape");
      this.emit({ t: "gate" });
      this.say("Quota met, van running. GET OUT.");
      this.syncAll();
    }
  }

  resetVan(): void {
    this.van = { x: VAN_START.x, z: VAN_START.z, yaw: VAN_START.yaw, speed: 0 };
    this.vanDoorsOpen = false;
    this.vanLightsOn = false;
    this.vanStrapped = false;
    this.partInstalled = false;
    this.vanDriver = "";
    this.headlightsPulseT = 0;
  }

  // ---------------------------------------------------------------- input
  setMoveInput(p: RPlayer, input: Record<string, unknown>): void {
    const i = p.input;
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const mx = num(input.mx);
    const mz = num(input.mz);
    if (mx !== undefined) i.mx = clamp(mx, -1, 1);
    if (mz !== undefined) i.mz = clamp(mz, -1, 1);
    const yaw = num(input.yaw);
    if (yaw !== undefined) i.yaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const pitch = num(input.pitch);
    if (pitch !== undefined) p.pitch = clamp(pitch, -1.45, 1.45);
    if (input.sprint === true) i.sprint = true;
    else if (input.sprint === false) i.sprint = false;
    if (input.jump === true) i.jump = true;
    if (typeof input.interact === "boolean") i.interact = input.interact;
    if (typeof input.stabilize === "boolean") p.stabilize = input.stabilize;
    const seq = num(input.seq);
    if (seq !== undefined && seq > p.lastSeq) p.lastSeq = seq;
  }

  effectiveSpeed(p: RPlayer): number {
    if (p.downed || p.dead || p.seat > 0) return 0;
    const moving = Math.hypot(p.input.mx, p.input.mz) > 0.1;
    const wantSprint = p.input.sprint && moving && p.stamina > 0.5;
    let speed: number = wantSprint ? PLAYER.SPRINT : PLAYER.WALK;
    let sprintAllowed = true;
    if (p.carryBody) {
      // hauling a coworker reads as a fixed heavy load (mirrored EXACTLY in
      // predict.ts speedFor — one constant, both ends)
      speed *= carrySpeedFactor(CARRY.BODY_WEIGHT);
      sprintAllowed = false;
    } else if (p.carrying) {
      const it = this.items.get(p.carrying);
      if (it) {
        const def = this.itemDef(it);
        const carriers = (it.h0 ? 1 : 0) + (it.h1 ? 1 : 0) || 1;
        let w = def.weight;
        if (this.soloMode && def.twoHandle) w *= CARRY.SOLO_HEAVY_FACTOR;
        const per = w / carriers;
        speed *= carrySpeedFactor(per);
        if (per >= CARRY.SPRINT_MAX_WEIGHT) sprintAllowed = false;
      }
    }
    if (wantSprint && sprintAllowed) {
      p.sprinting = true;
    } else {
      p.sprinting = false;
      if (!wantSprint) speed = Math.min(speed, PLAYER.WALK * carrySpeedFactor(0));
    }
    if (p.hp < 30) speed *= 0.85;
    return speed;
  }

  // ---------------------------------------------------------------- carrying
  tryGrab(p: RPlayer, itemId: string): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || p.hidden || p.carrying || p.carryBody || p.grabCd > 0) return false;
    const it = this.items.get(itemId);
    if (!it) return false;
    const def = this.itemDef(it);
    // ALL rejection checks run BEFORE any handle mutation: a rejected grab
    // used to leave it.h0 set with state 0, permanently bricking the item
    // (the "if (it.h0) return false" guard then rejected everyone forever).
    const d = dist2d(p.body.x, p.body.z, it.body.x, it.body.z);
    if (d > PLAYER.GRAB_RANGE + def.radius) return false;
    // must not reach through walls (the van itself does NOT block grabs:
    // loading happens at its open rear)
    if (d > 0.8 && !this.losWallsOnly(p.body.x, p.body.z, it.body.x, it.body.z)) return false;
    if (it.defId === "distributor" && this.partInstalled) return false;
    if (def.twoHandle) {
      // second handle can be grabbed while the item is already carried
      if (it.state !== 0 && it.state !== 1) return false;
      if (!it.h0) it.h0 = p.sid;
      else if (!it.h1) it.h1 = p.sid;
      else return false;
    } else {
      if (it.state !== 0) return false;
      if (it.h0) return false;
      it.h0 = p.sid;
    }
    it.state = 1;
    it.sleeping = false;
    it.lastH0 = it.h0;
    if (it.h1) it.lastH1 = it.h1;
    p.carrying = itemId;
    this.emit({ t: "grab", item: itemId, by: p.sid, def: it.defId });
    return true;
  }

  /** Release everything a player holds (leave/slip/store). Drops items gently. */
  releaseCarries(sid: string, reason: "leave" | "drop" | "slip" | "store", onlyItem?: string): void {
    const owner = this.players.get(sid);
    for (const it of this.items.values()) {
      if (onlyItem && it.id !== onlyItem) continue;
      let held = false;
      if (it.h0 === sid) {
        it.h0 = "";
        held = true;
      }
      if (it.h1 === sid) {
        it.h1 = "";
        held = true;
      }
      if (held && it.state === 1 && !it.h0 && !it.h1) {
        it.state = 0;
        it.sleeping = false;
        if (reason !== "store") {
          if (owner) {
            const fwdX = Math.sin(owner.yaw);
            const fwdZ = Math.cos(owner.yaw);
            const soft = reason === "drop" ? 0.25 : 0.45;
            it.body.vx = fwdX * CARRY.THROW_V * soft;
            it.body.vz = fwdZ * CARRY.THROW_V * soft;
            it.body.vy = 0.9;
            this.noise(owner.body.x, owner.body.z, this.itemDef(it).twoHandle ? NOISE.DROP_HEAVY : NOISE.DROP_LIGHT, "drop", sid);
          }
        }
      }
    }
    if (owner && (!onlyItem || owner.carrying === onlyItem)) owner.carrying = "";
  }

  tryRelease(p: RPlayer, thrown: boolean): boolean {
    const it = this.items.get(p.carrying);
    if (!it) {
      p.carrying = "";
      return false;
    }
    if (it.h0 !== p.sid && it.h1 !== p.sid) {
      p.carrying = "";
      return false;
    }
    if (it.h0 === p.sid) it.h0 = "";
    if (it.h1 === p.sid) it.h1 = "";
    p.carrying = "";
    p.grabCd = 0.25;
    if (!it.h0 && !it.h1) {
      it.state = 0;
      it.sleeping = false;
      const fwdX = Math.sin(p.yaw);
      const fwdZ = Math.cos(p.yaw);
      if (thrown) {
        const v = CARRY.THROW_V * (p.sprinting ? 1.25 : 1);
        it.body.vx = fwdX * v;
        it.body.vz = fwdZ * v;
        it.body.vy = CARRY.THROW_UP;
      } else {
        it.body.vx = p.body.vx * 0.6;
        it.body.vz = p.body.vz * 0.6;
        it.body.vy = 0.4;
      }
      this.emit({ t: "drop", item: it.id, by: p.sid, def: it.defId, thrown, x: it.body.x, z: it.body.z, heavy: this.itemDef(it).twoHandle });
    }
    return true;
  }

  // ---------------------------------------------------------------- inventory
  /** Stow a small item into a body slot (E pickup). Same reachability rules
   *  as tryGrab: range + no reaching through walls. */
  tryStow(p: RPlayer, itemId: string): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || p.hidden || p.carryBody || p.grabCd > 0) return false;
    const it = this.items.get(itemId);
    if (!it || it.state !== 0) return false;
    const def = this.itemDef(it);
    if (!stowable(def)) return false;
    const d = dist2d(p.body.x, p.body.z, it.body.x, it.body.z);
    if (d > PLAYER.GRAB_RANGE + def.radius) return false;
    if (d > 0.8 && !this.losWallsOnly(p.body.x, p.body.z, it.body.x, it.body.z)) return false;
    // active slot first, then the first empty one
    let slot = p.slots[p.slotSel] === "" ? p.slotSel : p.slots.indexOf("");
    if (slot < 0) {
      this.emit({ t: "deny", sid: p.sid, k: "packFull" });
      return false;
    }
    p.slots[slot] = itemId;
    p.slotSel = slot;
    it.state = 4; // stowed on a body
    it.h0 = "";
    it.h1 = "";
    it.lastH0 = p.sid;
    it.lastH1 = "";
    this.emit({ t: "stow", item: itemId, by: p.sid, def: it.defId, slot });
    return true;
  }

  selectSlot(p: RPlayer, idx: number): boolean {
    if (idx < 0 || idx >= SLOTS.COUNT || idx === p.slotSel) return false;
    p.slotSel = idx;
    return true;
  }

  /** Gently set the active slot's item down in front of the player. */
  dropSlot(p: RPlayer): boolean {
    if (p.downed || p.dead || p.seat > 0) return false;
    const id = p.slots[p.slotSel];
    if (!id) return false;
    const it = this.items.get(id);
    if (!it) {
      p.slots[p.slotSel] = "";
      return false;
    }
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    it.state = 0;
    it.sleeping = false;
    it.body.x = p.body.x + fx * 0.7;
    it.body.z = p.body.z + fz * 0.7;
    it.body.y = Math.max(it.body.y, this.itemDef(it).restY + 0.2);
    it.body.vx = p.body.vx * 0.5;
    it.body.vz = p.body.vz * 0.5;
    it.body.vy = 0.4;
    p.slots[p.slotSel] = "";
    p.grabCd = 0.25;
    this.emit({ t: "unstow", item: id, by: p.sid, def: it.defId });
    return true;
  }

  /** Load the active slot's item into the van (open rear doors, at the back). */
  storeSlot(p: RPlayer): boolean {
    if (p.downed || p.dead || p.seat > 0) return false;
    if (!this.vanDoorsOpen) return false;
    const dp = this.vanPoint(VAN.DOOR_POINT);
    if (dist2d(p.body.x, p.body.z, dp.x, dp.z) > VAN.INTERACT_RANGE + 0.4) return false;
    const id = p.slots[p.slotSel];
    if (!id) return false;
    const it = this.items.get(id);
    if (!it) {
      p.slots[p.slotSel] = "";
      return false;
    }
    it.lastH0 = p.sid; // delivery credit for the hauler
    it.lastH1 = "";
    p.slots[p.slotSel] = "";
    this.storeItem(it);
    return true;
  }

  /** Scatter everything in a player's pack on death/leave. Items land at the
   *  body with a gentle toss so the loot never vanishes with its carrier. */
  dropSlots(p: RPlayer, cause: "die" | "leave"): void {
    for (let i = 0; i < p.slots.length; i++) {
      const id = p.slots[i]!;
      if (!id) continue;
      const it = this.items.get(id);
      p.slots[i] = "";
      if (!it) continue;
      it.state = 0;
      it.sleeping = false;
      it.body.x = p.body.x + (this.rng() - 0.5) * 0.9;
      it.body.z = p.body.z + (this.rng() - 0.5) * 0.9;
      it.body.y = this.itemDef(it).restY + 0.25;
      it.body.vx = (this.rng() - 0.5) * 1.2;
      it.body.vz = (this.rng() - 0.5) * 1.2;
      it.body.vy = 0.6;
      if (cause === "die") this.emit({ t: "unstow", item: id, by: p.sid, def: it.defId });
    }
  }

  // ---------------------------------------------------------------- gas stop
  /** Lobby shop purchase at the gas station. One of each per stop. */
  tryBuy(p: RPlayer, itemId: string): boolean {
    if (this.phase !== "lobby") return false;
    const entry = SHOP.ITEMS.find((s) => s.id === itemId);
    if (!entry) return false;
    if (entry.id === "flashlight" && p.hasFlashlight) return false;
    if (entry.id === "coffee" && p.caffeinated) return false;
    if (p.budget < entry.price) {
      this.emit({ t: "deny", sid: p.sid, k: "broke" });
      return false;
    }
    p.budget -= entry.price;
    if (entry.id === "flashlight") p.hasFlashlight = true;
    if (entry.id === "coffee") p.caffeinated = true;
    this.emit({ t: "bought", sid: p.sid, item: entry.id, price: entry.price, budget: p.budget });
    return true;
  }

  // ---------------------------------------------------------------- body recovery
  /** Pick up a dead teammate's body (E). Two hands, no loot, no sprinting —
   *  a heavy, loud mercy. Reviving the downed is always the better option. */
  tryLiftBody(p: RPlayer, targetSid: string): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || p.hidden || p.grabCd > 0) return false;
    if (p.carrying || p.carryBody) return false; // hands full
    const target = this.players.get(targetSid);
    if (!target || !target.dead || target.bodyVan) return false;
    if (this.bodyCarrier(targetSid)) return false; // someone's already hauling them
    const d = dist2d(p.body.x, p.body.z, target.body.x, target.body.z);
    if (d > PLAYER.INTERACT_RANGE + 0.2) return false;
    if (d > 0.8 && !this.losWallsOnly(p.body.x, p.body.z, target.body.x, target.body.z)) return false;
    p.carryBody = targetSid;
    this.emit({ t: "bodyLift", sid: targetSid, by: p.sid });
    this.noise(target.body.x, target.body.z, NOISE.DROP_LIGHT, "body", p.sid);
    return true;
  }

  bodyCarrier(sid: string): string {
    for (const o of this.players.values()) if (o.carryBody === sid) return o.sid;
    return "";
  }

  /** Set the hauled body down where its carrier stands (G). */
  dropBody(p: RPlayer, emitEvent = true): void {
    const target = this.players.get(p.carryBody);
    p.carryBody = "";
    if (!target) return;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    target.body.x = p.body.x + fx * 0.9;
    target.body.z = p.body.z + fz * 0.9;
    target.body.y = 0;
    if (emitEvent) this.emit({ t: "bodyDrop", sid: target.sid, by: p.sid });
  }

  /** Load the hauled body into the van's cargo bay (E at the open rear). */
  loadBody(p: RPlayer): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || !p.carryBody) return false;
    if (!this.vanDoorsOpen) return false;
    const dp = this.vanPoint(VAN.DOOR_POINT);
    if (dist2d(p.body.x, p.body.z, dp.x, dp.z) > VAN.INTERACT_RANGE + 0.4) return false;
    const target = this.players.get(p.carryBody);
    p.carryBody = "";
    if (!target || !target.dead) return false;
    target.bodyVan = true;
    this.emit({ t: "bodyLoaded", sid: target.sid, by: p.sid });
    this.noise(this.van.x, this.van.z, NOISE.DROP_HEAVY, "body", p.sid);
    return true;
  }

  /** Carried bodies ride their carrier's front; a carrier who sits, drops,
   *  dies or leaves sets the body down where they stand. */
  private stepBodyCarried(): void {
    for (const p of this.players.values()) {
      if (!p.carryBody) continue;
      const ok = p.connected && !p.downed && !p.dead && p.seat === 0;
      const target = this.players.get(p.carryBody);
      if (!ok || !target || !target.dead) {
        this.dropBody(p, ok);
        continue;
      }
      if (target.bodyVan) {
        // loaded out from under the carrier (shouldn't happen; be safe)
        p.carryBody = "";
        continue;
      }
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      target.body.x = p.body.x + fx * CARRY.BODY_HOLD_DIST;
      target.body.z = p.body.z + fz * CARRY.BODY_HOLD_DIST;
      target.body.y = 0.4; // held off the ground, lying
      target.yaw = p.yaw;
    }
  }

  private stepCarried(dt: number): void {
    for (const it of this.items.values()) {
      if (it.state !== 1) continue;
      const def = this.itemDef(it);
      const holders: { p: RPlayer; hx: number; hz: number }[] = [];
      for (const sid of [it.h0, it.h1]) {
        if (!sid) continue;
        const p = this.players.get(sid);
        if (!p || !p.connected || p.dead || p.downed || p.seat > 0) {
          this.releaseCarries(sid, "drop", it.id);
          continue;
        }
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        holders.push({ p, hx: p.body.x + fx * CARRY.HOLD_DIST, hz: p.body.z + fz * CARRY.HOLD_DIST });
      }
      if (holders.length === 0) continue;

      // leash: a carrier straying too far slips
      for (const h of holders) {
        if (dist2d(h.hx, h.hz, it.body.x, it.body.z) > CARRY.LEASH) {
          this.releaseCarries(h.p.sid, "slip", it.id);
          this.emit({ t: "slip", item: it.id, by: h.p.sid, def: it.defId });
          this.noise(it.body.x, it.body.z, def.twoHandle ? NOISE.DROP_HEAVY : NOISE.DROP_LIGHT, "drop", h.p.sid);
          h.p.grabCd = 0.35;
        }
      }
      if (it.state !== 1) continue;
      // re-list valid holders after slips
      const valid = holders.filter((h) => it.h0 === h.p.sid || it.h1 === h.p.sid);
      if (valid.length === 0) continue;

      let tx = 0;
      let tz = 0;
      for (const h of valid) {
        tx += h.hx;
        tz += h.hz;
      }
      tx /= valid.length;
      tz /= valid.length;
      const minSpeed = Math.min(...valid.map((h) => this.effectiveSpeed(h.p))) + 1.6;
      const dx = tx - it.body.x;
      const dz = tz - it.body.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) {
        const step = Math.min(d, minSpeed * dt);
        it.body.x += (dx / d) * step;
        it.body.z += (dz / d) * step;
      }
      it.body.y = CARRY.HOLD_Y;
      it.body.vx = 0;
      it.body.vy = 0;
      it.body.vz = 0;
      it.yaw = valid.length === 2
        ? Math.atan2(valid[1]!.hx - valid[0]!.hx, valid[1]!.hz - valid[0]!.hz)
        : valid[0]!.p.yaw;

      // rattling cargo
      const speed = Math.hypot(valid[0]!.p.body.vx, valid[0]!.p.body.vz);
      const rings = def.noisy || this.modifiers.includes("bells");
      if (rings && speed > 1.2) {
        it.ringCd -= dt;
        if (it.ringCd <= 0) {
          it.ringCd = 1.6 + this.rng() * 1.5;
          this.emit({ t: "ring", item: it.id, x: it.body.x, z: it.body.z });
          this.noise(it.body.x, it.body.z, NOISE.BELL, "bell", valid[0]!.p.sid);
        }
      }
    }
  }

  private stepFree(dt: number, colliders: AABB[]): void {
    for (const it of this.items.values()) {
      if (it.state !== 0 || it.sleeping) continue;
      const def = this.itemDef(it);
      const r = stepFreeItem(it.body, dt, def.restY, def.radius, colliders);
      if (r.impact > FRAGILE_IMPACT_V && (def.fragile || def.twoHandle)) {
        const over = r.impact - FRAGILE_IMPACT_V;
        let dmg = def.fragile ? over * FRAGILE_DPS : over * FRAGILE_DPS * 0.35;
        if (this.modifiers.includes("fragile")) dmg *= 2;
        if (this.lastCarrierStabilizing(it)) dmg *= CARRY.STABILIZE_FACTOR;
        this.damageItem(it, dmg, "impact");
        this.noise(it.body.x, it.body.z, def.twoHandle ? NOISE.DROP_HEAVY : NOISE.DROP_LIGHT, "drop");
      }
      if (r.rested) {
        it.restTimer += dt;
        if (it.restTimer > 0.35) {
          it.sleeping = true;
          it.restTimer = 0;
          if (this.vanDoorsOpen) {
            const l = vanWorldToLocal(this.van, it.body.x, it.body.z);
            if (l.x > VAN.LOAD_ZONE.X0 && l.x < VAN.LOAD_ZONE.X1 && l.z > VAN.LOAD_ZONE.Z0 && l.z < VAN.LOAD_ZONE.Z1) {
              this.storeItem(it);
            }
          }
        }
      } else {
        it.restTimer = 0;
      }
    }
  }

  lastCarrierStabilizing(it: RItem): boolean {
    for (const sid of [it.lastH0, it.lastH1]) {
      const p = this.players.get(sid);
      if (p?.stabilize) return true;
    }
    return false;
  }

  damageItem(it: RItem, dmg: number, cause: string): void {
    if (it.damage >= WRECKED_AT) return;
    const def = this.itemDef(it);
    const before = it.value;
    it.damage = Math.min(WRECKED_AT, it.damage + dmg);
    const factor = it.damage >= WRECKED_AT ? WRECKED_VALUE_FACTOR : 1 - it.damage / 130;
    it.value = Math.max(Math.round(def.value * WRECKED_VALUE_FACTOR), Math.round(def.value * factor));
    const lost = before - it.value;
    if (lost > 0) {
      this.cargoDamage += lost;
      this.emit({ t: "damage", item: it.id, def: it.defId, lost: Math.round(lost), cause, x: it.body.x, z: it.body.z });
      for (const sid of [it.lastH0, it.lastH1]) {
        const p = this.players.get(sid);
        if (p && lost > p.biggestLoss) {
          p.biggestLoss = lost;
          p.lossItem = def.name;
        }
      }
    }
  }

  storeItem(it: RItem): void {
    if (it.state === 2) return;
    const def = this.itemDef(it);
    it.state = 2;
    it.body.vx = 0;
    it.body.vy = 0;
    it.body.vz = 0;
    it.body.y = 0.1;
    this.vanCargo.push(it.id);
    it.secured = this.vanStrapped;
    if (!def.part) {
      const value = it.value;
      this.salvage += value;
      const credited = new Set<string>();
      for (const sid of [it.lastH0, it.lastH1]) {
        if (!sid || credited.has(sid)) continue;
        credited.add(sid);
        const p = this.players.get(sid);
        if (p) {
          p.deliveredValue += value / credited.size;
          p.deliveredCount += 1;
        }
      }
      this.emit({ t: "stored", item: it.id, def: it.defId, value, by: [...credited], x: it.body.x, z: it.body.z });
    } else {
      this.emit({ t: "stored", item: it.id, def: it.defId, value: 0, by: [], x: it.body.x, z: it.body.z });
    }
    this.releaseCarries(it.lastH0, "store", it.id);
    this.releaseCarries(it.lastH1, "store", it.id);
  }

  // ---------------------------------------------------------------- van ops
  vanPoint(local: { x: number; z: number }): { x: number; z: number } {
    return vanLocalToWorld(this.van, local.x, local.z);
  }

  nearestSeatFree(): number {
    for (let i = 2; i <= 4; i++) {
      if (![...this.players.values()].some((p) => p.seat === i)) return i;
    }
    return 0;
  }

  tryEnterVan(p: RPlayer, wantDriver: boolean): boolean {
    if (p.downed || p.dead || p.hidden || p.seat > 0 || p.carrying || p.carryBody || Math.abs(this.van.speed) > 0.5) return false;
    const dp = this.vanPoint(VAN.DOOR_POINT);
    const cab = this.vanPoint(VAN.DRIVER_POINT);
    const nearRear = this.vanDoorsOpen && dist2d(p.body.x, p.body.z, dp.x, dp.z) <= VAN.INTERACT_RANGE;
    const nearCab = dist2d(p.body.x, p.body.z, cab.x, cab.z) <= VAN.INTERACT_RANGE;
    // Explicit driver requests from the open rear remain supported for older clients.
    if (wantDriver ? !nearCab && !nearRear : !nearRear) return false;
    let seat: number;
    if (wantDriver) {
      if (this.vanDriver) return false;
      seat = 1;
    } else {
      seat = this.nearestSeatFree();
      if (!seat) return false;
    }
    p.seat = seat;
    if (seat === 1) this.vanDriver = p.sid;
    this.emit({ t: "seat", sid: p.sid, seat });
    return true;
  }

  leaveSeat(p: RPlayer): void {
    if (p.seat === 1) this.vanDriver = "";
    if (p.seat === SEAT.CART_DRIVER) this.cartDriver = "";
    const side = SEAT.isCart(p.seat)
      ? vanLocalToWorld(this.cart, -CART.HALF_W - 0.7, 0)
      : this.vanPoint({ x: -VAN.HALF_W - 0.7, z: 1.6 });
    p.seat = 0;
    p.body.x = side.x;
    p.body.z = side.z;
    p.body.y = 0;
    p.body.vx = 0;
    p.body.vz = 0;
    p.body.vy = 0;
    this.emit({ t: "seat", sid: p.sid, seat: 0 });
  }

  /** Unified exit for the act handler: checks the speed of whichever vehicle
   *  the player is sitting in before letting them hop out. */
  exitSeat(p: RPlayer): boolean {
    if (p.seat === 0) return false;
    const speed = SEAT.isCart(p.seat) ? this.cart.speed : this.van.speed;
    if (Math.abs(speed) >= 1.5) return false;
    this.leaveSeat(p);
    return true;
  }

  // ---------------------------------------------------------------- cart ops
  cartPoint(local: { x: number; z: number }): { x: number; z: number } {
    return vanLocalToWorld(this.cart, local.x, local.z);
  }

  /** Board the golf cart. Open buggy: step up from either side while it is
   *  (nearly) stopped. Hands must be empty — pack slots are fine. */
  tryEnterCart(p: RPlayer, wantDriver: boolean): boolean {
    if (p.downed || p.dead || p.hidden || p.seat > 0 || p.carrying || p.carryBody || Math.abs(this.cart.speed) > 0.5) return false;
    const nearBody = dist2d(p.body.x, p.body.z, this.cart.x, this.cart.z) <= CART.INTERACT_RANGE;
    const nearSeat = CART.SEATS.some((s) => {
      const w = this.cartPoint(s);
      return dist2d(p.body.x, p.body.z, w.x, w.z) <= CART.INTERACT_RANGE;
    });
    if (!nearBody && !nearSeat) return false;
    let seat: number;
    if (wantDriver) {
      if (this.cartDriver) return false;
      seat = SEAT.CART_DRIVER;
    } else {
      if ([...this.players.values()].some((o) => o.seat === SEAT.CART_PASSENGER)) return false;
      seat = SEAT.CART_PASSENGER;
    }
    p.seat = seat;
    if (wantDriver) this.cartDriver = p.sid;
    this.emit({ t: "seat", sid: p.sid, seat });
    return true;
  }

  toggleVanDoors(p: RPlayer): boolean {
    if (p.downed || p.dead || p.hidden || p.seat > 0 || Math.abs(this.van.speed) > 0.5) return false;
    const dp = this.vanPoint(VAN.DOOR_POINT);
    if (dist2d(p.body.x, p.body.z, dp.x, dp.z) > PLAYER.INTERACT_RANGE + 0.7) return false;
    this.vanDoorsOpen = !this.vanDoorsOpen;
    this.emit({ t: "vanDoors", open: this.vanDoorsOpen });
    this.noise(this.van.x, this.van.z, NOISE.DOOR, "door", p.sid);
    return true;
  }

  toggleVanLights(p: RPlayer): boolean {
    const near = dist2d(p.body.x, p.body.z, this.van.x, this.van.z) < 4.5 || p.seat > 0;
    if (!near) return false;
    this.vanLightsOn = !this.vanLightsOn;
    this.emit({ t: "vanLights", on: this.vanLightsOn });
    return true;
  }

  horn(p: RPlayer): boolean {
    if (p.seat !== 1) return false;
    this.emit({ t: "horn" });
    this.noise(this.van.x, this.van.z, NOISE.HORN, "horn", p.sid);
    return true;
  }

  toggleStraps(p: RPlayer): boolean {
    const sp = this.vanPoint(VAN.STRAP_POINT);
    if (dist2d(p.body.x, p.body.z, sp.x, sp.z) > PLAYER.INTERACT_RANGE + 0.7) return false;
    if (this.vanCargo.length === 0) return false;
    this.vanStrapped = !this.vanStrapped;
    for (const id of this.vanCargo) {
      const it = this.items.get(id);
      if (it) it.secured = this.vanStrapped;
    }
    this.emit({ t: "straps", on: this.vanStrapped });
    return true;
  }

  toggleDoor(p: RPlayer, doorId: string): boolean {
    const d = this.doors.get(doorId);
    if (!d) return false;
    const a = doorAabb(d.def);
    const cx = (a.x0 + a.x1) / 2;
    const cz = (a.z0 + a.z1) / 2;
    if (dist2d(p.body.x, p.body.z, cx, cz) > PLAYER.INTERACT_RANGE + 0.4) return false;
    if (p.downed || p.dead) return false;
    d.open = !d.open;
    const ds = this.state.doors.get(doorId);
    if (ds) ds.open = d.open;
    this.emit({ t: "door", id: doorId, open: d.open });
    this.noise(cx, cz, NOISE.DOOR, "door", p.sid);
    return true;
  }

  toggleFlashlight(p: RPlayer): boolean {
    if (p.dead) return false;
    // the flashlight is gas-station stock: without the purchase there is no
    // torch to click (deny lets the client explain instead of failing silently)
    if (!p.hasFlashlight) {
      this.emit({ t: "deny", sid: p.sid, k: "noFlashlight" });
      return false;
    }
    p.flashlight = !p.flashlight;
    return true;
  }

  // ---------------------------------------------------------------- hiding
  /** Climb into a junker. The Caretaker can't see hidden players unless it
   *  watched them get in (enemy.ts keeps the bust window via lastSeenT). */
  tryHide(p: RPlayer, spotId: string): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || p.hidden) return false;
    if (p.carrying || p.carryBody) return false; // hands full — stow the cargo first
    const s = HIDE_SPOTS.find((h) => h.id === spotId);
    if (!s) return false;
    if (dist2d(p.body.x, p.body.z, s.standX, s.standZ) > HIDE.STAND_RANGE) return false;
    if ([...this.players.values()].some((other) => other.hidden && other.hideSpot === spotId)) return false;
    p.hidden = true;
    p.hideSpot = spotId;
    p.body.x = s.x;
    p.body.z = s.z;
    p.body.vx = 0;
    p.body.vz = 0;
    p.flashlight = false; // no glowing beams out of the grille
    this.noise(s.x, s.z, NOISE.CAR_DOOR, "door", p.sid);
    this.emit({ t: "hide", sid: p.sid, spot: spotId, on: true });
    return true;
  }

  exitHide(p: RPlayer, dragged = false): void {
    if (!p.hidden) return;
    const s = HIDE_SPOTS.find((h) => h.id === p.hideSpot);
    p.hidden = false;
    p.hideSpot = "";
    if (s) {
      p.body.x = s.standX;
      p.body.z = s.standZ;
    }
    p.body.vx = 0;
    p.body.vz = 0;
    this.emit({ t: "hide", sid: p.sid, on: false, dragged });
  }

  // ---------------------------------------------------------------- noise
  noise(x: number, z: number, radius: number, kind: string, by?: string): void {
    let r = radius;
    if (this.modifiers.includes("sensitive")) r *= 1.4;
    if (by) {
      const p = this.players.get(by);
      if (p) p.noiseScore += r * 0.05;
    }
    this.enemy.hear(x, z, r, kind);
    if (kind !== "step") {
      this.emit({ t: "noise", x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(r), k: kind, by: by ?? "" });
    }
  }

  // ---------------------------------------------------------------- damage
  /** sx/sz: world-space position of the damage source when it has one
   *  (Caretaker strike) so clients can point a damage-direction wedge at it. */
  damagePlayer(p: RPlayer, dmg: number, source: string, sx?: number, sz?: number): void {
    if (p.dead) return;
    if (p.downed) {
      p.dead = true;
      p.downed = false;
      this.releaseCarries(p.sid, "drop");
      if (p.carryBody) this.dropBody(p);
      this.dropSlots(p, "die");
      this.emit({ t: "die", sid: p.sid, cause: source });
      return;
    }
    p.hp -= dmg;
    p.interactKind = "";
    p.interactT = 0;
    if (p.hidden) this.exitHide(p, true); // it found you — dragged out of the car
    const hurt: GameEvent = { t: "hurt", sid: p.sid, hp: Math.max(0, Math.round(p.hp)), cause: source };
    if (sx !== undefined && sz !== undefined) {
      hurt.sx = sx;
      hurt.sz = sz;
    }
    this.emit(hurt);
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downedCount += 1;
      p.bleedAt = this.t + PLAYER.DOWNED_BLEEDOUT;
      this.releaseCarries(p.sid, "drop");
      if (p.carryBody) this.dropBody(p);
      this.emit({ t: "down", sid: p.sid });
    }
  }

  revive(p: RPlayer, target: RPlayer): void {
    target.downed = false;
    target.hp = 40;
    target.bleedAt = 0;
    p.rescues += 1;
    this.emit({ t: "revive", sid: target.sid, by: p.sid });
  }

  // ---------------------------------------------------------------- tick
  step(dt: number): void {
    this.t += dt;
    this.state.now = this.t;

    if (this.phase === "briefing" && this.t >= this.briefUntil) {
      this.setPhase(this.arriveEnabled ? "arrive" : "scavenge");
    }
    if (this.phase === "arrive") this.stepArrive(dt);
    if (this.pulling) {
      // success end-beat: the world holds still while the van pulls away
      this.stepPull(dt);
      this.syncAll();
      return;
    }
    if (this.phase === "scavenge" || this.phase === "escape") {
      this.stepMission();
    }

    const colliders = this.playerColliders();
    this.stepPlayers(dt, colliders);
    this.stepCarried(dt);
    this.stepBodyCarried();
    this.stepFree(dt, colliders);
    this.stepVanSim(dt);
    this.stepCartSim(dt);
    const enemyPaused =
      this.testFreezeEnemyAfterDown && [...this.players.values()].some((p) => p.connected && p.downed);
    if ((this.phase === "scavenge" || this.phase === "escape") && process.env.LS_DISABLE_ENEMY !== "1" && !enemyPaused) {
      this.enemy.step(dt);
    }
    this.checkMissionEnd();
    this.syncAll();
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.emit({ t: "phase", p });
  }

  private stepPlayers(dt: number, colliders: AABB[]): void {
    for (const p of this.players.values()) {
      if (p.grabCd > 0) p.grabCd -= dt;
      if (p.dead) {
        p.input.mx = 0;
        p.input.mz = 0;
        // a recovered body rides the cargo bay floor (spot order = Map order)
        if (p.bodyVan) {
          const idx = [...this.players.values()].filter((o) => o.dead && o.bodyVan).indexOf(p);
          const spot = VAN.BODY_SPOTS[Math.max(0, Math.min(idx, VAN.BODY_SPOTS.length - 1))]!;
          const w = this.vanPoint(spot);
          p.body.x = w.x;
          p.body.z = w.z;
          p.body.y = 0.35;
          p.yaw = this.van.yaw + Math.PI / 2; // lying across the bay
        }
        continue;
      }
      if (p.seat > 0) {
        if (SEAT.isCart(p.seat)) {
          const w = this.cartPoint(CART.SEATS[p.seat - SEAT.CART_DRIVER]!);
          p.body.x = w.x;
          p.body.z = w.z;
        } else {
          const w = this.vanPoint(VAN.SEATS[p.seat - 1]!);
          p.body.x = w.x;
          p.body.z = w.z;
        }
        p.body.y = 0;
        p.body.vx = 0;
        p.body.vz = 0;
        continue;
      }
      if (p.hidden) {
        // tucked in a junker: no movement; trying to walk (or jump) climbs out
        if (Math.hypot(p.input.mx, p.input.mz) > 0.4 || p.input.jump) {
          this.exitHide(p);
        } else {
          const s = HIDE_SPOTS.find((h) => h.id === p.hideSpot);
          if (s) {
            p.body.x = s.x;
            p.body.z = s.z;
          }
          p.body.vx = 0;
          p.body.vz = 0;
        }
        continue;
      }
      if (p.downed) {
        p.input.mx = 0;
        p.input.mz = 0;
        if (p.bleedAt && this.t >= p.bleedAt) {
          p.dead = true;
          p.downed = false;
          this.dropSlots(p, "die");
          this.emit({ t: "die", sid: p.sid, cause: "bleed" });
        }
        continue;
      }

      const moving = Math.hypot(p.input.mx, p.input.mz) > 0.1;
      const wantsSprint = p.input.sprint && moving;
      if (wantsSprint && p.stamina > 0) {
        p.stamina = Math.max(0, p.stamina - PLAYER.STAMINA_DRAIN * dt);
      } else {
        // truck-stop coffee: the refund runs noticeably hotter all shift
        const regen = PLAYER.STAMINA_REGEN * (p.caffeinated ? SHOP.CAFFEINE_REGEN_MUL : 1);
        p.stamina = Math.min(PLAYER.STAMINA_MAX, p.stamina + regen * dt);
      }

      const speed = this.effectiveSpeed(p);
      const beforeX = p.body.x;
      const beforeZ = p.body.z;
      const preVx = p.body.vx;
      const preVz = p.body.vz;
      stepPlayer(p.body, p.input, dt, speed, colliders);
      // stop-slide: with the input fully released, replace stepPlayer's fast
      // approach-damping with a gentle exponential decay so letting go of W
      // coasts a fraction of a meter instead of dead-stopping. NOT while
      // carrying (items or a body): hauling already slows you, and the extra
      // drift strains the two-handle leash into unfair slips. Grounded only
      // (air control is unchanged) and unreachable while hidden/seated/downed
      // — those branches continue above. Mirrored EXACTLY in predict.ts.
      if (speed > 0 && !p.carrying && !p.carryBody && Math.hypot(p.input.mx, p.input.mz) <= 1e-4 && p.body.grounded) {
        const keep = Math.exp(-PLAYER.STOP_SLIDE_RATE * dt);
        p.body.vx = preVx * keep;
        p.body.vz = preVz * keep;
      }
      p.yaw = p.input.yaw;
      p.input.jump = false;

      const v = Math.hypot(p.body.x - beforeX, p.body.z - beforeZ) / dt;
      if (v > 0.5) {
        p.stepAcc += v * dt;
        const stride = p.sprinting ? 2.4 : 1.8;
        if (p.stepAcc > stride) {
          p.stepAcc = 0;
          this.noise(p.body.x, p.body.z, p.sprinting ? NOISE.SPRINT : NOISE.WALK, "step", p.sid);
        }
      }

      this.stepInteract(p, dt);
    }
  }

  private stepInteract(p: RPlayer, dt: number): void {
    if (!p.input.interact || p.downed || p.dead) {
      if (p.interactKind) {
        p.interactKind = "";
        p.interactT = 0;
      }
      return;
    }
    let kind: "revive" | "install" | "" = "";
    let target = "";

    for (const o of this.players.values()) {
      if (o === p || !o.downed || o.dead || !o.connected) continue;
      if (dist2d(p.body.x, p.body.z, o.body.x, o.body.z) < PLAYER.INTERACT_RANGE) {
        kind = "revive";
        target = o.sid;
        break;
      }
    }
    if (!kind && this.phase !== "results") {
      const it = this.items.get(p.carrying);
      if (it && it.defId === "distributor" && !this.partInstalled) {
        const ep = this.vanPoint(VAN.ENGINE_POINT);
        if (dist2d(p.body.x, p.body.z, ep.x, ep.z) < PLAYER.INTERACT_RANGE + 0.4) {
          kind = "install";
          target = it.id;
        }
      }
    }

    if (kind !== p.interactKind || target !== p.interactTarget) {
      p.interactKind = kind;
      p.interactTarget = target;
      p.interactT = 0;
    }
    if (!kind) return;

    const need = kind === "revive" ? PLAYER.REVIVE_TIME : 3;
    p.interactT += dt;
    const qPrev = Math.floor((p.interactT - dt) * 4);
    const qNow = Math.floor(p.interactT * 4);
    if (qNow !== qPrev && qNow > 0) {
      this.emit({ t: "prog", sid: p.sid, k: kind, v: Math.min(1, p.interactT / need) });
    }
    if (p.interactT >= need) {
      if (kind === "revive") {
        const o = this.players.get(p.interactTarget);
        if (o && o.downed) this.revive(p, o);
      } else {
        const it = this.items.get(p.interactTarget);
        if (it && it.defId === "distributor" && !this.partInstalled) {
          this.partInstalled = true;
          it.state = 3;
          this.releaseCarries(p.sid, "store", it.id);
          this.emit({ t: "install", by: p.sid });
          this.noise(this.van.x, this.van.z, NOISE.DOOR * 1.5, "install", p.sid);
          this.say(`${p.nick} installed the distributor`);
        }
      }
      p.interactKind = "";
      p.interactT = 0;
    }
  }

  // ---------------------------------------------------------------- arrive
  /** Drive-in tick: driver promotion on disconnect, stall failsafe -> server
   *  autopilot, ordered checkpoint gating, then the park -> scavenge flip. */
  private stepArrive(dt: number): void {
    // driver gone (left or dropped): the next connected rider inherits the
    // wheel — and with it, the exit-driver designation on completion
    const driver = this.vanDriver ? this.players.get(this.vanDriver) : undefined;
    if (!driver || !driver.connected) {
      const next = [...this.players.values()].find((p) => p.connected && p.seat >= 2 && p.seat <= 4);
      if (next) {
        if (driver) driver.seat = next.seat;
        next.seat = 1;
        this.vanDriver = next.sid;
        this.exitDriver = next.sid;
        this.say(`${next.nick} takes the wheel`);
        this.emit({ t: "courseDriver", sid: next.sid });
      }
    }

    // AFK/stuck failsafe: no checkpoint progress for STALL_S -> autopilot
    this.courseStall += dt;
    if (!this.courseAuto && this.courseStall > COURSE.STALL_S) {
      this.courseAuto = true;
      this.say("Nobody driving — the van's bringing itself in. Hang on.");
      this.emit({ t: "courseAuto" });
    }

    if (this.courseStage < 3) {
      const cp = COURSE.STAGES[this.courseStage]!;
      if (dist2d(this.van.x, this.van.z, cp.x, cp.z) < cp.r) {
        this.courseStage += 1;
        this.courseStall = 0;
        this.emit({ t: "course", stage: this.courseStage });
      }
    } else if (dist2d(this.van.x, this.van.z, COURSE.PARK.x, COURSE.PARK.z) < COURSE.PARK.r) {
      this.completeArrival();
    }
  }

  private completeArrival(): void {
    // the wheel-holder at park time is the EXIT DRIVER for the escape phase
    const d = this.players.get(this.vanDriver);
    this.exitDriver = d && d.connected ? d.sid : "";
    this.courseAuto = false;
    // the shift clock starts NOW: re-base endsAt so the drive-in never eats
    // mission time, and briefUntil stays the "scavenge started" timestamp
    this.briefUntil = this.t;
    this.endsAt = this.t + (this.testSeconds > 0 ? this.testSeconds : missionSeconds(this.modifiers));
    this.setPhase("scavenge");
    this.emit({ t: "arrived", driver: this.exitDriver });
    this.say("Parked — and the distributor cap just gave out. Find a replacement.");
  }

  /** A late joiner during the drive-in rides along: any free van seat. */
  seatLateArrival(p: RPlayer): boolean {
    if (this.phase !== "arrive" || p.seat > 0) return false;
    for (let s = 2; s <= 4; s++) {
      if (![...this.players.values()].some((o) => o.seat === s)) {
        p.seat = s;
        this.emit({ t: "seat", sid: p.sid, seat: s });
        return true;
      }
    }
    return false;
  }

  /** The escape-phase leave gate: null = free to go; "down" = the exit driver
   *  needs stabilizing; "body" = their body is still out on the lot. A
   *  designated driver who has left the room lifts the constraint entirely. */
  exitDriverBlock(): null | "down" | "body" {
    if (this.phase !== "escape" || !this.exitDriver) return null;
    const d = this.players.get(this.exitDriver);
    if (!d || !d.connected) return null;
    if (d.dead) return d.bodyVan ? null : "body";
    if (d.downed) return "down";
    return null;
  }

  private stepVanSim(dt: number): void {
    if (this.phase === "results") return;
    const drivable = this.phase === "escape" || this.phase === "arrive";
    const driver = this.vanDriver ? this.players.get(this.vanDriver) : undefined;
    let throttle = 0;
    let steer = 0;
    let handbrake = true;

    if (this.phase === "arrive" && this.courseAuto) {
      // stall failsafe: pure-pursuit toward the next checkpoint (or the park).
      // stepVehicle's steer ADDS to yaw (v.yaw += steer * ...), so a positive
      // heading error wants positive steer — the opposite sign of the player
      // mapping (steer = -mx) above.
      const tgt = this.courseStage < 3 ? COURSE.STAGES[this.courseStage]! : COURSE.PARK;
      const want = Math.atan2(tgt.x - this.van.x, tgt.z - this.van.z);
      const dyaw = Math.atan2(Math.sin(want - this.van.yaw), Math.cos(want - this.van.yaw));
      steer = clamp(dyaw * 1.8, -1, 1);
      throttle = Math.abs(dyaw) > 1.1 && Math.abs(this.van.speed) > 3 ? 0.15 : 0.72;
      handbrake = false;
    } else if (drivable && driver && driver.connected && driver.seat === 1 && !driver.dead && !driver.downed) {
      const i = driver.input;
      throttle = clamp(i.mz, -1, 1);
      steer = -clamp(i.mx, -1, 1); // D steers right on screen (yaw decreases)
      handbrake = i.jump;

      if (this.phase === "escape" && throttle > 0.5) {
        // hard gate first: the van does not leave without its exit driver —
        // no double-press abandon can confirm past a downed driver or an
        // unrecovered body
        const block = this.exitDriverBlock();
        if (block) {
          if (this.t >= this.extractWarnUntil) {
            this.emit({ t: "leaveBlock", k: block, sid: this.exitDriver });
            this.extractWarnUntil = this.t + 6;
          }
          throttle = 0;
        } else {
          // leaving living teammates behind needs a confirming second press
          const outside = this.playersHaveLivingOutside();
          if (outside > 0) {
            if (this.t >= this.extractWarnUntil) {
              this.emit({ t: "leaveWarn", outside });
              this.extractWarnUntil = this.t + 6;
              this.extractConfirmed = false;
            }
            if (!this.extractConfirmed) {
              if (this.t < this.extractWarnUntil && this.extractWarnUntil - this.t < 5.9) {
                // second press inside the window confirms
                this.extractConfirmed = true;
              } else {
                throttle = 0;
              }
            }
          }
        }
      }
    }

    const r = stepVan(this.van, { throttle, steer, handbrake }, dt, this.vanColliders());
    if (r.impact > 1.5) {
      this.emit({ t: "bump", v: Math.round(r.impact) });
      this.noise(this.van.x, this.van.z, NOISE.VAN_BUMP, "bump");
      for (const id of this.vanCargo) {
        const it = this.items.get(id);
        if (it && it.state === 2 && !it.secured) {
          this.damageItem(it, VAN.BUMP_CARGO_DAMAGE * Math.min(2, r.impact / 6), "bump");
        }
      }
    }

    if (this.vanLightsOn) {
      this.headlightsPulseT -= dt;
      if (this.headlightsPulseT <= 0) {
        this.headlightsPulseT = 4;
        this.noise(this.van.x, this.van.z, NOISE.HEADLIGHTS, "lights");
      }
    }

    if (this.phase === "escape" && this.van.x < FINISH_X) {
      this.finish("escaped");
    }
  }

  /** The golf cart runs the moment the shift starts (no repair). It shares
   *  the van's arcade controller with CART tuning and stays lot-bound: only
   *  the van crossing the west finish ends the shift. */
  private stepCartSim(dt: number): void {
    if (this.phase === "results") return;
    const drivable = this.phase === "scavenge" || this.phase === "escape";
    const driver = this.cartDriver ? this.players.get(this.cartDriver) : undefined;
    let throttle = 0;
    let steer = 0;
    let handbrake = true;
    if (drivable && driver && driver.connected && driver.seat === SEAT.CART_DRIVER && !driver.dead && !driver.downed) {
      const i = driver.input;
      throttle = clamp(i.mz, -1, 1);
      steer = -clamp(i.mx, -1, 1); // D steers right on screen (yaw decreases)
      handbrake = i.jump;
    }
    const r = stepVehicle(this.cart, { throttle, steer, handbrake }, dt, this.cartColliders(), CART_CFG);
    if (r.impact > 1.5) {
      this.emit({ t: "bump", v: Math.round(r.impact * 0.6) });
      this.noise(this.cart.x, this.cart.z, NOISE.VAN_BUMP * 0.5, "bump");
    }
    // soft electric whine while under way — The Caretaker can track the shuttle
    if (Math.abs(this.cart.speed) > 0.8) {
      this.cartNoiseT -= dt;
      if (this.cartNoiseT <= 0) {
        this.cartNoiseT = 1.8;
        this.noise(this.cart.x, this.cart.z, CART.DRIVE_NOISE, "cart");
      }
    } else {
      this.cartNoiseT = 0;
    }
  }

  playersHaveLivingOutside(): number {
    let n = 0;
    for (const p of this.players.values()) {
      if (!p.connected || p.dead || p.seat > 0) continue;
      if (p.downed || dist2d(p.body.x, p.body.z, this.van.x, this.van.z) > 4.5) n++;
    }
    return n;
  }

  /** Success end-beat: ease pullT 0->1 over MISSION.PULL_S while the van
   *  drives itself along its facing. Seated riders keep following their seats
   *  (the crew rides out); everyone else, items and the enemy stay put. */
  private stepPull(dt: number): void {
    this.pullElapsed += dt;
    const raw = Math.min(1, this.pullElapsed / MISSION.PULL_S);
    this.pullT = raw * raw * (3 - 2 * raw); // smoothstep ease
    const easeIn = this.pullT < 0.3 ? this.pullT / 0.3 : 1;
    const v = MISSION.PULL_SPEED * easeIn;
    this.van.speed = v;
    this.van.x = clamp(this.van.x + Math.sin(this.van.yaw) * v * dt, -68.5, 33);
    this.van.z = clamp(this.van.z + Math.cos(this.van.yaw) * v * dt, -25, 25);
    for (const p of this.players.values()) {
      if (p.dead && p.bodyVan) {
        // recovered bodies ride out with the crew
        const idx = [...this.players.values()].filter((o) => o.dead && o.bodyVan).indexOf(p);
        const spot = VAN.BODY_SPOTS[Math.max(0, Math.min(idx, VAN.BODY_SPOTS.length - 1))]!;
        const w = this.vanPoint(spot);
        p.body.x = w.x;
        p.body.z = w.z;
        continue;
      }
      if (p.dead || p.seat === 0) continue;
      const w = this.vanPoint(VAN.SEATS[p.seat - 1]!);
      p.body.x = w.x;
      p.body.z = w.z;
      p.body.y = 0;
      p.body.vx = 0;
      p.body.vz = 0;
    }
    if (this.pullElapsed >= MISSION.PULL_S) {
      this.pulling = false;
      this.finalize("escaped");
    }
  }

  private stepMission(): void {
    const elapsed = this.t - (this.endsAt - missionSeconds(this.modifiers));
    const want = elapsed > MISSION.ESCALATE_AT_S[1]! ? 3 : elapsed > MISSION.ESCALATE_AT_S[0]! ? 2 : 1;
    if (want > this.escalation) {
      this.escalation = want;
      this.emit({ t: "escalate", lv: want });
    }
    if (!this.gateOpen && this.partInstalled && this.salvage >= this.quota) {
      this.gateOpen = true;
      this.state.gateOpen = true;
      this.setPhase("escape");
      this.emit({ t: "gate" });
      this.say("Quota met, van running. GET OUT.");
    }
  }

  private checkMissionEnd(): void {
    if (this.phase !== "scavenge" && this.phase !== "escape") return;
    if (this.t >= this.endsAt) {
      this.finish("timeout");
      return;
    }
    // players inside their reconnect grace still count as active — a solo
    // player's brief disconnect must not instantly wipe the run
    const actives = [...this.players.values()].filter(
      (p) => !p.dead && (p.connected || this.t < p.graceUntil),
    );
    if (actives.length === 0 || actives.every((p) => p.downed)) {
      this.finish("wipe");
    }
  }

  finish(outcome: "escaped" | "timeout" | "wipe"): void {
    if (this.phase === "results" || this.pulling) return;
    if (outcome === "escaped") {
      // success end-beat: record the outcome now, then hold the world while
      // the van pulls away (stepPull); results land once the pull completes
      this.pulling = true;
      this.pullElapsed = 0;
      this.pullT = 0;
      this.state.outcome = outcome;
      return;
    }
    this.finalize(outcome);
  }

  /** Scoreboard freeze shared by every outcome: phase -> results, rows,
   *  awards and the results event. */
  private finalize(outcome: "escaped" | "timeout" | "wipe"): void {
    // gas-station stop restocks for the next shift: budget back to full and
    // consumables cleared (the coffee wore off; the torchlight goes back on
    // the rack). Players who never left the lot keep their change — it resets
    // here, not at startMission, so lobby purchases survive into the shift.
    for (const p of this.players.values()) {
      p.budget = SHOP.BUDGET;
      p.hasFlashlight = false;
      p.caffeinated = false;
    }
    if (outcome === "escaped") {
      for (const p of this.players.values()) {
        if (!p.dead && p.seat === 0) {
          p.dead = true;
          p.downed = false;
        }
      }
    }
    this.setPhase("results");
    this.state.outcome = outcome;
    // Row status = who each player physically was at the outcome moment. In
    // the escaped branch above, anyone alive but not seated was just marked
    // dead (left behind), so seat > 0 is exactly "made it into the van". A
    // timeout means the van never left, so even someone buckled in is "left".
    const rows: MissionAwardRow[] = [...this.players.values()].map((p) => ({
      nick: p.nick,
      color: p.color,
      delivered: Math.round(p.deliveredValue),
      items: p.deliveredCount,
      noise: Math.round(p.noiseScore),
      rescues: p.rescues,
      biggestLoss: Math.round(p.biggestLoss),
      lossItem: p.lossItem,
      downed: p.downedCount,
      recovered: p.dead && p.bodyVan,
      status:
        outcome === "escaped"
          ? p.seat > 0
            ? "escaped"
            : "down"
          : outcome === "timeout"
            ? p.dead || p.downed
              ? "down"
              : "left"
            : "down",
    }));
    const results = {
      outcome,
      quotaMet: this.salvage >= this.quota,
      salvage: Math.round(this.salvage),
      quota: this.quota,
      cargoDamage: Math.round(this.cargoDamage),
      // Actual experienced shift: scavenge start (briefUntil — the one stored
      // timestamp that stays correct when testSeconds shortens endsAt) to the
      // outcome moment. Timeout lands at ~the full shift, escape is shorter.
      shiftSeconds: Math.max(0, Math.round(this.t - this.briefUntil)),
      awards: computeAwards(rows),
      rows,
    };
    this.state.resultsJson = JSON.stringify(results);
    this.emit({ t: "results", outcome });
  }

  // ---------------------------------------------------------------- sync
  syncPlayerSchema(p: RPlayer, full = false): void {
    let sp = this.state.players.get(p.sid);
    if (!sp) {
      sp = new PlayerState();
      sp.slots = new ArraySchema<string>() as never;
      this.state.players.set(p.sid, sp);
      full = true;
    }
    if (full) {
      sp.nick = p.nick;
      sp.color = p.color;
      sp.host = p.host;
    }
    sp.connected = p.connected;
    sp.ready = p.ready;
    sp.x = p.body.x;
    sp.y = p.body.y;
    sp.z = p.body.z;
    sp.yaw = p.yaw;
    sp.pitch = p.pitch;
    sp.vx = p.body.vx;
    sp.vz = p.body.vz;
    sp.inputSeq = p.lastSeq;
    sp.grounded = p.body.grounded;
    sp.hp = Math.max(0, Math.round(p.hp));
    sp.stamina = Math.round(p.stamina);
    sp.downed = p.downed;
    sp.dead = p.dead;
    sp.bleedAt = p.bleedAt;
    sp.flashlight = p.flashlight;
    sp.sprinting = p.sprinting;
    sp.carrying = p.carrying;
    const slotArr = sp.slots as unknown as string[];
    slotArr.length = 0;
    for (const id of p.slots) slotArr.push(id);
    sp.slotSel = p.slotSel;
    sp.budget = p.budget;
    sp.hasFlashlight = p.hasFlashlight;
    sp.caffeinated = p.caffeinated;
    sp.carryBody = p.carryBody;
    sp.bodyVan = p.bodyVan;
    sp.seat = p.seat;
    sp.hidden = p.hidden;
    sp.hat = p.hat;
    sp.driving = p.seat === 1 || p.seat === SEAT.CART_DRIVER;
    sp.noiseScore = p.noiseScore;
    sp.deliveredValue = p.deliveredValue;
    sp.deliveredCount = p.deliveredCount;
    sp.rescues = p.rescues;
    sp.biggestLoss = p.biggestLoss;
    sp.lossItem = p.lossItem;
    sp.downedCount = p.downedCount;
  }

  syncAll(): void {
    const st = this.state;
    st.phase = this.phase;
    st.seed = this.seed;
    st.endsAt = this.endsAt;
    st.quota = this.quota;
    st.lootTotal = this.lootTotal;
    st.salvage = Math.round(this.salvage);
    st.escalation = this.escalation;

    for (const p of this.players.values()) this.syncPlayerSchema(p);

    for (const it of this.items.values()) {
      let si = st.items.get(it.id);
      if (!si) {
        si = new ItemState();
        si.defId = it.defId;
        st.items.set(it.id, si);
      }
      si.state = it.state;
      si.x = it.body.x;
      si.y = it.body.y;
      si.z = it.body.z;
      si.yaw = it.yaw;
      si.value = it.value;
      si.damage = it.damage;
      si.h0 = it.h0;
      si.h1 = it.h1;
      si.secured = it.secured;
    }

    st.van.x = this.van.x;
    st.van.z = this.van.z;
    st.van.yaw = this.van.yaw;
    st.van.speed = this.van.speed;
    st.van.pullT = this.pullT;
    st.van.doorsOpen = this.vanDoorsOpen;
    st.van.lightsOn = this.vanLightsOn;
    st.van.partInstalled = this.partInstalled;
    st.van.strapped = this.vanStrapped;
    st.van.driver = this.vanDriver;
    const cargoArr = st.van.cargo as unknown as string[];
    cargoArr.length = 0;
    for (const id of this.vanCargo) cargoArr.push(id);

    st.cart.x = this.cart.x;
    st.cart.z = this.cart.z;
    st.cart.yaw = this.cart.yaw;
    st.cart.speed = this.cart.speed;
    st.cart.driver = this.cartDriver;

    st.course.stage = this.courseStage;
    st.course.driver = this.exitDriver;
    st.course.autopilot = this.courseAuto;

    st.enemy.x = this.enemy.x;
    st.enemy.z = this.enemy.z;
    st.enemy.yaw = this.enemy.yaw;
    st.enemy.ai = this.enemy.aiCode;
    st.enemy.forcing = this.enemy.forcingDoor;
    st.enemy.chaseSid = this.enemy.chaseSid; // who it is chasing ("" = nobody)
    st.enemy.phase = this.escalation;
  }

  pushMarker(kind: string, text: string, x: number, y: number, z: number, by: string): void {
    const m = new MarkerState();
    m.kind = kind;
    m.text = text;
    m.x = x;
    m.y = y;
    m.z = z;
    m.by = by;
    m.at = this.t;
    const arr = this.state.markers as unknown as MarkerState[];
    arr.push(m);
    while (arr.length > 12) arr.shift();
  }
}
