// Shared deterministic simulation steps.
// The server runs these authoritatively at a fixed 30 Hz; the client runs the
// same code for local prediction. Everything is kinematic with hard caps —
// no unbounded forces, ever.

import { PLAYER, CARRY, VAN, CART, ENEMY } from "./constants.js";
import { clamp, damp, circleVsAabb, angleDiff, type AABB } from "./math.js";

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
}

export interface MoveInput {
  mx: number; // strafe (-1..1, local)
  mz: number; // forward (-1..1, local)
  yaw: number;
  sprint: boolean;
  jump: boolean;
}

/** Integrate one player step. wish speed is passed in so carry penalties apply. */
export function stepPlayer(
  b: Body,
  input: MoveInput,
  dt: number,
  speed: number,
  colliders: AABB[],
  radius = PLAYER.RADIUS,
): { jumped: boolean } {
  let jumped = false;
  // Local -> world: forward (0,1) maps to (sin yaw, cos yaw), strafe (1,0)
  // maps to the player's right (-cos yaw, sin yaw)
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = input.mz * sin - input.mx * cos;
  let wz = input.mz * cos + input.mx * sin;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) {
    wx /= wl;
    wz /= wl;
  } else {
    wx = 0;
    wz = 0;
  }
  const tvx = wx * speed;
  const tvz = wz * speed;
  const k = damp(PLAYER.ACCEL_RATE, dt);
  b.vx += (tvx - b.vx) * k;
  b.vz += (tvz - b.vz) * k;

  if (input.jump && b.grounded) {
    b.vy = PLAYER.JUMP_V;
    b.grounded = false;
    jumped = true;
  }
  b.vy -= PLAYER.GRAVITY * dt;
  b.vy = clamp(b.vy, -20, PLAYER.JUMP_V + 0.1);

  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.y += b.vy * dt;

  if (b.y <= 0) {
    b.y = 0;
    b.vy = 0;
    b.grounded = true;
  } else {
    b.grounded = false;
  }

  resolveCircle(b, radius, colliders);
  // world bounds safety net
  b.x = clamp(b.x, -69, 33.5);
  b.z = clamp(b.z, -25.5, 25.5);
  return { jumped };
}

export function resolveCircle(b: Body, radius: number, colliders: AABB[]): void {
  for (const c of colliders) {
    const r = circleVsAabb(b.x, b.z, radius, c);
    if (r.hit) {
      b.x = r.x;
      b.z = r.z;
      // kill velocity into the surface
      const into = b.vx * r.nx + b.vz * r.nz;
      if (into < 0) {
        b.vx -= r.nx * into;
        b.vz -= r.nz * into;
      }
    }
  }
}

/** Carry speed factor from assigned weight (share of item weight per carrier). */
export function carrySpeedFactor(weight: number): number {
  return Math.max(CARRY.MIN_SPEED_FACTOR, 1 - weight * CARRY.SPEED_PENALTY_PER_WEIGHT);
}

