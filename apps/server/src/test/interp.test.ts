// Remote-entity interpolation buffer (the client's SnapBuf, now in shared).
// The playtest report was "enemies rubber banding": the pre-fix buffer froze
// on late patches (renderAt overran the newest snapshot -> sample returned
// the stale newest raw position) and then fast-forwarded when the patch
// landed — freeze + rubber band. The fix follows the standard entity
// interpolation contract (see the html5-canvas-game netcode reference):
// interpolate between the snapshots bracketing renderTime, and when
// renderTime is AHEAD of the newest snapshot, extrapolate along the final
// segment bounded to EXTRAP_MAX_MS — never jump to raw state.
//
// The LegacySnapBuf below is a verbatim copy of the pre-fix algorithm
// (engine.ts @ 13fa140) so the suite proves both halves: legacy exhibits the
// bug, the shared buffer does not.
import { describe, expect, test } from "vitest";
import { EXTRAP_MAX_MS, SnapBuf } from "@last-stop/shared";

const PATCH_MS = 33;
const FPS_MS = 1000 / 60;
const DELAY_MS = 120; // matches engine INTERP_DELAY_MS

/** Verbatim pre-fix SnapBuf (engine.ts @ 13fa140) — the rubber-band proof. */
class LegacySnapBuf {
  private snaps: { at: number; x: number; z: number; yaw: number }[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  push(at: number, x: number, z: number, yaw: number): void {
    if (Number.isFinite(this.lastX) && Math.hypot(x - this.lastX, z - this.lastZ) > 2.5) {
      this.snaps = [];
    }
    this.lastX = x;
    this.lastZ = z;
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && Math.hypot(x - prev.x, z - prev.z) < 0.005 && Math.abs(x - prev.x) < 0.005) {
      return;
    }
    this.snaps.push({ at, x, z, yaw });
    if (this.snaps.length > 20) this.snaps.shift();
  }
  sample(renderAt: number): { x: number; z: number; yaw: number } | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    if (n === 1) return this.snaps[0]!;
    for (let i = n - 1; i > 0; i--) {
      const b = this.snaps[i]!;
      const a = this.snaps[i - 1]!;
      if (a.at <= renderAt && renderAt <= b.at) {
        const span = b.at - a.at || 1;
        const t = (renderAt - a.at) / span;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + (b.yaw - a.yaw) * t };
      }
    }
    return this.snaps[n - 1]!;
  }
}

interface Probe {
  maxSpeed: number; // max rendered speed (m/s) after priming
  minSpeedInGap: number; // min rendered speed during the SHORT gap window
  maxBackStep: number; // max backward step (m) between frames
  maxErr: number; // max |rendered - true(renderAt)| (m)
}

/** Drive a buffer through a 60 fps render loop against a 30 Hz patch feed
 *  moving +x at v m/s, with network gaps ([start,end) ms windows where no
 *  patch arrives — the wire holds the stale value, as in reality). */
function probe(buf: LegacySnapBuf | SnapBuf, gaps: [number, number][], v: number, durMs = 2200): Probe {
  let wireX = 0;
  let wireAt = 0;
  let nextPatch = 0;
  let prev: { x: number; z: number } | null = null;
  const res: Probe = { maxSpeed: 0, minSpeedInGap: Infinity, maxBackStep: 0, maxErr: 0 };
  const shortGap = gaps[0];
  const moveStart = 40; // entity starts walking at t=40 ms (first patch)
  for (let t = 0; t <= durMs; t += FPS_MS) {
    while (nextPatch <= t) {
      const inGap = gaps.some(([a, b]) => nextPatch >= a && nextPatch < b);
      if (!inGap) {
        wireX = v * ((nextPatch - moveStart) / 1000);
        wireAt = nextPatch;
      }
      nextPatch += PATCH_MS;
    }
    buf.push(wireAt, wireX, 0, 0);
    const s = buf.sample(t - DELAY_MS);
    if (!s || t < 250) continue; // skip priming
    const truth = v * Math.max(0, t - DELAY_MS - moveStart) / 1000;
    if (prev) {
      const step = s.x - prev.x;
      const speed = (step / FPS_MS) * 1000;
      res.maxSpeed = Math.max(res.maxSpeed, speed);
      res.maxBackStep = Math.min(res.maxBackStep, step);
    }
    if (shortGap && t >= shortGap[0] + 40 && t <= shortGap[1]) {
      const step = prev ? s.x - prev.x : 0;
      res.minSpeedInGap = Math.min(res.minSpeedInGap, (step / FPS_MS) * 1000);
    }
    res.maxErr = Math.max(res.maxErr, Math.abs(s.x - truth));
    prev = { x: s.x, z: s.z };
  }
  return res;
}

