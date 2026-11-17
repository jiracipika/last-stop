// The lot golf cart: two seats, drives from shift start, stays lot-bound.
import { describe, expect, it } from "vitest";
import { CART, CART_START, SEAT, TICK_DT, VAN } from "@last-stop/shared";
import { World } from "../sim/world.js";

// pure vehicle physics: the Caretaker has its own dedicated test files
process.env.LS_DISABLE_ENEMY = "1";

function scene() {
  const w = new World();
  const p = w.addPlayer("driver", "Driver", 0, true);
  w.modifiersOverride = [];
  w.startMission();
  w.phase = "scavenge";
  return { w, p };
}

function drive(w: World, seconds: number, throttle: number, steer = 0) {
  for (const p of w.players.values()) {
    if (p.seat === SEAT.CART_DRIVER) {
      p.input.mz = throttle;
      p.input.mx = steer;
    }
  }
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) w.step(TICK_DT);
}

describe("golf cart", () => {
  it("spawns at the gas-station pumps and resets there each mission", () => {
    const { w } = scene();
    expect(w.cart.x).toBeCloseTo(CART_START.x, 5);
    expect(w.cart.z).toBeCloseTo(CART_START.z, 5);
    w.cart.x = 5;
    w.startMission();
    w.phase = "scavenge";
    expect(w.cart.x).toBeCloseTo(CART_START.x, 5);
  });

  it("boards the driver from beside the bench (no doors to open)", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    expect(w.tryEnterCart(p, true)).toBe(true);
    expect(p.seat).toBe(SEAT.CART_DRIVER);
    expect(w.cartDriver).toBe(p.sid);
  });

  it("holds exactly one driver and one passenger", () => {
    const { w, p } = scene();
    const q = w.addPlayer("mate", "Mate", 1, false);
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    q.body.x = w.cart.x + CART.HALF_W + 0.4;
    q.body.z = w.cart.z;
    expect(w.tryEnterCart(p, true)).toBe(true);
    expect(w.tryEnterCart(q, true)).toBe(false); // driver seat taken
    expect(w.tryEnterCart(q, false)).toBe(true);
    expect(q.seat).toBe(SEAT.CART_PASSENGER);
    const r = w.addPlayer("third", "Third", 2, false);
    r.body.x = w.cart.x;
    r.body.z = w.cart.z + CART.HALF_L + 0.4;
    expect(w.tryEnterCart(r, false)).toBe(false); // bench full
  });

  it("rejects boarding with hands full or while it moves", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    p.carrying = "whatever";
    expect(w.tryEnterCart(p, true)).toBe(false);
    p.carrying = "";
    w.cart.speed = 2;
    expect(w.tryEnterCart(p, true)).toBe(false);
    w.cart.speed = 0;
    expect(w.tryEnterCart(p, true)).toBe(true);
  });

  it("drives during scavenge (no repair) and moves the riders", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    w.tryEnterCart(p, true);
    const x0 = w.cart.x;
    drive(w, 2, 1); // spawn yaw faces east (+x)
    expect(Math.abs(w.cart.speed)).toBeGreaterThan(0.5);
    expect(Math.abs(w.cart.x - x0)).toBeGreaterThan(1);
    // driver follows the bench
    expect(p.body.x).toBeCloseTo(w.cart.x, 1);
  });

  it("caps its speed under the van's and never crosses the escape finish", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    w.tryEnterCart(p, true);
    // aim dead west at the gate and floor it for a long while
    w.cart.yaw = -Math.PI / 2; // forward = (sin,cos) = (-1, 0) = west
    w.cart.x = -20;
    w.cart.z = 11; // gate lane
    drive(w, 12, 1);
    expect(Math.abs(w.cart.speed)).toBeLessThanOrEqual(CART.MAX_SPEED + 0.01);
    expect(Math.abs(w.cart.speed)).toBeLessThan(VAN.MAX_SPEED);
    expect(w.cart.x).toBeGreaterThanOrEqual(CART.BOUNDS.x0);
    // no mission outcome fired from the cart's position
    expect(w.phase).toBe("scavenge");
  });

  it("the exit act hops out only when (nearly) stopped, either vehicle", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    w.tryEnterCart(p, true);
    drive(w, 1.5, 1);
    expect(w.exitSeat(p)).toBe(false); // rolling
    drive(w, 4, 0); // handbrake default (no input) stops it
    expect(Math.abs(w.cart.speed)).toBeLessThan(1.5);
    expect(w.exitSeat(p)).toBe(true);
    expect(p.seat).toBe(0);
    expect(w.cartDriver).toBe("");
  });

  it("players collide with the parked cart", () => {
    const { w, p } = scene();
    // walk a rider-less player into the cart from the west
    const box = w.cartAabb();
    const sameBox = (c: { x0: number; z0: number; x1: number; z1: number }) =>
      c.x0 === box.x0 && c.x1 === box.x1 && c.z0 === box.z0 && c.z1 === box.z1;
    expect(w.playerColliders().some(sameBox)).toBe(true);
    p.body.x = w.cart.x - CART.HALF_W - 0.3;
    p.body.z = w.cart.z;
    for (let i = 0; i < 90; i++) {
      p.input.mx = 0;
      p.input.mz = 1; // facing +z? orient properly: face east (+x)
      p.input.yaw = Math.PI / 2;
      w.step(TICK_DT);
    }
    expect(p.body.x).toBeLessThan(w.cart.x + CART.HALF_W);
    expect(w.cart.x).toBeCloseTo(CART_START.x, 3);
  });

  it("the van cannot phase through the parked cart", () => {
    const { w } = scene();
    const box = w.cartAabb();
    const sameBox = (c: { x0: number; z0: number; x1: number; z1: number }) =>
      c.x0 === box.x0 && c.x1 === box.x1 && c.z0 === box.z0 && c.z1 === box.z1;
    expect(w.vanColliders().some(sameBox)).toBe(true);
  });

  it("driving it emits periodic noise the Caretaker can hear", () => {
    const { w, p } = scene();
    p.body.x = w.cart.x - CART.HALF_W - 0.4;
    p.body.z = w.cart.z;
    w.tryEnterCart(p, true);
    const before = w.events.filter((e) => e.t === "noise").length;
    drive(w, 3, 1);
    const noises = w.events.filter((e) => e.t === "noise" && e.k === "cart").length;
    expect(noises).toBeGreaterThan(0);
    void before;
  });
});
