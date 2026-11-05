// Network state schema (Colyseus schema v5 builder API).
// Data-only classes; behavior lives on the server/client.

import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    nick: t.string(),
    color: t.uint8(),
    ready: t.boolean(),
    host: t.boolean(),
    connected: t.boolean(),
    // kinematics (authoritative; client predicts its own)
    x: t.float64(),
    y: t.float64(),
    z: t.float64(),
    yaw: t.float64(),
    pitch: t.float64(),
    vx: t.float64(),
    vz: t.float64(),
    inputSeq: t.uint32(),
    grounded: t.boolean(),
    hp: t.float64(),
    stamina: t.float64(),
    downed: t.boolean(),
    dead: t.boolean(),
    bleedAt: t.float64(), // server time when bleedout ends (0 = n/a)
    flashlight: t.boolean(),
    sprinting: t.boolean(),
    carrying: t.string(), // item id or ""
    seat: t.uint8(), // 0 = on foot, 1..4 van seats (1 = driver)
    driving: t.boolean(),
    // stats
    noiseScore: t.float64(),
    deliveredValue: t.float64(),
    deliveredCount: t.uint8(),
    rescues: t.uint8(),
    biggestLoss: t.float64(),
    lossItem: t.string(),
    downedCount: t.uint8(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ItemState = schema(
  {
    defId: t.string(),
    // 0 world, 1 carried, 2 stored in van, 3 consumed (installed/removed)
    state: t.uint8(),
    x: t.float64(),
    y: t.float64(),
    z: t.float64(),
    yaw: t.float64(),
    value: t.float64(),
    damage: t.float64(),
    h0: t.string(), // sessionId holding handle 0
    h1: t.string(), // sessionId holding handle 1
    secured: t.boolean(),
  },
  "ItemState",
);
export type ItemState = SchemaType<typeof ItemState>;

export const EnemyState = schema(
  {
    x: t.float64(),
    z: t.float64(),
    yaw: t.float64(),
    // 0 patrol, 1 investigate, 2 chase, 3 windup, 4 recover, 5 force-door
    ai: t.uint8(),
    forcing: t.string(), // door id being forced
    phase: t.uint8(), // escalation 1..3
  },
  "EnemyState",
);
export type EnemyState = SchemaType<typeof EnemyState>;

export const VanState = schema(
  {
    x: t.float64(),
    z: t.float64(),
    yaw: t.float64(),
    speed: t.float64(),
    doorsOpen: t.boolean(),
    lightsOn: t.boolean(),
    partInstalled: t.boolean(),
    strapped: t.boolean(),
    driver: t.string(),
    cargo: t.array("string"), // item ids stored inside
  },
  "VanState",
);
export type VanState = SchemaType<typeof VanState>;

export const MarkerState = schema(
  {
    kind: t.string(), // ping | quick | info
    text: t.string(),
    x: t.float64(),
    y: t.float64(),
    z: t.float64(),
    by: t.string(),
    at: t.float64(), // server clock seconds
  },
  "MarkerState",
);
export type MarkerState = SchemaType<typeof MarkerState>;

export const DoorState = schema(
  {
    id: t.string(),
    open: t.boolean(),
  },
  "DoorState",
);
export type DoorState = SchemaType<typeof DoorState>;

export const RoomState = schema(
  {
    phase: t.string(),
    code: t.string(),
    seed: t.uint32(),
    now: t.float64(), // server clock seconds (for timers)
    endsAt: t.float64(), // mission end time (server clock seconds, 0 = n/a)
    quota: t.float64(),
    lootTotal: t.float64(),
    salvage: t.float64(),
    escalation: t.uint8(),
    gateOpen: t.boolean(),
    modifiers: t.array("string"),
    outcome: t.string(), // "", "escaped", "timeout", "wipe"
    resultsJson: t.string(),
    players: t.map(PlayerState),
    items: t.map(ItemState),
    doors: t.map(DoorState),
    enemy: EnemyState,
    van: VanState,
    markers: t.array(MarkerState),
  },
  "RoomState",
);
export type RoomState = SchemaType<typeof RoomState>;
