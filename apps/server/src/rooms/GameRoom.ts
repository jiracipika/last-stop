// GameRoom: Colyseus lifecycle + message validation around the authoritative
// World simulation. Runs a fixed 30 Hz tick, patches state at 20 Hz.

import { Room, Client, defineRoom, matchMaker } from "@colyseus/core";
import { TICK_DT, PATCH_MS, MISSION, QUICK_MESSAGES, TICK_HZ } from "@last-stop/shared";
import { World, type RPlayer } from "../sim/world.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Live rooms in this process — public hosting needs a hard cap so room
 * creation can't be spammed into memory pressure. */
const liveRooms = new Set<GameRoom>();
const maxRooms = (): number => Number(process.env.LS_MAX_ROOMS ?? 4);

interface Limiter {
  last: number;
  minGap: number; // seconds
}

export class GameRoom extends Room {
  override maxClients = MISSION.MAX_PLAYERS;
  world!: World;
  limitters = new Map<string, Map<string, Limiter>>();
  inputFlood = new Map<string, { windowStart: number; count: number }>();

  override async onCreate(_options: Record<string, unknown>): Promise<void> {
    if (liveRooms.size >= maxRooms()) {
      throw new Error("Server is at capacity — try again in a few minutes");
    }
    liveRooms.add(this);
    this.world = new World();
    this.state = this.world.state as never;
    // Test-only knobs (CI speed). Gated by server env so a hostile client
    // cannot shorten timers or lower quotas on a production server.
    if (process.env.LS_TEST_MODE === "1") {
      const q = Number(_options.testQuota);
      const s = Number(_options.testSeconds);
      if (Number.isFinite(q) && q >= 0) this.world.testQuota = q;
      if (Number.isFinite(s) && s > 0) this.world.testSeconds = s;
      // deterministic enemy placement for integration tests
      const ex = Number(_options.testEnemyX);
      const ez = Number(_options.testEnemyZ);
      if (Number.isFinite(ex) && Number.isFinite(ez)) this.world.testEnemyAt = { x: ex, z: ez };
      if (_options.testFreezeEnemyAfterDown === true) this.world.testFreezeEnemyAfterDown = true;
      // test knob: the next mission start jumps straight to the escape phase
      // (part installed, gate open) for compass/aim testing
      if (_options.testAt === "escape") this.world.testAtEscape = true;
      // test knob: spawn a toolbox beside the van for stow/pack probes
      if (_options.testItemAt === true) this.world.testItemAt = true;
    }
    this.setSimulationInterval(() => this.tick(), Math.round(1000 / TICK_HZ));
    this.setPatchRate(PATCH_MS);
    this.autoDispose = true;
    // join-by-code: host picks a short code, the room id becomes LS<CODE>.
    // A taken code rejects the create; the client retries with a fresh code.
    const code = _options?.code;
    if (typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)) {
      const roomId = `LS${code}`;
      const taken = await matchMaker.driver.findByIds([roomId]);
      if (taken && taken.size > 0) {
        throw new Error(`Room code ${code} already exists`);
      }
      this.roomId = roomId;
    }

    this.onMessage("in", (client, data) => {
      const p = this.world.players.get(client.sessionId);
      if (!p || !p.connected) return;
      if (typeof data !== "object" || data === null) return;
      // Input frames are idempotent state snapshots: always apply, but flood
      // far beyond a normal 20-30 Hz sender and the client gets kicked.
      const now = this.clock.elapsedTime / 1000;
      let f = this.inputFlood.get(client.sessionId);
      if (!f) {
        f = { windowStart: now, count: 0 };
        this.inputFlood.set(client.sessionId, f);
      }
      if (now - f.windowStart > 2) {
        f.windowStart = now;
        f.count = 0;
      }
      f.count++;
      if (f.count > 180) {
        client.leave(4000);
        return;
      }
      this.world.setMoveInput(p, data as Record<string, unknown>);
    });

    this.onMessage("act", (client, data) => {
      const p = this.world.players.get(client.sessionId);
      if (!p || !p.connected || typeof data !== "object" || data === null) return;
      this.handleAct(client, p, data as Record<string, unknown>);
    });