describe("remote-entity interpolation buffer", () => {
  test("rides a 150 ms jitter gap: keeps moving, no rubber band, stays accurate", () => {
    // v = 3.5 m/s ≈ Caretaker chase speed. Gap at [800,950): pre-fix the
    // render clock overran the newest snapshot at +120 ms and froze on the
    // stale raw value (speed -> 0), then fast-forwarded.
    const buf = new SnapBuf();
    const r = probe(buf, [[800, 950]], 3.5);
    expect(r.minSpeedInGap).toBeGreaterThan(0.7 * 3.5); // kept moving through the gap
    expect(r.maxSpeed).toBeLessThan(1.45 * 3.5); // no fast-forward catch-up
    expect(r.maxBackStep).toBeGreaterThan(-0.002); // never snapped backward
    expect(r.maxErr).toBeLessThan(0.2); // within a few patches of truth
  });

  test("pre-fix algorithm reproduces the rubber band (regression proof)", () => {
    const legacy = new LegacySnapBuf();
    const r = probe(legacy, [[800, 950]], 3.5);
    expect(r.minSpeedInGap).toBeLessThan(0.5); // froze mid-gap: the reported bug
  });

  test("long stall (350 ms) stays bounded instead of drifting half a meter", () => {
    const buf = new SnapBuf();
    const r = probe(buf, [[800, 1150]], 3.5);
    // bounded ride; after a blackout this long the re-entry lands with a
    // single ~0.5 m pop (extrapolation capped at 120 ms) — accepted, the
    // pre-fix version froze 263 ms then popped ~1 m. No speed assertion
    // here: the pop is one frame of high frame-rate, by design.
    expect(r.maxErr).toBeLessThan(0.6);
  });

  test("steady feed tracks truth within half a patch displacement", () => {
    const buf = new SnapBuf();
    const r = probe(buf, [], 3);
    expect(r.maxErr).toBeLessThan(0.5 * 3 * (PATCH_MS / 1000));
    expect(r.maxBackStep).toBeGreaterThan(-0.002);
  });

  test("extrapolation is bounded: a dead feed never runs away", () => {
    const buf = new SnapBuf();
    const v = 4;
    for (let t = 0; t <= 500; t += PATCH_MS) {
      buf.push(t, v * (t / 1000), 0, 0);
    }
    const last = v * 0.5;
    let worst = 0;
    // render time reaches the feed-stop point only after one delay has
    // elapsed; before that the buffer is still rendering pre-stop history
    for (let t = 500 + DELAY_MS; t <= 2500; t += FPS_MS) {
      const s = buf.sample(t - DELAY_MS)!;
      worst = Math.max(worst, Math.abs(s.x - last));
    }
    // holds at most EXTRAP_MAX_MS of velocity past the final snapshot
    expect(worst).toBeLessThanOrEqual((EXTRAP_MAX_MS / 1000) * v + 0.02);
  });

  test("stationary feed keeps timestamps fresh: zero drift, zero phantom velocity", () => {
    const buf = new SnapBuf();
    for (let t = 0; t <= 800; t += PATCH_MS) buf.push(t, 5, 5, 0.7);
    let prevX = NaN;
    for (let t = 800; t <= 1400; t += FPS_MS) {
      const s = buf.sample(t - DELAY_MS)!;
      expect(Math.abs(s.x - 5)).toBeLessThan(0.001);
      if (!Number.isNaN(prevX)) expect(Math.abs(s.x - prevX)).toBeLessThan(0.0005);
      prevX = s.x;
    }
  });

  test("teleport resets history (no smear across the jump)", () => {
    const buf = new SnapBuf();
    for (let t = 0; t <= 400; t += PATCH_MS) buf.push(t, t / 1000, 0, 0);
    buf.push(500, 20, 0, 0); // > 2.5 m jump
    buf.push(533, 20.05, 0, 0);
    const s = buf.sample(500 - DELAY_MS)!;
    expect(s.x).toBeGreaterThan(15); // renders post-jump data only
  });

  test("yaw interpolates the short way across the wrap", () => {
    const buf = new SnapBuf();
    buf.push(0, 0, 0, 3.1);
    buf.push(33, 0, 0, -3.1);
    const s = buf.sample(16)!;
    expect(Math.abs(s.yaw)).toBeGreaterThan(3); // through ±PI, not through 0
  });
});
