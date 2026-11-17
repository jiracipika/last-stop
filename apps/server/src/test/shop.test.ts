// The gas-station stop: per-player lobby budget, coffee and flashlight.
import { describe, expect, it } from "vitest";
import { SHOP } from "@last-stop/shared";
import { World } from "../sim/world.js";

// stamina timing only — keep the Caretaker out of it
process.env.LS_DISABLE_ENEMY = "1";

function scene() {
  const w = new World();
  const p = w.addPlayer("crew", "Crew", 0, true);
  return { w, p };
}

describe("gas station shop", () => {
  it("everyone starts with the full allowance", () => {
    const { w, p } = scene();
    expect(p.budget).toBe(SHOP.BUDGET);
    expect(p.hasFlashlight).toBe(false);
    expect(p.caffeinated).toBe(false);
  });

  it("buys coffee and flashlight; prices force a choice (4+7 > 10)", () => {
    const { w, p } = scene();
    expect(w.tryBuy(p, "coffee")).toBe(true);
    expect(p.budget).toBe(SHOP.BUDGET - 4);
    expect(p.caffeinated).toBe(true);
    expect(w.tryBuy(p, "flashlight")).toBe(false); // 6 < 7
    expect(w.events.some((e) => e.t === "deny" && e.k === "broke")).toBe(true);
    expect(p.hasFlashlight).toBe(false);
  });

  it(" flashlight buyer can afford it alone and toggles it", () => {
    const { w, p } = scene();
    expect(w.tryBuy(p, "flashlight")).toBe(true);
    expect(p.budget).toBe(SHOP.BUDGET - 7);
    expect(w.toggleFlashlight(p)).toBe(true);
    expect(p.flashlight).toBe(true);
  });

  it("the flashlight refuses to click without the purchase", () => {
    const { w, p } = scene();
    expect(w.toggleFlashlight(p)).toBe(false);
    expect(p.flashlight).toBe(false);
    expect(w.events.some((e) => e.t === "deny" && e.k === "noFlashlight")).toBe(true);
  });

  it("refuses duplicates and unknown items", () => {
    const { w, p } = scene();
    w.tryBuy(p, "coffee");
    expect(w.tryBuy(p, "coffee")).toBe(false);
    expect(w.tryBuy(p, "motorcycle")).toBe(false);
    expect(p.budget).toBe(SHOP.BUDGET - 4);
  });

  it("shopping is lobby-only", () => {
    const { w, p } = scene();
    w.phase = "briefing";
    expect(w.tryBuy(p, "coffee")).toBe(false);
    w.phase = "lobby";
    expect(w.tryBuy(p, "coffee")).toBe(true);
  });

  it("caffeine actually speeds stamina regen during the shift", () => {
    const { w, p } = scene();
    w.modifiersOverride = [];
    w.startMission();
    w.phase = "scavenge";
    p.stamina = 10;
    for (let i = 0; i < 30; i++) w.step(1 / 30); // 1 s of standing still
    const plain = p.stamina;
    p.caffeinated = true;
    p.stamina = 10;
    for (let i = 0; i < 30; i++) w.step(1 / 30);
    expect(p.stamina).toBeGreaterThan(plain + (plain - 10) * 0.5);
  });

  it("purchases carry into the shift and restock when it ends", () => {
    const { w, p } = scene();
    // coffee(4) + flashlight(7) = 11 > 10, so top up by hand for the carry
    // check — the point is persistence, not the pricing rule tested above
    w.tryBuy(p, "flashlight");
    p.budget += 10;
    w.tryBuy(p, "coffee");
    w.modifiersOverride = [];
    w.startMission();
    // survived startMission: the shop happens before the shift, not at it
    expect(p.hasFlashlight).toBe(true);
    expect(p.caffeinated).toBe(true);
    w.phase = "scavenge";
    w.finish("timeout");
    expect(p.budget).toBe(SHOP.BUDGET);
    expect(p.hasFlashlight).toBe(false);
    expect(p.caffeinated).toBe(false);
  });
});
