// Central tuning values shared by the authoritative server and client prediction.

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;
// state broadcast rate: match the tick (30 Hz). The old 20 Hz patches were the
// stutter source — interpolation starves between 50 ms snapshots and the local
// player's reconcile waits a full 50 ms for fresh truth. Patch bytes are tiny.
export const PATCH_MS = 33;

// ---- Player movement (kinematic, deliberately gentle) ----
export const PLAYER = {
  RADIUS: 0.35,
  HEIGHT: 1.7,
  EYE: 1.55,
  WALK: 3.2,
  SPRINT: 5.2,
  ACCEL_RATE: 14, // exponential approach rate toward wish velocity
  STOP_SLIDE_RATE: 6, // per-second decay of coast velocity after input releases (~0.37 m slide at walk speed); MUST stay mirrored in web/src/game/predict.ts
  JUMP_V: 4.4,
  GRAVITY: 13,
  STAMINA_MAX: 100,
  STAMINA_DRAIN: 16, // per second while sprinting (moving)
  STAMINA_REGEN: 12, // per second while not sprinting
  STAMINA_MIN_TO_START: 15,
  INTERACT_RANGE: 2.4,
  GRAB_RANGE: 2.6,
  REVIVE_TIME: 5,
  DOWNED_BLEEDOUT: 60,
} as const;

// ---- Carrying ----
export const CARRY = {
  HOLD_DIST: 0.62, // item held in front of carrier
  HOLD_Y: 1.0,
  LEASH: 2.8, // max distance between carrier hold-point and item before slip
  SPEED_PENALTY_PER_WEIGHT: 0.085, // per assigned weight point
  MIN_SPEED_FACTOR: 0.42,
  SPRINT_MAX_WEIGHT: 2.5, // can only sprint when assigned weight below this
  THROW_V: 5.5,
  THROW_UP: 1.6,
  MAX_ITEM_SPEED: 9, // hard cap on any item velocity
  SOLO_HEAVY_FACTOR: 0.55, // weight multiplier for heavy items in solo mode
  STABILIZE_FACTOR: 0.45, // impact damage multiplier while stabilizing
} as const;

// ---- Impact / fragility ----
export const FRAGILE_IMPACT_V = 3.0; // impacts above this speed damage fragile items
export const FRAGILE_DPS = 26; // damage per (m/s over threshold)
export const WRECKED_AT = 100; // damage at which value floors out
export const WRECKED_VALUE_FACTOR = 0.1;

// ---- Noise radii (meters) emitted by gameplay events ----
export const NOISE = {
  WALK: 3.5,
  SPRINT: 9,
  DROP_LIGHT: 8,
  DROP_HEAVY: 14,
  BREAK: 18,
  DOOR: 5,
  HORN: 34,
  BELL: 12,
  HEADLIGHTS: 16, // pulses every few seconds while on
  VAN_BUMP: 16,
  FORCE_DOOR: 20,
  CAR_DOOR: 5.5,
} as const;

// ---- hiding in the junkers ----
export const HIDE = {
  /** how close to the stand point you must be to climb in */
  STAND_RANGE: 2.0,
} as const;

// ---- The Caretaker ----
export const ENEMY = {
  HEIGHT: 2.6,
  PATROL_SPEED: 2.1,
  INVESTIGATE_SPEED: 2.9,
  CHASE_SPEED: 4.55, // below player sprint (5.2) so escape is possible
  ATTACK_SPEED: 3.4, // closing in for windup
  VIEW_RANGE: 15,
  VIEW_FOV_COS: Math.cos((100 * Math.PI) / 180 / 2), // 100 deg cone
  ATTACK_RANGE: 1.7,
  STRIKE_RANGE: 2.1,
  STRIKE_ARC_COS: Math.cos((120 * Math.PI) / 180 / 2),
  WINDUP_TIME: 0.85,
  RECOVER_TIME: 1.5,
  LOSE_SIGHT_GRACE: 3.5,
  SEARCH_TIME: 6,
  HIT_DAMAGE: 65,
  DOOR_FORCE_BASE: 2.6, // seconds to force a closed door
  DOOR_FORCE_PER_PLAYER: 2.0, // extra seconds per player holding it
  NODE_PAUSE: 1.6, // average pause at patrol nodes
  NODE_PAUSE_JITTER: 1.2,
} as const;

// ---- Van (local frame: +z is FORWARD, -z is the rear doors) ----
export const VAN = {
  HALF_W: 1.05,
  HALF_L: 2.4,
  HEIGHT: 2.25,
  ACCEL: 6.5,
  REVERSE_ACCEL: 4,
  MAX_SPEED: 11.5,
  MAX_REVERSE: 4,
  BRAKE: 11,
  DRAG: 0.55,
  STEER_RATE: 1.35,
  CARGO: { X0: -0.95, X1: 0.95, Z0: -1.9, Z1: -0.1 }, // interior cargo bay
  // delivery zone: cargo bay + the strip behind the open rear doors
  LOAD_ZONE: { X0: -1.15, X1: 1.15, Z0: -3.3, Z1: -0.1 },
  SEATS: [
    { x: -0.42, z: 0.95 },
    { x: 0.42, z: 0.95 },
    { x: -0.42, z: 0.45 },
    { x: 0.42, z: 0.45 },
  ],
  ENGINE_POINT: { x: 0, z: 2.55 }, // local; install interaction (front)
  DOOR_POINT: { x: 0, z: -2.45 }, // local; rear doors interaction
  STRAP_POINT: { x: 1.15, z: -2.2 },
  BUMP_CARGO_DAMAGE: 14, // damage to unsecured cargo per significant bump
} as const;

// ---- Mission ----
export const MISSION = {
  TIME_S: 720, // 12 minutes
  ESCALATE_AT_S: [300, 540], // elapsed seconds -> escalation level 2, 3
  WIN_FINISH_X: -56,
  PULL_S: 2.6, // success end-beat: van pull-away showtime before results
  PULL_SPEED: 3.5, // pull-away speed (m/s along the van facing)
  RECONNECT_GRACE_S: 20,
  MAX_PLAYERS: 4,
} as const;

export const COLORS = [
  "#ffb347", // amber
  "#7fd4ff", // sky
  "#9dff8f", // mint
  "#ff8f9d", // coral
  "#d2a6ff", // lilac
  "#ffe66d", // lemon
  "#8fffe0", // seafoam
  "#ffae63", // tangerine
] as const;

export const QUICK_MESSAGES = [
  { id: "carry", label: "HELP CARRY" },
  { id: "enemy", label: "ENEMY HERE" },
  { id: "van", label: "BACK TO VAN" },
] as const;
