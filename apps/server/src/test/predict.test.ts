// Client prediction reconciliation: the predictor's ring is tagged with the
// seq of the input snapshot actually SENT (one counter, shared with the
// wire). The old per-frame ++seq outran the 20 Hz network seq, fell out of
// the ring's history window after ~5 s, and every patch hard-snapped the
// local player to a stale authoritative position — the permanent rubber-band.
// These tests import the real Predictor from the web app (it has no DOM deps)
// and drive it at the engine's cadence: 60 fps sim, 20 Hz sends, 30 Hz
// patches whose ack lags the newest send by ~100 ms.
import { describe, expect, it } from "vitest";
import { PLAYER, CARRY, stepPlayer, type Body, type MoveInput } from "@last-stop/shared";
import { Predictor } from "../../../web/src/game/predict.js";
import { World } from "../sim/world.js";

const NO_COLLIDE: Parameters<typeof stepPlayer>[4] = [];

describe("predictor input-seq reconciliation", () => {
  it("soft-corrects (not hard-snaps) minutes into a session", () => {
    const pred = new Predictor(() => NO_COLLIDE);
    // simulated authoritative body: same stepper, but the server clamps the
    // strafe axis, so the two simulations genuinely diverge
    const server: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true };
    const input: MoveInput & { interact: boolean } = { mx: 1, mz: 0.8, yaw: 0.3, sprint: true, jump: false, interact: false };
    const clamped = { ...input, mx: 0.5 };

    let sendSeq = 0;
    const FRAME = 1 / 60;
    const SEND_EVERY = 3; // 60 fps / 20 Hz
    const PATCH_EVERY = 2; // 30 Hz
    let frame = 0;
    let ackedSeq = 0;
    let lastServerPos = { x: 0, z: 0 };
    let probe: { errBefore: number; errAfter: number } | null = null;

    const runSeconds = (seconds: number, probeAt: number) => {
      const frames = Math.round(seconds / FRAME);
      for (let i = 0; i < frames; i++) {
        pred.step(FRAME, input, PLAYER.SPRINT);
        frame++;
        if (frame % SEND_EVERY === 0) {
          sendSeq += 1;
          pred.inputSeq = sendSeq;
          // the server consumes the snapshot two sends later (≈100 ms)
          if (sendSeq > 2) ackedSeq = sendSeq - 2;
        }
        if (frame % PATCH_EVERY === 0) {
          // authoritative sim at its own cadence
          for (let k = 0; k < 2; k++) stepPlayer(server, clamped, 1 / 60, PLAYER.SPRINT, NO_COLLIDE);
          lastServerPos = { x: server.x, z: server.z };
          const errBefore = Math.hypot(server.x - pred.body.x, server.z - pred.body.z);
          pred.reconcile(server.x, server.z, ackedSeq);
          const errAfter = Math.hypot(server.x - pred.body.x, server.z - pred.body.z);
          if (frame === probeAt) probe = { errBefore, errAfter };
        }
      }
    };

    runSeconds(1, 50); // probe at t ≈ 0.8 s: inside the old ring window too
    expect(probe).not.toBeNull();
    const early = probe!;
    expect(early.errBefore).toBeGreaterThan(0.1); // divergence is real
    expect(early.errBefore).toBeLessThan(3); // ...but not teleport-class
    // soft path: a partial correction, most of the error survives one patch
    expect(early.errAfter).toBeGreaterThan(early.errBefore * 0.5);

    runSeconds(14, 1700); // continue to t ≈ 29 s total
    // probe taken near the end: the old code was hard-snapping by now (ring
    // miss every patch); the fixed tags keep the soft path alive forever
    expect(probe).not.toBeNull();
    const late = probe!;
    expect(late.errBefore).toBeGreaterThan(0.1);
    expect(late.errBefore).toBeLessThan(3);
    expect(late.errAfter).toBeGreaterThan(late.errBefore * 0.5);
    // and the render offset stays inside its advertised clamp
    expect(Math.abs(pred.visX)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(pred.visZ)).toBeLessThanOrEqual(1.5);
    void lastServerPos;
  });

  it("teleport-class corrections still hard-cut", () => {
    const pred = new Predictor(() => NO_COLLIDE);
    pred.step(1 / 60, { mx: 0, mz: 0, yaw: 0, sprint: false, jump: false, interact: false }, PLAYER.WALK);
    pred.inputSeq = 1;
    pred.step(1 / 60, { mx: 0, mz: 0, yaw: 0, sprint: false, jump: false, interact: false }, PLAYER.WALK);
    pred.reconcile(20, 5, 1); // spawn-in class jump
    expect(pred.body.x).toBe(20);
    expect(pred.visX).toBe(0);
  });

  it("matches authoritative speed when sprint is held while hauling a body", () => {
    const w = new World();
    const p = w.addPlayer("hauler", "Hauler", 0, true);
    const fallen = w.addPlayer("fallen", "Fallen", 1, false);
    w.modifiersOverride = [];
    w.startMission();
    w.phase = "scavenge";
    fallen.dead = true;
    Object.assign(fallen.body, { x: p.body.x + 0.5, z: p.body.z });
    expect(w.tryLiftBody(p, fallen.sid)).toBe(true);
    Object.assign(p.input, { mz: 1, sprint: true });
    const speed = w.effectiveSpeed(p);
    w.syncAll();
    const pred = new Predictor(() => []);
    expect(pred.speedFor(w.state, p.sid, p.input)).toBeCloseTo(speed);
    expect(speed).toBeCloseTo(PLAYER.WALK * (1 - CARRY.BODY_WEIGHT * CARRY.SPEED_PENALTY_PER_WEIGHT));
  });
});

