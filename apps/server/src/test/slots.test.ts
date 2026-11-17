// Body inventory: three stow slots for small loot. Heavy two-handle cargo and
// the distributor part stay hands-only; stowed loot loads at the open van
// rear and scatters if its hauler dies.
import { describe, expect, it } from "vitest";
import { CART_START, VAN } from "@last-stop/shared";
import { World } from "../sim/world.js";

function scene() {
  const w = new World();
  const p = w.addPlayer("crew", "Crew", 0, true);
  w.modifiersOverride = [];
  w.startMission();
  w.phase = "scavenge";
  return { w, p };
}

/** Spawn a specific def in the world right next to the player. */
function spawnAt(w: World, p: ReturnType<typeof scene>["p"], defId: string) {
  const id = `i${w.nextItemId++}`;
  const def = { toolbox: { restY: 0.22, radius: 0.32 }, vending: { restY: 0.85, radius: 0.55 }, distributor: { restY: 0.2, radius: 0.28 } }[defId]!;
  w.items.set(id, {
    id, defId,
    body: { x: p.body.x + 1, y: def.restY, z: p.body.z, vx: 0, vy: 0, vz: 0, grounded: true },
    state: 0, value: 10, damage: 0,
    h0: "", h1: "", lastH0: "", lastH1: "",
    yaw: 0, secured: false, sleeping: true, restTimer: 0, ringCd: 0,
  });
  return id;
}

