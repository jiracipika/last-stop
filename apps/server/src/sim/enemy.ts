// The Caretaker — one enemy, clear finite-state machine, nav-graph locomotion.
// PATROL -> INVESTIGATE (noise) -> CHASE (sight) -> WINDUP -> RECOVER.
// Closed doors must be forced; players standing near a door slow it down.

import {
  ENEMY, NAV_NODES, NAV_INDEX, NAV_ADJ, navPath, nearestNavNode, PATROL_ROUTES,
  doorAabb, moveToward, segHitsAabb, dist2d, angleDiff, mulberry32,
} from "@last-stop/shared";
import type { World } from "./world.js";

export type AIState = "patrol" | "investigate" | "chase" | "windup" | "recover" | "forcedoor";

const CODE: Record<AIState, number> = {
  patrol: 0, investigate: 1, chase: 2, windup: 3, recover: 4, forcedoor: 5,
};

export class CaretakerAI {
  x = 0;
  z = 0;
  yaw = 0;
  ai: AIState = "patrol";
  rng: () => number;

  path: number[] = [];
  pathI = 0;
  route: string[] = [];
  routeI = 0;
  routeDir = 1;
  pauseT = 0;
  stuckT = 0;

  investX = 0;
  investZ = 0;
  searchT = 0;

  chaseSid = "";
  lastSeenX = 0;
  lastSeenZ = 0;
  lastSeenT = -99;
  repathT = 0;

  windupT = 0;
  struck = false;
  recoverT = 0;

  forcingDoor = "";
  forceT = 0;
  bangT = 0;

  visT = 0;
  huntT = 0;

  constructor(private world: World) {
    this.rng = mulberry32(0x9e3779b9);
  }

  reset(rng: () => number): void {
    this.rng = rng;
    this.route = PATROL_ROUTES[Math.floor(rng() * PATROL_ROUTES.length)]!;
    this.routeI = Math.floor(rng() * this.route.length);
    const start = NAV_NODES[NAV_INDEX.get(this.route[this.routeI]!)!];
    this.x = start!.x;
    this.z = start!.z;
    this.yaw = 0;
    this.ai = "patrol";
    this.path = [];
    this.pathI = 0;
    this.pauseT = 0;
    this.chaseSid = "";
    this.forcingDoor = "";
    this.huntT = 0;
  }

  get aiCode(): number {
    return CODE[this.ai];
  }

  speedMul(): number {
    const esc = this.world.escalation === 3 ? 1.3 : this.world.escalation === 2 ? 1.15 : 1;
    // AMPED UP stacks with escalation, but the night only gets so fast:
    // unclamped, esc3+wired put chase at 7.1 m/s vs sprint 5.2 — unwinnable.
    return Math.min(esc * (this.world.modifiers.includes("wired") ? 1.2 : 1), 1.3);
  }

  hearingMul(): number {
    return this.world.escalation === 3 ? 1.35 : this.world.escalation === 2 ? 1.2 : 1;
  }

  /** Noise heard at (x,z) with effective radius r. */
  hear(x: number, z: number, r: number, kind: string): void {
    if (this.ai === "chase" || this.ai === "windup" || this.ai === "forcedoor") return;
    const d = dist2d(this.x, this.z, x, z);
    const range = r * this.hearingMul();
    if (d <= range) {
      this.investX = x;
      this.investZ = z;
      if (this.ai !== "investigate" || kind === "horn" || this.rng() < 0.6) {
        this.ai = "investigate";
        this.searchT = 0;
        this.setPathTo(x, z);
      }
    }
  }

  setPathTo(x: number, z: number): void {
    const from = nearestNavNode(this.x, this.z);
    const to = nearestNavNode(x, z);
    this.path = navPath(from, to);
    this.pathI = 0;
  }

