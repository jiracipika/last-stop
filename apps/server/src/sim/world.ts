// Server-authoritative world: players, items, doors, van, mission state.
// The GameRoom drives this at a fixed 30 Hz; everything gameplay-relevant is
// decided here and mirrored into the Colyseus schema.

import { randomInt } from "node:crypto";
import {
  AABB, Body, MoveInput, stepPlayer, stepFreeItem, stepVan, carrySpeedFactor, vanLocalToWorld, vanWorldToLocal,
  PLAYER, CARRY, NOISE, VAN, MISSION, FRAGILE_IMPACT_V, FRAGILE_DPS, WRECKED_AT, WRECKED_VALUE_FACTOR,
  ITEM_DEFS, planSpawns, planValue, quotaFactor, missionSeconds, pickModifiers,
  STATIC_COLLIDERS, LOS_BLOCKERS, DOORS, DoorDef, doorAabb, PLAYER_SPAWNS, VAN_START, FINISH_X, GATE,
  HIDE_SPOTS, HIDE,
  mulberry32, clamp, dist2d, hasLineOfSight,
  PlayerState, ItemState, EnemyState, VanState, MarkerState, DoorState, RoomState,
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
  seat: number;
  hidden: boolean;
  hideSpot: string;
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
  state: 0 | 1 | 2 | 3;
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

export type Phase = "lobby" | "briefing" | "scavenge" | "escape" | "results";

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
  extractWarnUntil = 0;
  extractConfirmed = false;

  enemy: CaretakerAI;
  events: GameEvent[] = [];
  briefUntil = 0;
  nextItemId = 0;
  rng: () => number = mulberry32(1);
  /** test-only overrides (set by GameRoom under LS_TEST_MODE=1) */
  testQuota = -1;
  testSeconds = 0;
  testEnemyAt: { x: number; z: number } | null = null;
  testFreezeEnemyAfterDown = false;

  constructor() {
    this.state = new RoomState();
    this.state.markers = new ArraySchema<MarkerState>() as never;
    this.state.modifiers = new ArraySchema<string>() as never;
    this.state.van = new VanState();
    this.state.van.cargo = new ArraySchema<string>() as never;
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

  playerColliders(): AABB[] {
    const closed: AABB[] = [];
    for (const d of this.doors.values()) if (!d.open) closed.push(doorAabb(d.def));
    return STATIC_COLLIDERS.concat(closed, [this.vanAabb()]);
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
    if (this.gateOpen || this.phase === "results") return null;
    return { x0: GATE.x - 0.2, x1: GATE.x + 0.2, z0: GATE.z0, z1: GATE.z1 };
  }

  vanColliders(): AABB[] {
    const g = this.gateCollider();
    return g ? STATIC_COLLIDERS.concat([g]) : STATIC_COLLIDERS;
  }

  itemDef(it: RItem): ItemDef {
    return ITEM_DEFS[it.defId]!;
  }

  livingPlayers(): RPlayer[] {
    return [...this.players.values()].filter((p) => p.connected && !p.dead && !p.downed);
  }

  // ---------------------------------------------------------------- lobby
  addPlayer(sid: string, nick: string, color: number, host: boolean, hat = 0): RPlayer {
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
      carrying: "", seat: 0, hidden: false, hideSpot: "", stabilize: false,
      interactKind: "", interactTarget: "", interactT: 0,
      stepAcc: 0, noiseScore: 0, deliveredValue: 0, deliveredCount: 0,
      rescues: 0, biggestLoss: 0, lossItem: "", downedCount: 0, grabCd: 0, spawn: 0,
      graceUntil: 0,
    };
    this.players.set(sid, p);
    this.placeAtSpawn(p);
    this.syncPlayerSchema(p, true);
    return p;
  }

  removePlayer(sid: string): void {
    this.releaseCarries(sid, "leave");
    const p = this.players.get(sid);
    if (p && p.seat > 0) {
      if (p.seat === 1) this.vanDriver = "";
      p.seat = 0;
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

  // ---------------------------------------------------------------- mission
  startMission(): void {
    const count = Math.max(1, this.players.size);
    this.soloMode = count === 1;
    this.seed = randomInt(0, 0xffffffff);
    const rng = mulberry32(this.seed);
    this.rng = rng;
    this.modifiers = pickModifiers(rng);
    const plan = planSpawns(rng, count);

    let i = 0;
    for (const p of this.players.values()) {
      p.spawn = i++;
      p.hp = 100;
      p.downed = false;
      p.dead = false;
      p.bleedAt = 0;
      p.carrying = "";
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
    this.vanCargo = [];
    (this.state.van.cargo as unknown as string[]).length = 0;
    this.quota = this.testQuota >= 0 ? this.testQuota : Math.round(planValue(plan.items) * quotaFactor(count));
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

    this.phase = "briefing";
    this.briefUntil = this.t + 5;
    this.endsAt = this.t + 5 + (this.testSeconds > 0 ? this.testSeconds : missionSeconds(this.modifiers));

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
    if (p.carrying) {
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
    if (p.downed || p.dead || p.seat > 0 || p.carrying || p.grabCd > 0) return false;
    const it = this.items.get(itemId);
    if (!it) return false;
    const def = this.itemDef(it);
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
    const d = dist2d(p.body.x, p.body.z, it.body.x, it.body.z);
    if (d > PLAYER.GRAB_RANGE + def.radius) return false;
    // must not reach through walls (the van itself does NOT block grabs:
    // loading happens at its open rear)
    if (d > 0.8 && !this.losWallsOnly(p.body.x, p.body.z, it.body.x, it.body.z)) return false;
    if (it.defId === "distributor" && this.partInstalled) return false;
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
      this.emit({ t: "drop", item: it.id, by: p.sid, def: it.defId, thrown });
    }
    return true;
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
      this.emit({ t: "stored", item: it.id, def: it.defId, value, by: [...credited] });
    } else {
      this.emit({ t: "stored", item: it.id, def: it.defId, value: 0, by: [] });
    }
    this.releaseCarries(it.lastH0, "store", it.id);
    this.releaseCarries(it.lastH1, "store", it.id);
  }

  // ---------------------------------------------------------------- van ops
  vanPoint(local: { x: number; z: number }): { x: number; z: number } {
    return vanLocalToWorld(this.van, local.x, local.z);
  }

  nearestSeatFree(): number {
    for (let i = 1; i <= 4; i++) {
      if (![...this.players.values()].some((p) => p.seat === i)) return i;
    }
    return 0;
  }

  tryEnterVan(p: RPlayer, wantDriver: boolean): boolean {
    if (p.downed || p.dead || p.seat > 0 || p.carrying) return false;
    if (!this.vanDoorsOpen) return false;
    const dp = this.vanPoint(VAN.DOOR_POINT);
    if (dist2d(p.body.x, p.body.z, dp.x, dp.z) > PLAYER.INTERACT_RANGE + 0.7) return false;
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
    p.seat = 0;
    const side = this.vanPoint({ x: -VAN.HALF_W - 0.7, z: 1.6 });
    p.body.x = side.x;
    p.body.z = side.z;
    p.body.y = 0;
    p.body.vx = 0;
    p.body.vz = 0;
    p.body.vy = 0;
    this.emit({ t: "seat", sid: p.sid, seat: 0 });
  }

  toggleVanDoors(p: RPlayer): boolean {
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
    p.flashlight = !p.flashlight;
    return true;
  }

  // ---------------------------------------------------------------- hiding
  /** Climb into a junker. The Caretaker can't see hidden players unless it
   *  watched them get in (enemy.ts keeps the bust window via lastSeenT). */
  tryHide(p: RPlayer, spotId: string): boolean {
    if (this.phase !== "scavenge" && this.phase !== "escape") return false;
    if (p.downed || p.dead || p.seat > 0 || p.hidden) return false;
    if (p.carrying) return false; // hands full — stow the cargo first
    const s = HIDE_SPOTS.find((h) => h.id === spotId);
    if (!s) return false;
    if (dist2d(p.body.x, p.body.z, s.standX, s.standZ) > HIDE.STAND_RANGE) return false;
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
  damagePlayer(p: RPlayer, dmg: number, source: string): void {
    if (p.dead) return;
    if (p.downed) {
      p.dead = true;
      p.downed = false;
      this.releaseCarries(p.sid, "drop");
      this.emit({ t: "die", sid: p.sid, cause: source });
      return;
    }
    p.hp -= dmg;
    p.interactKind = "";
    p.interactT = 0;
    if (p.hidden) this.exitHide(p, true); // it found you — dragged out of the car
    this.emit({ t: "hurt", sid: p.sid, hp: Math.max(0, Math.round(p.hp)), cause: source });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downedCount += 1;
      p.bleedAt = this.t + PLAYER.DOWNED_BLEEDOUT;
      this.releaseCarries(p.sid, "drop");
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
      this.setPhase("scavenge");
    }
    if (this.phase === "scavenge" || this.phase === "escape") {
      this.stepMission();
    }

    const colliders = this.playerColliders();
    this.stepPlayers(dt, colliders);
    this.stepCarried(dt);
    this.stepFree(dt, colliders);
    this.stepVanSim(dt);
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
        continue;
      }
      if (p.seat > 0) {
        const seatLocal = VAN.SEATS[p.seat - 1]!;
        const w = this.vanPoint(seatLocal);
        p.body.x = w.x;
        p.body.z = w.z;
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
          this.emit({ t: "die", sid: p.sid, cause: "bleed" });
        }
        continue;
      }

      const moving = Math.hypot(p.input.mx, p.input.mz) > 0.1;
      const wantsSprint = p.input.sprint && moving;
      if (wantsSprint && p.stamina > 0) {
        p.stamina = Math.max(0, p.stamina - PLAYER.STAMINA_DRAIN * dt);
      } else {
        p.stamina = Math.min(PLAYER.STAMINA_MAX, p.stamina + PLAYER.STAMINA_REGEN * dt);
      }

      const speed = this.effectiveSpeed(p);
      const beforeX = p.body.x;
      const beforeZ = p.body.z;
      stepPlayer(p.body, p.input, dt, speed, colliders);
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

  private stepVanSim(dt: number): void {
    if (this.phase === "results") return;
    const drivable = this.phase === "escape";
    const driver = this.vanDriver ? this.players.get(this.vanDriver) : undefined;
    let throttle = 0;
    let steer = 0;
    let handbrake = true;

    if (drivable && driver && driver.connected && driver.seat === 1 && !driver.dead && !driver.downed) {
      const i = driver.input;
      throttle = clamp(i.mz, -1, 1);
      steer = -clamp(i.mx, -1, 1); // D steers right on screen (yaw decreases)
      handbrake = i.jump;

      // leaving living teammates behind needs a confirming second press
      if (throttle > 0.5) {
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

  playersHaveLivingOutside(): number {
    let n = 0;
    for (const p of this.players.values()) {
      if (!p.connected || p.dead || p.seat > 0) continue;
      if (p.downed || dist2d(p.body.x, p.body.z, this.van.x, this.van.z) > 4.5) n++;
    }
    return n;
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
    if (this.phase === "results") return;
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
    }));
    const results = {
      outcome,
      quotaMet: this.salvage >= this.quota,
      salvage: Math.round(this.salvage),
      quota: this.quota,
      cargoDamage: Math.round(this.cargoDamage),
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
    sp.seat = p.seat;
    sp.hidden = p.hidden;
    sp.hat = p.hat;
    sp.driving = p.seat === 1;
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
    st.van.doorsOpen = this.vanDoorsOpen;
    st.van.lightsOn = this.vanLightsOn;
    st.van.partInstalled = this.partInstalled;
    st.van.strapped = this.vanStrapped;
    st.van.driver = this.vanDriver;
    const cargoArr = st.van.cargo as unknown as string[];
    cargoArr.length = 0;
    for (const id of this.vanCargo) cargoArr.push(id);

    st.enemy.x = this.enemy.x;
    st.enemy.z = this.enemy.z;
    st.enemy.yaw = this.enemy.yaw;
    st.enemy.ai = this.enemy.aiCode;
    st.enemy.forcing = this.enemy.forcingDoor;
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
