// Snapshot interpolation buffer for remote entities (the Caretaker, remote
// crew, the van): the client renders them ~INTERP_DELAY_MS behind the newest
// patch by blending the two snapshots that bracket the render time.
//
// The pre-fix version (engine.ts @ 13fa140) had no answer for render time
// running AHEAD of the newest snapshot — network jitter past the delay made
// it return the stale raw position (entity freezes) and then fast-forward
// when the late patch landed (rubber band). Per the standard entity
// interpolation contract, sample() now EXTRAPOLATES along the final segment,
// bounded to EXTRAP_MAX_MS: linear interpolation across a late patch's span
// reconstructs the same velocity the extrapolation was riding, so re-entry
// is continuous through gaps up to INTERP_DELAY_MS + EXTRAP_MAX_MS.
//
// Push policy: one snapshot per patch, timestamps dense. Unchanged values
// still push (fresh timestamps keep extrapolation velocity honest around
// starts/stops); repeat pushes within the same patch update in place so the
// 60 fps render loop can't flood the buffer.

import { angleLerp } from "./math.js";

/** How far past the newest snapshot extrapolation may ride (ms). Chosen
 *  equal to the engine's INTERP_DELAY_MS (120): linear re-entry through a
 *  late patch is then continuous for stalls up to delay+cap = 240 ms. */
export const EXTRAP_MAX_MS = 120;

export interface Snap {
  at: number;
  x: number;
  z: number;
  yaw: number;
}

export class SnapBuf {
  private snaps: Snap[] = [];
  private lastX = NaN;
  private lastZ = NaN;

  push(at: number, x: number, z: number, yaw: number): void {
    // hard teleport: reset history so we don't smear across the map
    if (Number.isFinite(this.lastX) && Math.hypot(x - this.lastX, z - this.lastZ) > 2.5) {
      this.snaps = [];
    }
    this.lastX = x;
    this.lastZ = z;
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && prev.at === at) {
      // same patch, another render frame: refresh in place (kept value wins —
      // it is at least as fresh as what we pushed first)
      prev.x = x;
      prev.z = z;
      prev.yaw = yaw;
      return;
    }
    this.snaps.push({ at, x, z, yaw });
    if (this.snaps.length > 20) this.snaps.shift();
  }

  sample(renderAt: number): Snap | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    if (n === 1) return this.snaps[0]!;
    if (renderAt <= this.snaps[0]!.at) return this.snaps[0]!; // clock behind history (fresh join)
    const last = this.snaps[n - 1]!;
    if (renderAt >= last.at) {
      // jitter ride: keep the final segment's velocity, bounded. A late patch
      // holds its motion instead of teleporting to the newest raw state.
      const a = this.snaps[n - 2]!;
      const span = last.at - a.at;
      if (span <= 0) return last;
      const over = Math.min(renderAt - last.at, EXTRAP_MAX_MS);
      return {
        at: renderAt,
        x: last.x + ((last.x - a.x) / span) * over,
        z: last.z + ((last.z - a.z) / span) * over,
        yaw: angleLerp(a.yaw, last.yaw, 1 + over / span),
      };
    }
    for (let i = n - 1; i > 0; i--) {
      const b = this.snaps[i]!;
      const a = this.snaps[i - 1]!;
      if (a.at <= renderAt && renderAt <= b.at) {
        const span = b.at - a.at || 1;
        const t = (renderAt - a.at) / span;
        return { at: renderAt, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: angleLerp(a.yaw, b.yaw, t) };
      }
    }
    return last;
  }
}