  // ------------------------------------------------------------------ vision
  scanVision(): { sid: string; x: number; z: number } | null {
    const w = this.world;
    let best: { sid: string; x: number; z: number } | null = null;
    let bestD = Infinity;
    const range = ENEMY.VIEW_RANGE * (w.modifiers.includes("blackout") ? 0.85 : 1) * (w.escalation === 3 ? 1.15 : 1);
    for (const p of w.players.values()) {
      if (!p.connected || p.dead || p.downed) continue;
      if (p.seat > 0 && !w.vanDoorsOpen) continue; // hidden inside the van
      if (p.hidden) {
        // tucked in a junker — invisible, UNLESS it watched you climb in
        // (chasing you with a fresh sighting: the bust window)
        const busted = this.ai === "chase" && this.chaseSid === p.sid && w.t - this.lastSeenT < ENEMY.LOSE_SIGHT_GRACE;
        if (!busted) continue;
      }
      const d = dist2d(this.x, this.z, p.body.x, p.body.z);
      if (d > range || d >= bestD) continue;
      // FOV check
      const dx = p.body.x - this.x;
      const dz = p.body.z - this.z;
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const dot = (dx * fx + dz * fz) / (d || 1);
      const inFov = dot > ENEMY.VIEW_FOV_COS || d < 2.2; // senses at point blank
      if (!inFov) continue;
      if (!w.hasLineOfSight(this.x, this.z, p.body.x, p.body.z)) continue;
      best = { sid: p.sid, x: p.body.x, z: p.body.z };
      bestD = d;
    }
    return best;
  }

  closedDoorAhead(): string | null {
    const next = this.currentWaypoint();
    if (!next) return null;
    for (const d of this.world.doors.values()) {
      if (d.open) continue;
      if (segHitsAabb(this.x, this.z, next.x, next.z, doorAabb(d.def))) return d.def.id;
    }
    return null;
  }

  currentWaypoint(): { x: number; z: number } | null {
    if (this.pathI < this.path.length) {
      const n = NAV_NODES[this.path[this.pathI]!]!;
      return { x: n.x, z: n.z };
    }
    return null;
  }

  // ------------------------------------------------------------------ step
  step(dt: number): void {
    const w = this.world;
    this.visT -= dt;
    if (this.visT <= 0) {
      this.visT = 0.2;
      const seen = this.scanVision();
      if (seen) {
        this.chaseSid = seen.sid;
        this.lastSeenX = seen.x;
        this.lastSeenZ = seen.z;
        this.lastSeenT = w.t;
        if (this.ai === "patrol" || this.ai === "investigate" || this.ai === "recover") {
          this.ai = "chase";
          this.repathT = 0;
        }
      }
    }

    // escalation-3 hunt pulses: periodically investigates a living player's area
    if (w.escalation >= 3 && this.ai === "patrol") {
      this.huntT -= dt;
      if (this.huntT <= 0) {
        const living = w.livingPlayers().filter((p) => !p.downed);
        if (living.length) {
          const t = living[Math.floor(this.rng() * living.length)]!;
          this.huntT = 12;
          this.investX = t.body.x;
          this.investZ = t.body.z;
          this.ai = "investigate";
          this.setPathTo(t.body.x, t.body.z);
        }
      }
    }

    switch (this.ai) {
      case "patrol": this.stepPatrol(dt); break;
      case "investigate": this.stepInvestigate(dt); break;
      case "chase": this.stepChase(dt); break;
      case "windup": this.stepWindup(dt); break;
      case "recover": this.stepRecover(dt); break;
      case "forcedoor": this.stepForceDoor(dt); break;
    }
  }

  private followPath(speed: number, dt: number): "moving" | "arrived" | "blocked" {
    const colliders = this.world.playerColliders();
    while (this.pathI < this.path.length) {
      const wp = this.currentWaypoint()!;
      // door forcing check happens before movement
      const doorId = this.closedDoorAhead();
      if (doorId) {
        this.startForcing(doorId);
        return "blocked";
      }
      const r = moveToward(this.x, this.z, this.yaw, wp.x, wp.z, speed, dt, colliders);
      this.x = r.x;
      this.z = r.z;
      this.yaw = r.yaw;
      if (r.arrived) {
        this.pathI++;
        continue;
      }
      return r.blocked ? "blocked" : "moving";
    }
    return "arrived";
  }

