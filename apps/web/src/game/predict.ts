// Local prediction for the owning player: same shared step function as the
// server, with input-sequence reconciliation against authoritative patches.
import { Body, MoveInput, stepPlayer, carrySpeedFactor, PLAYER, CARRY, ITEM_DEFS, clamp } from "@last-stop/shared";
import type { RoomState } from "@last-stop/shared";

interface RingEntry {
  seq: number;
  x: number;
  z: number;
}

/** The render offset never grows past this — beyond it the next reconcile
 *  hard-cuts instead (bounded drift beats invisible teleport). */
const VIS_MAX = 1.5;
const clampVis = (v: number): number => clamp(v, -VIS_MAX, VIS_MAX);

export class Predictor {
  body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true };
  yaw = Math.PI;
  /** replicated carrying id of the owning player; gates the stop-slide */
  carrying = "";
  /** Seq of the input snapshot currently being simulated — i.e. the last one
   *  SENT. The engine advances it when a packet ships; every ring entry is
   *  tagged with it so reconcile(serverSeq) compares the same instant on both
   *  ends. (The old per-frame ++seq raced past the network seq and fell out
   *  of the ring's 1.5 s window, hard-snapping the local player forever.) */
  inputSeq = 0;
  /** m/s of velocity the last step's collision resolve stripped (bump signal). */
  bumpImpulse = 0;
  /** decaying render offset from reconciliation — see reconcile() */
  visX = 0;
  visZ = 0;
  private ring: RingEntry[] = [];
  private colliders: () => import("@last-stop/shared").AABB[];

  constructor(colliders: () => import("@last-stop/shared").AABB[]) {
    this.colliders = colliders;
  }

  reset(x: number, z: number, yaw = Math.PI): void {
    this.body.x = x;
    this.body.z = z;
    this.body.y = 0;
    this.body.vx = 0;
    this.body.vz = 0;
    this.body.vy = 0;
    this.yaw = yaw;
    this.bumpImpulse = 0;
    this.visX = 0;
    this.visZ = 0;
    this.ring = [];
  }

  /** Client-side speed estimate mirroring the server's effectiveSpeed EXACTLY
   *  (sprint gate + stamina + carry caps included — the old walk-only
   *  under-prediction made every sprint rubber-band on reconcile). */
  speedFor(state: RoomState, sid: string, input: { mx: number; mz: number; sprint?: boolean }): number {
    const me = state.players.get(sid);
    if (!me || me.downed || me.dead || me.seat > 0) return 0;
    const moving = Math.hypot(input.mx, input.mz) > 0.1;
    let wantSprint = input.sprint === true && moving && me.stamina > 0.5;
    let factor = 1;
    if (me.carryBody) {
      // hauling a coworker's body: fixed heavy load, no sprint — mirrors the
      // server's effectiveSpeed body branch EXACTLY (same constant)
      factor *= carrySpeedFactor(CARRY.BODY_WEIGHT);
      wantSprint = false;
    } else {
      const carrying = me.carrying;
      if (carrying) {
        const it = state.items.get(carrying);
        if (it) {
          const def = ITEM_DEFS[it.defId];
          if (def) {
            const carriers = (it.h0 ? 1 : 0) + (it.h1 ? 1 : 0) || 1;
            const w = def.weight * (def.twoHandle && state.players.size === 1 ? CARRY.SOLO_HEAVY_FACTOR : 1);
            const per = w / carriers;
            factor *= carrySpeedFactor(per);
            if (per >= CARRY.SPRINT_MAX_WEIGHT) wantSprint = false;
          }
        }
      }
    }
    let speed = (wantSprint ? PLAYER.SPRINT : PLAYER.WALK) * factor;
    if (me.hp < 30) speed *= 0.85;
    return speed;
  }

  step(dt: number, input: MoveInput & { interact: boolean }, speed: number): void {
    if (speed <= 0) {
      // still apply gravity/ground so jumps stay consistent
    }
    const preVx = this.body.vx;
    const preVz = this.body.vz;
    const ghost = { ...this.body };
    stepPlayer(this.body, input, dt, speed, this.colliders());
    // Read-only bump probe: replay the same shared step on a throwaway body
    // with an empty collider list — the velocity gap is exactly what wall
    // resolution stripped this tick. The predicted body is never touched by
    // the ghost, so server/client parity is unaffected. The engine turns big
    // impulses into a soft thud; engine.ts owns threshold + cooldown.
    stepPlayer(ghost, input, dt, speed, []);
    this.bumpImpulse = Math.hypot(ghost.vx - this.body.vx, ghost.vz - this.body.vz);
    // stop-slide: with the input fully released, replace stepPlayer's fast
    // approach-damping with a gentle exponential decay so letting go of W
    // coasts a fraction of a meter instead of dead-stopping. NOT while
    // carrying (engine keeps this.carrying synced from replicated state).
    // Grounded only; the engine never calls step() while hidden/seated/
    // downed. Mirrored EXACTLY in the server's world.ts stepPlayers.
    if (speed > 0 && !this.carrying && Math.hypot(input.mx, input.mz) <= 1e-4 && this.body.grounded) {
      const keep = Math.exp(-PLAYER.STOP_SLIDE_RATE * dt);
      this.body.vx = preVx * keep;
      this.body.vz = preVz * keep;
    }
    this.yaw = input.yaw;
    // drain the reconciliation render offset (~170 ms to eye-invisible)
    const visKeep = Math.exp(-14 * dt);
    this.visX *= visKeep;
    this.visZ *= visKeep;
    if (Math.abs(this.visX) < 0.004) this.visX = 0;
    if (Math.abs(this.visZ) < 0.004) this.visZ = 0;
    this.ring.push({ seq: this.inputSeq, x: this.body.x, z: this.body.z });
    if (this.ring.length > 150) this.ring.shift();
  }

  /** Reconcile against the authoritative position for a given input seq. */
  reconcile(serverX: number, serverZ: number, serverSeq: number): void {
    // find the ring entry at/just before the acked sequence
    let entry: RingEntry | undefined;
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i]!.seq <= serverSeq) {
        entry = this.ring[i];
        break;
      }
    }
    if (!entry) {
      // no history (just joined/restarted): hard sync
      this.body.x = serverX;
      this.body.z = serverZ;
      this.visX = 0;
      this.visZ = 0;
      return;
    }
    const ex = serverX - entry.x;
    const ez = serverZ - entry.z;
    const err = Math.hypot(ex, ez);
    if (err > 3) {
      // teleport-class jump (respawn/escape/hidden): hard cut, no glide
      this.body.x = serverX;
      this.body.z = serverZ;
      this.visX = 0;
      this.visZ = 0;
      return;
    }
    // the sim body corrects partially; the un-applied remainder becomes a
    // decaying render offset so reconciliation reads as a drift to truth
    // instead of the old hard snap (the sprint rubber-band)
    const k = err > 0.6 ? 0.6 : err > 0.03 ? 0.2 : 0;
    this.body.x += ex * k;
    this.body.z += ez * k;
    this.visX = clampVis(this.visX + ex * (1 - k));
    this.visZ = clampVis(this.visZ + ez * (1 - k));
  }

  /** Render position: the sim body plus the decaying reconciliation offset. */
  renderX(): number {
    return this.body.x + this.visX;
  }

  renderZ(): number {
    return this.body.z + this.visZ;
  }
}

