// Local prediction for the owning player: same shared step function as the
// server, with input-sequence reconciliation against authoritative patches.
import { Body, MoveInput, stepPlayer, carrySpeedFactor, PLAYER, CARRY, ITEM_DEFS } from "@last-stop/shared";
import type { RoomState } from "@last-stop/shared";

interface RingEntry {
  seq: number;
  x: number;
  z: number;
}

export class Predictor {
  body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true };
  yaw = Math.PI;
  private ring: RingEntry[] = [];
  private seq = 0;
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
    this.ring = [];
  }

  nextSeq(): number {
    return ++this.seq;
  }

  /** Client-side estimate of the carry penalty (server remains authoritative). */
  speedFor(state: RoomState, sid: string): number {
    const me = state.players.get(sid);
    if (!me || me.downed || me.dead || me.seat > 0) return 0;
    let speed = PLAYER.WALK;
    const carrying = me.carrying;
    if (carrying) {
      const it = state.items.get(carrying);
      if (it) {
        const def = ITEM_DEFS[it.defId];
        if (def) {
          const carriers = (it.h0 ? 1 : 0) + (it.h1 ? 1 : 0) || 1;
          const w = def.weight * (def.twoHandle && state.players.size === 1 ? CARRY.SOLO_HEAVY_FACTOR : 1);
          speed *= carrySpeedFactor(w / carriers);
        }
      }
    }
    if (me.hp < 30) speed *= 0.85;
    return speed;
  }

  step(dt: number, input: MoveInput & { interact: boolean }, speed: number): void {
    if (speed <= 0) {
      // still apply gravity/ground so jumps stay consistent
    }
    stepPlayer(this.body, input, dt, speed, this.colliders());
    this.yaw = input.yaw;
    this.ring.push({ seq: this.seq, x: this.body.x, z: this.body.z });
    if (this.ring.length > 90) this.ring.shift();
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
      return;
    }
    const ex = serverX - entry.x;
    const ez = serverZ - entry.z;
    const err = Math.hypot(ex, ez);
    if (err > 0.6) {
      this.body.x += ex;
      this.body.z += ez;
    } else if (err > 0.03) {
      this.body.x += ex * 0.2;
      this.body.z += ez * 0.2;
    }
  }
}
