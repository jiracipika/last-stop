// Runs the real, DOM-free targeting method without constructing WebGL.
import { expect, it, vi } from "vitest";
import { DOORS, ITEM_DEFS, SEAT, TICK_DT } from "@last-stop/shared";
import { World } from "../sim/world.js";
import { Engine } from "../../../web/src/game/engine.js";
import { InputManager } from "../../../web/src/game/input.js";

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

function setup() {
  const world = new World();
  world.modifiersOverride = [];
  const player = world.addPlayer("crew", "Crew", 0, true);
  world.startMission();
  world.setPhase("scavenge");
  return { world, player };
}

it("offers hand carry for small loose items when all pack slots are full", () => {
  const { world, player } = setup();
  const item = [...world.items.values()].find((it) => ITEM_DEFS[it.defId]!.weight <= 2)!;
  Object.assign(player.body, { x: 0, z: 5 });
  Object.assign(item.body, { x: 0, z: 6 });
  player.slots.fill("occupied");
  world.syncAll();
  const engine = Object.assign(Object.create(Engine.prototype), {
    inputInstance: { yaw: 0 },
    predictor: { renderX: () => player.body.x, renderZ: () => player.body.z },
    net: { sid: player.sid },
  });
  engine.scanTarget(world.state, world.state.players.get(player.sid));
  expect(engine.target).toMatchObject({ kind: "itemHands", id: item.id });
  expect(engine.target.label).toContain("pack full");
  expect(world.tryGrab(player, item.id)).toBe(true);
});

it("shows the driver the cart turn while preserving mouse look around the seat", () => {
  const { world, player } = setup();
  player.seat = SEAT.CART_DRIVER;
  world.syncAll();
  const input = { yaw: 0, pitch: 0 };
  const engine = Object.assign(Object.create(Engine.prototype), {
    inputInstance: input,
    predictor: { renderX: () => 0, renderZ: () => 0 },
    net: { sid: player.sid },
    camera: { fov: 72, updateProjectionMatrix() {}, position: { set() {} }, rotation: { set() {} } },
    cartBuf: { sample: () => null },
    settings: { shake: false },
    cameraSeat: 0,
    fovPunch: 0,
  });
  world.state.cart.yaw = 1;
  engine.updateCamera(TICK_DT, 0, world.state, 0);
  expect(input.yaw).toBeCloseTo(1);
  input.yaw += 0.15;
  world.state.cart.yaw = 1.5;
  engine.updateCamera(TICK_DT, 0, world.state, 0);
  expect(input.yaw).toBeCloseTo(1.65);
});


it("ignores a delayed origin warp on pointer lock and still accepts real look motion", () => {
  const fakeWindow = new EventTarget();
  const canvas = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { pointerLockElement: null as EventTarget | null });
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  const input = new InputManager(canvas as HTMLElement);
  const move = (x: number, y: number, dx: number, dy: number) =>
    fakeWindow.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: y, movementX: dx, movementY: dy }));
  try {
    move(550, 360, 550, 360);
    fakeDocument.pointerLockElement = canvas;
    fakeDocument.dispatchEvent(new Event("pointerlockchange"));
    move(550, 360, 0, 0);
    move(550, 360, -550, -360);
    expect(input.yaw).toBe(Math.PI);
    expect(input.pitch).toBe(0);
    move(550, 360, 10, -5);
    expect(input.yaw).toBeCloseTo(Math.PI - 0.022);
    expect(input.pitch).toBeCloseTo(0.011);

    input.keys.add("KeyW");
    input.mouseRight = true;
    input.jumpQueued = true;
    fakeWindow.dispatchEvent(new Event("blur"));
    expect(input.frame()).toMatchObject({ mz: 0, jump: false, stabilize: false });
  } finally {
    input.dispose();
    vi.unstubAllGlobals();
  }
});