    this.onMessage("ping", (client, data) => {
      client.send("ev", { t: "pong", c: typeof data === "number" ? data : 0 });
    });
  }

  private rateOk(client: Client, kind: string, minGap: number): boolean {
    let m = this.limitters.get(client.sessionId);
    if (!m) {
      m = new Map();
      this.limitters.set(client.sessionId, m);
    }
    const now = this.clock.elapsedTime / 1000;
    const l = m.get(kind);
    if (!l) {
      m.set(kind, { last: now, minGap });
      return true;
    }
    if (now - l.last < l.minGap) return false;
    l.last = now;
    return true;
  }

  private handleAct(client: Client, p: RPlayer, data: Record<string, unknown>): void {
    const w = this.world;
    const kind = String(data.k ?? "");
    switch (kind) {
      case "profile": {
        if (w.phase !== "lobby" && w.phase !== "results") return;
        if (!this.rateOk(client, "profile", 0.5)) return;
        const nick = typeof data.nick === "string" ? data.nick.slice(0, 16).trim() : p.nick;
        if (nick) p.nick = nick;
        if (typeof data.color === "number" && data.color >= 0 && data.color < 8) {
          const used = new Set([...w.players.values()].filter((o) => o.sid !== p.sid).map((o) => o.color));
          if (!used.has(data.color)) p.color = data.color;
        }
        if (typeof data.hat === "number" && data.hat >= 0 && data.hat <= 4) p.hat = data.hat;
        w.syncPlayerSchema(p, true);
        this.broadcast("ev", { t: "profile", sid: p.sid, nick: p.nick, color: p.color });
        return;
      }
      case "ready": {
        if (w.phase !== "lobby") return;
        p.ready = !p.ready;
        return;
      }
      case "start": {
        if (w.phase !== "lobby" || !p.host) return;
        const all = [...w.players.values()];
        if (!all.every((o) => o.ready)) return;
        w.startMission();
        return;
      }
      case "replay": {
        if (w.phase !== "results") return;
        if (!this.rateOk(client, "replay", 3)) return;
        for (const o of w.players.values()) o.ready = false;
        w.startMission();
        return;
      }
      case "grab": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "grab", 0.1)) return;
        const id = typeof data.id === "string" ? data.id : "";
        w.tryGrab(p, id);
        return;
      }
      case "grabSlot": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "grabSlot", 0.15)) return;
        const id = typeof data.id === "string" ? data.id : "";
        w.tryStow(p, id);
        return;
      }
      case "slot": {
        if (typeof data.i !== "number") return;
        if (!this.rateOk(client, "slot", 0.08)) return;
        w.selectSlot(p, Math.max(0, Math.min(2, Math.round(data.i))));
        return;
      }
      case "dropSlot": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "dropSlot", 0.3)) return;
        w.dropSlot(p);
        return;
      }
      case "storeSlot": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "storeSlot", 0.3)) return;
        w.storeSlot(p);
        return;
      }
      case "shop": {
        if (w.phase !== "lobby") return;
        if (!this.rateOk(client, "shop", 0.4)) return;
        const item = typeof data.item === "string" ? data.item : "";
        w.tryBuy(p, item);
        return;
      }
      case "release": {
        if (!this.rateOk(client, "release", 0.1)) return;
        w.tryRelease(p, data.thrown === true);
        return;
      }
      case "door": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "door", 0.3)) return;
        const id = typeof data.id === "string" ? data.id : "";
        w.toggleDoor(p, id);
        return;
      }
      case "hide": {
        if (data.out === true) {
          if (!this.rateOk(client, "hideOut", 0.3)) return;
          w.exitHide(p);
        } else {
          if (!this.rateOk(client, "hideIn", 0.6)) return;
          if (typeof data.spot === "string") w.tryHide(p, data.spot);
        }
        return;
      }
      case "flashlight": {
        if (!this.rateOk(client, "flashlight", 0.2)) return;
        w.toggleFlashlight(p);
        return;
      }
      case "vanDoors": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "vanDoors", 0.4)) return;
        w.toggleVanDoors(p);
        return;
      }
      case "vanLights": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "vanLights", 0.4)) return;
        w.toggleVanLights(p);
        return;
      }
      case "horn": {
        if (!this.rateOk(client, "horn", 1.2)) return;
        w.horn(p);
        return;
      }
      case "enterVan": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "enterVan", 0.5)) return;
        w.tryEnterVan(p, data.driver === true);
        return;
      }
      case "enterCart": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "enterCart", 0.5)) return;
        w.tryEnterCart(p, data.driver === true);
        return;
      }
      case "exitVan": {
        if (!this.rateOk(client, "exitVan", 0.5)) return;
        // handles whichever vehicle the player is seated in (van or cart)
        w.exitSeat(p);
        return;
      }
      case "straps": {
        if (w.phase === "results" || w.phase === "lobby") return;
        if (!this.rateOk(client, "straps", 0.5)) return;
        w.toggleStraps(p);
        return;
      }
      case "ping3d": {
        if (!this.rateOk(client, "ping3d", 1.2)) return;
        if (typeof data.x !== "number" || typeof data.z !== "number") return;
        const k = typeof data.kind === "string" ? data.kind : "ping";
        const x = Math.max(-70, Math.min(34, data.x));
        const z = Math.max(-26, Math.min(26, data.z));
        w.pushMarker("ping", k, x, 1.2, z, p.sid);
        this.broadcast("ev", { t: "ping3d", x, z, kind: k, by: p.sid });
        return;
      }
      case "quick": {
        if (!this.rateOk(client, "quick", 1.5)) return;
        const idx = typeof data.i === "number" ? Math.round(data.i) : -1;
        const msg = QUICK_MESSAGES[idx];
        if (!msg) return;
        w.pushMarker("quick", msg.label, p.body.x, 1.6, p.body.z, p.sid);
        this.broadcast("ev", { t: "quick", msg: msg.label, sid: p.sid, x: p.body.x, z: p.body.z });
        return;
      }
      default:
        return;
    }
  }

  override async onJoin(client: Client, options: Record<string, unknown> | undefined): Promise<void> {
    const w = this.world;
    // seats: connected players + players inside the reconnect grace window
    const seated = [...w.players.values()].length;
    if (seated >= MISSION.MAX_PLAYERS) {
      throw new Error("Room is full");
    }
    // late join: clock in mid-shift (briefing/scavenge/escape, pull-away included)
    const late = w.phase === "briefing" || w.phase === "scavenge" || w.phase === "escape";
    const nick = typeof options?.nick === "string" && options.nick.trim()
      ? options.nick.trim().slice(0, 16)
      : `Rookie${Math.floor(Math.random() * 90 + 10)}`;
    const color = typeof options?.color === "number" ? Math.max(0, Math.min(7, Math.round(options.color))) : w.players.size % 8;
    const hat = typeof options?.hat === "number" ? Math.max(0, Math.min(4, Math.round(options.hat))) : 0;
    const host = w.players.size === 0;
    const p = w.addPlayer(client.sessionId, nick, color, host, hat, late);
    this.broadcast("ev", { t: "join", sid: client.sessionId, nick: p.nick });
    if (w.phase === "scavenge" || w.phase === "escape") {
      w.say(`${p.nick} clocked in late - get to work.`);
    }
  }

  override async onDrop(client: Client, _code?: number): Promise<void> {
    const w = this.world;
    const p = w.players.get(client.sessionId);
    if (!p) return;
    if (w.phase === "lobby" || w.phase === "results") {
      return; // onLeave finalizes immediately
    }
    // unexpected drop mid-mission: free their hands immediately, hold the seat
    p.connected = false;
    p.graceUntil = w.t + MISSION.RECONNECT_GRACE_S;
    w.releaseCarries(client.sessionId, "leave");
    this.broadcast("ev", { t: "dropConn", sid: client.sessionId });
    try {
      const re = await this.allowReconnection(client, MISSION.RECONNECT_GRACE_S);
      if (re) {
        p.connected = true;
        p.graceUntil = 0;
        this.broadcast("ev", { t: "rejoin", sid: client.sessionId });
      }
    } catch {
      /* grace expired; onLeave finalizes */
    }
  }

  override onReconnect?(client: Client): void {
    const p = this.world.players.get(client.sessionId);
    if (p) {
      p.connected = true;
      p.graceUntil = 0;
      this.broadcast("ev", { t: "rejoin", sid: client.sessionId });
    }
  }

  override async onLeave(client: Client, _code?: number): Promise<void> {
    this.world.removePlayer(client.sessionId);
    this.limitters.delete(client.sessionId);
    this.broadcast("ev", { t: "leave", sid: client.sessionId });
  }

  override onDispose(): void {
    liveRooms.delete(this);
  }

  private tick(): void {
    const w = this.world;
    w.step(TICK_DT);
    if (w.events.length) {
      const evs = w.events.slice();
      w.events.length = 0;
      for (const e of evs) this.broadcast("ev", e);
    }
  }
}

export default defineRoom(GameRoom);
