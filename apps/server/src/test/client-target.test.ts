// Runs the real, DOM-free targeting method without constructing WebGL.
import { expect, it } from "vitest";
import { DOORS, ITEM_DEFS } from "@last-stop/shared";
import { World } from "../sim/world.js";
import { Engine } from "../../../web/src/game/engine.js";

it("offers the closed door instead of unreachable loot behind it", () => {
  const w = new World();
  const p = w.addPlayer("player", "Player", 0, true);
  w.modifiersOverride = [];
  w.startMission(); w.phase = "scavenge";
  const door = DOORS[0]!;
  const item = [...w.items.values()].find(i => ITEM_DEFS[i.defId]!.weight <= 2)!;
  Object.assign(p.body, { x: door.cx, z: door.cz + 0.3 });
  Object.assign(item.body, { x: door.cx, z: door.cz - 0.3 });
  w.syncAll();
  const e = Object.assign(Object.create(Engine.prototype), {
    inputInstance: { yaw: Math.PI },
    predictor: { renderX: () => p.body.x, renderZ: () => p.body.z },
    net: { sid: p.sid },
  });
  e.scanTarget(w.state, w.state.players.get(p.sid));
  expect(e.target.kind).toBe("door");
  expect(e.target.id).toBe(door.id);
  w.doors.get(door.id)!.open = true;
  w.state.doors.get(door.id)!.open = true;
  e.scanTarget(w.state, w.state.players.get(p.sid));
  expect(["item", "itemHands"]).toContain(e.target.kind);
  expect(e.target.id).toBe(item.id);
});