  private stepPatrol(dt: number): void {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return;
    }
    if (this.pathI >= this.path.length) {
      // pick the next route node (walk the loop, sometimes reverse / detour)
      if (this.rng() < 0.12) this.routeDir *= -1;
      if (this.rng() < 0.15) {
        // detour to a random neighbor of the current node
        const cur = nearestNavNode(this.x, this.z);
        const nbs = NAV_ADJ[cur]!;
        if (nbs.length) {
          const nb = NAV_NODES[nbs[Math.floor(this.rng() * nbs.length)]!]!;
          this.setPathTo(nb.x, nb.z);
          return;
        }
      }
      this.routeI = (this.routeI + this.routeDir + this.route.length) % this.route.length;
      const node = NAV_NODES[NAV_INDEX.get(this.route[this.routeI]!)!];
      if (node) this.setPathTo(node.x, node.z);
      return;
    }
    const res = this.followPath(ENEMY.PATROL_SPEED * this.speedMul(), dt);
    if (res === "arrived") {
      this.pauseT = ENEMY.NODE_PAUSE + this.rng() * ENEMY.NODE_PAUSE_JITTER;
    } else if (res === "blocked" && this.ai !== "forcedoor") {
      this.recoverFromStuck(dt);
    }
  }

  private stepInvestigate(dt: number): void {
    if (this.pathI >= this.path.length) {
      // arrived at disturbance: search around
      this.searchT += dt;
      this.yaw += Math.sin(this.searchT * 1.7) * dt * 1.4;
      if (this.searchT >= ENEMY.SEARCH_TIME) {
        this.ai = "patrol";
        this.searchT = 0;
      }
      return;
    }
    const res = this.followPath(ENEMY.INVESTIGATE_SPEED * this.speedMul(), dt);
    if (res === "blocked" && this.ai !== "forcedoor") this.recoverFromStuck(dt);
  }

  private stepChase(dt: number): void {
    const w = this.world;
    const target = w.players.get(this.chaseSid);
    const targetBusted = target?.hidden && w.t - this.lastSeenT < ENEMY.LOSE_SIGHT_GRACE;
    if (
      !target || !target.connected || target.dead || target.downed ||
      (target.seat > 0 && !w.vanDoorsOpen) ||
      (target.hidden && !targetBusted) // vanished into a car it didn't see you enter
    ) {
      // target invalid: investigate last known position. The chase is over —
      // drop the focus so the wire stops claiming a target and the ex-target
      // can hear the hunt end.
      this.chaseSid = "";
      this.ai = "investigate";
      this.investX = this.lastSeenX;
      this.investZ = this.lastSeenZ;
      this.setPathTo(this.lastSeenX, this.lastSeenZ);
      return;
    }
    const d = dist2d(this.x, this.z, target.body.x, target.body.z);

    // strike? (a busted hider gets reached INTO the car — no infinite standoff)
    if (d < (target.hidden ? 2.4 : ENEMY.ATTACK_RANGE)) {
      this.ai = "windup";
      this.windupT = 0;
      this.struck = false;
      return;
    }

    // lost sight? the chase on this target is over: release the focus
    if (w.t - this.lastSeenT > ENEMY.LOSE_SIGHT_GRACE) {
      this.chaseSid = "";
      this.ai = "investigate";
      this.investX = this.lastSeenX;
      this.investZ = this.lastSeenZ;
      this.searchT = 0;
      this.setPathTo(this.lastSeenX, this.lastSeenZ);
      return;
    }

    // repath periodically toward the target
    this.repathT -= dt;
    if (this.repathT <= 0 || this.pathI >= this.path.length) {
      this.repathT = 0.7;
      this.setPathTo(target.body.x, target.body.z);
    }
    // direct approach when close and clear
    if (d < 6 && w.hasLineOfSight(this.x, this.z, target.body.x, target.body.z)) {
      const r = moveToward(this.x, this.z, this.yaw, target.body.x, target.body.z, ENEMY.CHASE_SPEED * this.speedMul(), dt, w.playerColliders());
      this.x = r.x;
      this.z = r.z;
      this.yaw = r.yaw;
      if (d < ENEMY.ATTACK_RANGE) {
        this.ai = "windup";
        this.windupT = 0;
        this.struck = false;
      }
      return;
    }
    const res = this.followPath(ENEMY.CHASE_SPEED * this.speedMul(), dt);
    if (res === "blocked" && this.ai !== "forcedoor") this.recoverFromStuck(dt);
  }

  private stepWindup(dt: number): void {
    const w = this.world;
    this.windupT += dt;
    // telegraph: it pivots toward its target while winding up (leaves a slim
    // last-instant dodge window; also prevents striking forever the wrong way)
    const target = w.players.get(this.chaseSid);
    if (target && !target.dead && !target.downed) {
      const targetYaw = Math.atan2(target.body.x - this.x, target.body.z - this.z);
      this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, 3.2 * dt);
    }
    if (this.windupT >= ENEMY.WINDUP_TIME && !this.struck) {
      this.struck = true;
      w.emit({ t: "strike", x: this.x, z: this.z });
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      for (const p of w.players.values()) {
        if (!p.connected || p.dead || p.seat > 0) continue;
        const dx = p.body.x - this.x;
        const dz = p.body.z - this.z;
        const d = Math.hypot(dx, dz);
        if (d > (p.hidden ? 2.9 : ENEMY.STRIKE_RANGE)) continue;
        const dot = (dx * fx + dz * fz) / (d || 1);
        if (dot > ENEMY.STRIKE_ARC_COS || d < 1.2) {
          w.damagePlayer(p, ENEMY.HIT_DAMAGE, "caretaker");
        }
      }
    }
    if (this.windupT >= ENEMY.WINDUP_TIME + ENEMY.RECOVER_TIME) {
      this.ai = "recover";
      this.recoverT = 0;
    }
  }

  private stepRecover(dt: number): void {
    this.recoverT += dt;
    // slow shuffle toward last seen while vulnerable
    if (this.recoverT > ENEMY.RECOVER_TIME) {
      this.ai = "investigate";
      this.investX = this.lastSeenX;
      this.investZ = this.lastSeenZ;
      this.searchT = 0;
      this.setPathTo(this.lastSeenX, this.lastSeenZ);
    }
  }

  private startForcing(doorId: string): void {
    this.ai = "forcedoor";
    this.forcingDoor = doorId;
    this.forceT = 0;
    this.bangT = 0;
  }

  private stepForceDoor(dt: number): void {
    const w = this.world;
    const door = w.doors.get(this.forcingDoor);
    if (!door || door.open) {
      this.ai = "investigate";
      this.forcingDoor = "";
      this.setPathTo(this.investX || this.x, this.investZ || this.z);
      return;
    }
    const dAabb = doorAabb(door.def);
    const cx = (dAabb.x0 + dAabb.x1) / 2;
    const cz = (dAabb.z0 + dAabb.z1) / 2;
    // approach the door
    const d = dist2d(this.x, this.z, cx, cz);
    if (d > 1.15) {
      const r = moveToward(this.x, this.z, this.yaw, cx, cz, ENEMY.ATTACK_SPEED * this.speedMul(), dt, []);
      this.x = r.x;
      this.z = r.z;
      this.yaw = r.yaw;
      return;
    }
    // face it and force
    this.yaw = Math.atan2(cx - this.x, cz - this.z);
    let need = ENEMY.DOOR_FORCE_BASE;
    if (this.chaseSid) need *= 0.6;
    for (const p of w.players.values()) {
      if (!p.connected || p.dead || p.downed || p.seat > 0) continue;
      if (dist2d(p.body.x, p.body.z, cx, cz) < 1.5) need += ENEMY.DOOR_FORCE_PER_PLAYER;
    }
    this.forceT += dt;
    this.bangT -= dt;
    if (this.bangT <= 0) {
      this.bangT = 0.8;
      w.emit({ t: "bang", id: door.def.id, x: cx, z: cz });
    }
    if (this.forceT >= need) {
      door.open = true;
      const ds = w.state.doors.get(door.def.id);
      if (ds) ds.open = true;
      w.emit({ t: "door", id: door.def.id, open: true, forced: true });
      this.forcingDoor = "";
      this.ai = this.chaseSid ? "chase" : "investigate";
      this.repathT = 0;
    }
  }

  private recoverFromStuck(dt: number): void {
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      // snap onto the nearest node and rebuild the path from there
      const cur = nearestNavNode(this.x, this.z);
      const n = NAV_NODES[cur]!;
      this.x = n.x;
      this.z = n.z;
      this.setPathTo(this.investX || n.x, this.investZ || n.z);
    }
  }
}