// ---------------------------------------------------------------------------
// Free (dropped/thrown) items — simple ballistic + collision, capped.
// ---------------------------------------------------------------------------
export function stepFreeItem(
  b: Body,
  dt: number,
  restY: number,
  radius: number,
  colliders: AABB[],
): { impact: number; rested: boolean } {
  const preVy = b.vy;
  b.vy -= 14 * dt; // slightly heavier gravity for snappy feel
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  if (sp > CARRY.MAX_ITEM_SPEED) {
    const s = CARRY.MAX_ITEM_SPEED / sp;
    b.vx *= s;
    b.vy *= s;
    b.vz *= s;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  let impact = 0;
  // ground
  if (b.y <= restY) {
    b.y = restY;
    if (b.vy < -0.8) impact = Math.max(impact, -b.vy);
    // friction + small bounce
    if (b.vy < -2.5) {
      b.vy = -b.vy * 0.22;
    } else {
      b.vy = 0;
    }
    const f = Math.exp(-6 * dt);
    b.vx *= f;
    b.vz *= f;
    b.grounded = true;
  } else {
    b.grounded = false;
  }
  // walls
  for (const c of colliders) {
    const r = circleVsAabb(b.x, b.z, radius, c);
    if (r.hit) {
      b.x = r.x;
      b.z = r.z;
      const into = b.vx * r.nx + b.vz * r.nz;
      if (into < 0) {
        impact = Math.max(impact, -into);
        b.vx -= r.nx * into * 1.3; // slight bounce
        b.vz -= r.nz * into * 1.3;
      }
    }
  }
  // ceiling-ish cap & bounds
  b.y = Math.min(b.y, 3.4);
  b.x = clamp(b.x, -69, 33.5);
  b.z = clamp(b.z, -25.5, 25.5);

  const rested = b.grounded && Math.hypot(b.vx, b.vz) < 0.25 && Math.abs(preVy) < 0.2;
  return { impact, rested };
}

// ---------------------------------------------------------------------------
// Van / cart — arcade kinematic controller.
// ---------------------------------------------------------------------------
export interface VanBody {
  x: number;
  z: number;
  yaw: number;
  speed: number; // signed m/s along forward
}

export interface VanInput {
  throttle: number; // -1..1
  steer: number; // -1..1
  handbrake: boolean;
}

/** Tuning for stepVehicle: every knob the van and the golf cart differ on. */
export interface VehicleCfg {
  HALF_W: number;
  HALF_L: number;
  ACCEL: number;
  REVERSE_ACCEL: number;
  MAX_SPEED: number;
  MAX_REVERSE: number;
  BRAKE: number;
  DRAG: number;
  STEER_RATE: number;
  /** world clamp box (the van may exit west onto the road; the cart may not) */
  BOUNDS: { x0: number; x1: number; z0: number; z1: number };
}

export const VAN_CFG: VehicleCfg = {
  HALF_W: VAN.HALF_W,
  HALF_L: VAN.HALF_L,
  ACCEL: VAN.ACCEL,
  REVERSE_ACCEL: VAN.REVERSE_ACCEL,
  MAX_SPEED: VAN.MAX_SPEED,
  MAX_REVERSE: VAN.MAX_REVERSE,
  BRAKE: VAN.BRAKE,
  DRAG: VAN.DRAG,
  STEER_RATE: VAN.STEER_RATE,
  BOUNDS: { x0: -68.5, x1: 33, z0: -25, z1: 25 },
};

export const CART_CFG: VehicleCfg = {
  HALF_W: CART.HALF_W,
  HALF_L: CART.HALF_L,
  ACCEL: CART.ACCEL,
  REVERSE_ACCEL: CART.REVERSE_ACCEL,
  MAX_SPEED: CART.MAX_SPEED,
  MAX_REVERSE: CART.MAX_REVERSE,
  BRAKE: CART.BRAKE,
  DRAG: CART.DRAG,
  STEER_RATE: CART.STEER_RATE,
  BOUNDS: { ...CART.BOUNDS },
};

/** One kinematic step for any VehicleCfg body (van, golf cart, …). */
export function stepVehicle(
  v: VanBody,
  input: VanInput,
  dt: number,
  colliders: AABB[],
  cfg: VehicleCfg,
): { impact: number } {
  const accelerating = input.throttle > 0.05;
  const braking = input.throttle < -0.05;
  if (accelerating) v.speed += cfg.ACCEL * input.throttle * dt;
  else if (braking) {
    if (v.speed > 0.1) v.speed -= cfg.BRAKE * dt; // brake
    else v.speed = Math.max(-cfg.MAX_REVERSE, v.speed - cfg.REVERSE_ACCEL * dt); // reverse
  }
  if (input.handbrake) {
    const s = Math.sign(v.speed);
    v.speed -= s * cfg.BRAKE * 1.4 * dt;
    if (Math.sign(v.speed) !== s) v.speed = 0;
  }
  // drag
  v.speed *= Math.exp(-cfg.DRAG * dt);
  v.speed = clamp(v.speed, -cfg.MAX_REVERSE, cfg.MAX_SPEED);

  // steering scales down at speed for stability
  const steerAmount = input.steer * cfg.STEER_RATE * (1 / (1 + Math.abs(v.speed) * 0.045));
  v.yaw += steerAmount * clamp(v.speed / 3, -1, 1) * dt * 2.2;

  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const nx = v.x + fx * v.speed * dt;
  const nz = v.z + fz * v.speed * dt;

  // body collision: sample 3 circles along the length
  let impact = 0;
  let px = nx;
  let pz = nz;
  let hitNormal: { x: number; z: number } | null = null;
  for (const off of [-cfg.HALF_L * 0.7, 0, cfg.HALF_L * 0.7]) {
    const cx = nx + fx * off;
    const cz = nz + fz * off;
    for (const c of colliders) {
      const r = circleVsAabb(cx, cz, cfg.HALF_W + 0.25, c);
      if (r.hit) {
        px += r.x - cx;
        pz += r.z - cz;
        hitNormal = { x: r.nx, z: r.nz };
      }
    }
  }
  if (hitNormal) {
    const into = fx * hitNormal.x + fz * hitNormal.z;
    if (Math.abs(v.speed) > 1.2) impact = Math.abs(v.speed);
    // kill velocity into the wall, scrape the rest
    if (into * v.speed > 0) {
      v.speed *= -0.12;
    } else {
      v.speed *= 0.5;
    }
  }
  v.x = clamp(px, cfg.BOUNDS.x0, cfg.BOUNDS.x1);
  v.z = clamp(pz, cfg.BOUNDS.z0, cfg.BOUNDS.z1);
  return { impact };
}

export function stepVan(
  v: VanBody,
  input: VanInput,
  dt: number,
  colliders: AABB[],
): { impact: number } {
  return stepVehicle(v, input, dt, colliders, VAN_CFG);
}

/** Convert a local-space van offset to world coordinates. */
export function vanLocalToWorld(v: VanBody, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(v.yaw);
  const c = Math.cos(v.yaw);
  return { x: v.x + lx * c + lz * s, z: v.z - lx * s + lz * c };
}

export function vanWorldToLocal(v: VanBody, wx: number, wz: number): { x: number; z: number } {
  const s = Math.sin(v.yaw);
  const c = Math.cos(v.yaw);
  const dx = wx - v.x;
  const dz = wz - v.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

// ---------------------------------------------------------------------------
// The Caretaker steering helper (used by the server AI).
// ---------------------------------------------------------------------------
export function moveToward(
  x: number,
  z: number,
  yaw: number,
  tx: number,
  tz: number,
  speed: number,
  dt: number,
  colliders: AABB[],
): { x: number; z: number; yaw: number; arrived: boolean; blocked: boolean } {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(dx, dz);
  yaw += angleDiff(yaw, targetYaw) * Math.min(1, 10 * dt);
  if (d < 0.15) return { x, z, yaw, arrived: true, blocked: false };
  const nx = x + (dx / d) * speed * dt;
  const nz = z + (dz / d) * speed * dt;
  // slide along colliders with a generous radius (should rarely trigger: the
  // AI walks nav edges that are pre-cleared)
  const fake: Body = { x: nx, z: nz, y: 0, vx: 0, vy: 0, vz: 0, grounded: true };
  resolveCircle(fake, 0.45, colliders);
  // Measure progress from the start, not the collision correction. The old
  // test called every unobstructed step "blocked", triggering stuck teleports.
  const progress = ((fake.x - x) * dx + (fake.z - z) * dz) / d;
  return {
    x: fake.x,
    z: fake.z,
    yaw,
    arrived: d < 0.35,
    blocked: progress < speed * dt * 0.25,
  };
}

export { ENEMY };
