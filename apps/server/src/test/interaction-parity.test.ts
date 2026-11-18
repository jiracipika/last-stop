import { expect, it } from "vitest";
import { CART, DOORS, PLAYER, TICK_DT, VAN, circleVsAabb } from "@last-stop/shared";
import { World } from "../sim/world.js";

function setup() {
  const world = new World();
  world.modifiersOverride = [];
  const player = world.addPlayer("crew", "Crew", 0, true);
  world.startMission();
  world.setPhase("scavenge");
  return { world, player };
}

it("releases a held handbrake and does not turn it into a jump on exit", () => {
  const { world, player } = setup();
  Object.assign(player.body, world.cartPoint(CART.SEATS[0]));
  expect(world.tryEnterCart(player, true)).toBe(true);
  world.setMoveInput(player, { mz: 1, brake: true });
  for (let i = 0; i < 24; i++) world.step(TICK_DT);
  expect(world.cart.speed).toBe(0);
  world.setMoveInput(player, { mz: 1, brake: false });
  for (let i = 0; i < 24; i++) world.step(TICK_DT);
  expect(world.cart.speed).toBeGreaterThan(1.5);
  expect(world.exitSeat(player)).toBe(false);
  world.setMoveInput(player, { mz: 0, brake: true });
  for (let i = 0; i < 24; i++) world.step(TICK_DT);
  expect(world.exitSeat(player)).toBe(true);
  world.step(TICK_DT);
  expect(player.body.y).toBe(0);
});

it("uses the other side of the van when the driver's side is blocked", () => {
  const { world, player } = setup();
  Object.assign(world.van, { x: 1, z: 9, yaw: 0, speed: 0 });
  Object.assign(player.body, world.vanPoint(VAN.DRIVER_POINT));
  expect(world.tryEnterVan(player, true)).toBe(true);
  // Park another vehicle alongside the cab after boarding.
  Object.assign(world.cart, { x: -0.74, z: 10, yaw: 0 });
  expect(world.exitSeat(player)).toBe(true);
  expect(player.body.x).toBeGreaterThan(world.van.x);
  expect(world.playerColliders().some(box => circleVsAabb(player.body.x, player.body.z, PLAYER.RADIUS, box).hit)).toBe(false);
});

it("revives the teammate named by the held interaction", () => {
  const { world, player } = setup();
  const first = world.addPlayer("first", "First", 1, false);
  const aimed = world.addPlayer("aimed", "Aimed", 2, false);
  Object.assign(player.body, { x: -1, z: 6 });
  Object.assign(first.body, { x: -1.75, z: 6 });
  Object.assign(aimed.body, { x: -0.25, z: 6 });
  world.damagePlayer(first, 999, "test");
  world.damagePlayer(aimed, 999, "test");
  world.setMoveInput(player, { interact: true, interactKind: "revive", interactTarget: aimed.sid });
  for (let i = 0; i <= Math.ceil(PLAYER.REVIVE_TIME / TICK_DT); i++) world.step(TICK_DT);
  expect(first.downed).toBe(true);
  expect(aimed.downed).toBe(false);
});

it("a closed motel door blocks revive progress", () => {
  const { world, player } = setup();
  const other = world.addPlayer("other", "Other", 1, false);
  const door = DOORS[0]!;
  Object.assign(player.body, { x: door.cx, z: door.cz + 0.75 });
  Object.assign(other.body, { x: door.cx, z: door.cz - 0.75 });
  world.damagePlayer(other, 999, "test");
  world.setMoveInput(player, { interact: true, interactKind: "revive", interactTarget: other.sid });
  world.step(TICK_DT);
  expect(player.interactT).toBe(0);
  expect(world.toggleDoor(player, door.id)).toBe(true);
  world.step(TICK_DT);
  expect(player.interactT).toBeGreaterThan(0);
  expect(world.toggleDoor(player, door.id)).toBe(true);
  world.step(TICK_DT);
  expect(player.interactT).toBe(0);
});