describe("body inventory slots", () => {
  it("stows a small item into the active slot and marks it state 4", () => {
    const { w, p } = scene();
    const id = spawnAt(w, p, "toolbox");
    expect(w.tryStow(p, id)).toBe(true);
    expect(p.slots[0]).toBe(id);
    expect(p.slotSel).toBe(0);
    expect(w.items.get(id)!.state).toBe(4);
  });

  it("caps at three slots and denies a fourth with a packFull event", () => {
    const { w, p } = scene();
    for (let i = 0; i < 3; i++) {
      const id = spawnAt(w, p, "toolbox");
      expect(w.tryStow(p, id)).toBe(true);
    }
    const fourth = spawnAt(w, p, "toolbox");
    expect(w.tryStow(p, fourth)).toBe(false);
    expect(w.items.get(fourth)!.state).toBe(0);
    expect(w.events.some((e) => e.t === "deny" && e.k === "packFull")).toBe(true);
  });

  it("selects slots 0..2 only", () => {
    const { w, p } = scene();
    expect(w.selectSlot(p, 2)).toBe(true);
    expect(p.slotSel).toBe(2);
    expect(w.selectSlot(p, 3)).toBe(false);
    expect(w.selectSlot(p, -1)).toBe(false);
  });

  it("refuses heavy two-handle cargo and the distributor part", () => {
    const { w, p } = scene();
    const vending = spawnAt(w, p, "vending");
    expect(w.tryStow(p, vending)).toBe(false);
    expect(w.items.get(vending)!.state).toBe(0);
    const part = spawnAt(w, p, "distributor");
    expect(w.tryStow(p, part)).toBe(false);
  });

  it("cannot stow through a wall (no line of sight)", () => {
    const { w, p } = scene();
    // player in the front yard just south of room R1's closed front door,
    // item just north of it: inside grab range, but the door blocks LOS
    p.body.x = -18.5;
    p.body.z = -6.9;
    const id = `i${w.nextItemId++}`;
    w.items.set(id, {
      id, defId: "toolbox",
      body: { x: -18.5, y: 0.22, z: -9.1, vx: 0, vy: 0, vz: 0, grounded: true },
      state: 0, value: 10, damage: 0,
      h0: "", h1: "", lastH0: "", lastH1: "",
      yaw: 0, secured: false, sleeping: true, restTimer: 0, ringCd: 0,
    });
    const d = Math.abs(-6.9 - -9.1);
    expect(d).toBeLessThan(2.6); // close enough that RANGE is not the rejecter
    expect(w.tryStow(p, id)).toBe(false);
    expect(w.items.get(id)!.state).toBe(0);
  });

  it("dropSlot sets the active item back into the world in front of you", () => {
    const { w, p } = scene();
    const id = spawnAt(w, p, "toolbox");
    w.tryStow(p, id);
    p.yaw = 0; // facing +z
    const beforeZ = p.body.z;
    expect(w.dropSlot(p)).toBe(true);
    expect(p.slots[0]).toBe("");
    const it = w.items.get(id)!;
    expect(it.state).toBe(0);
    expect(it.body.z).toBeGreaterThan(beforeZ);
  });

  it("storeSlot loads the active item into the van with credit", () => {
    const { w, p } = scene();
    const id = spawnAt(w, p, "toolbox");
    w.tryStow(p, id);
    w.vanDoorsOpen = true;
    Object.assign(p.body, w.vanPoint(VAN.DOOR_POINT));
    const salvageBefore = w.salvage;
    expect(w.storeSlot(p)).toBe(true);
    expect(p.slots[0]).toBe("");
    expect(w.items.get(id)!.state).toBe(2);
    expect(w.salvage).toBeGreaterThan(salvageBefore);
    expect(p.deliveredCount).toBe(1);
  });

  it("storeSlot requires open van doors", () => {
    const { w, p } = scene();
    const id = spawnAt(w, p, "toolbox");
    w.tryStow(p, id);
    w.vanDoorsOpen = false;
    Object.assign(p.body, w.vanPoint(VAN.DOOR_POINT));
    expect(w.storeSlot(p)).toBe(false);
  });

  it("stowed items scatter into the world when the hauler dies", () => {
    const { w, p } = scene();
    const a = spawnAt(w, p, "toolbox");
    const b = spawnAt(w, p, "toolbox");
    w.tryStow(p, a);
    w.selectSlot(p, 1);
    w.tryStow(p, b);
    w.damagePlayer(p, 999, "strike"); // first big hit: DOWNED
    w.damagePlayer(p, 999, "strike"); // the follow-up while downed kills
    expect(p.dead).toBe(true);
    expect(p.slots).toEqual(["", "", ""]);
    for (const id of [a, b]) {
      const it = w.items.get(id)!;
      expect(it.state).toBe(0);
      expect(it.sleeping).toBe(false);
    }
  });

  it("cannot stow (or hands-grab) while hidden in a junker", () => {
    const { w, p } = scene();
    p.body.x = -8.1;
    p.body.z = 1.9;
    expect(w.tryHide(p, "carA")).toBe(true);
    // a small item within wire range of the hide spot must not be reachable
    const id = `i${w.nextItemId++}`;
    w.items.set(id, {
      id, defId: "toolbox",
      body: { x: -9.2, y: 0.22, z: 2.1, vx: 0, vy: 0, vz: 0, grounded: true },
      state: 0, value: 10, damage: 0,
      h0: "", h1: "", lastH0: "", lastH1: "",
      yaw: 0, secured: false, sleeping: true, restTimer: 0, ringCd: 0,
    });
    expect(w.tryStow(p, id)).toBe(false);
    expect(w.tryGrab(p, id)).toBe(false);
    expect(w.items.get(id)!.state).toBe(0);
  });

  it("hidden players can keep their pack (only hands block hiding)", () => {
    const { w, p } = scene();
    const id = spawnAt(w, p, "toolbox");
    w.tryStow(p, id);
    // stand at the sedan hide spot
    p.body.x = -8.1;
    p.body.z = 1.9;
    expect(w.tryHide(p, "carA")).toBe(true);
    expect(p.slots[0]).toBe(id);
  });

  it("stowed items do not slow the hauler (encumbrance stays hands-only)", () => {
    const { w, p } = scene();
    const bare = w.effectiveSpeed(p);
    for (let i = 0; i < 3; i++) w.tryStow(p, spawnAt(w, p, "toolbox"));
    expect(w.effectiveSpeed(p)).toBe(bare);
  });

  it("the golf cart spawn does not overlap the van spawn", () => {
    const { w } = scene();
    const d = Math.hypot(w.van.x - CART_START.x, w.van.z - CART_START.z);
    expect(d).toBeGreaterThan(10);
  });
});
