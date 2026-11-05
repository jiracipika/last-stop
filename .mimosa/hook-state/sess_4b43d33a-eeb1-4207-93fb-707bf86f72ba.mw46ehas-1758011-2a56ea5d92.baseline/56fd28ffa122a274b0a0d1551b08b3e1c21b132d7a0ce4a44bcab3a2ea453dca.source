// Shared math helpers used by both the authoritative server and client prediction.

export interface AABB {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential smoothing factor that is framerate independent. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const dist2d = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(ax - bx, az - bz);

export const dist2dsq = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Deterministic RNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Resolve a circle (player/item) against an axis-aligned box by pushing it out
 * along the smallest penetration axis. Returns corrected position + normal.
 */
export function circleVsAabb(
  px: number,
  pz: number,
  r: number,
  b: AABB,
): { x: number; z: number; nx: number; nz: number; hit: boolean } {
  const cx = clamp(px, b.x0, b.x1);
  const cz = clamp(pz, b.z0, b.z1);
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return { x: px, z: pz, nx: 0, nz: 0, hit: false };
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return { x: px + (dx / d) * push, z: pz + (dz / d) * push, nx: dx / d, nz: dz / d, hit: true };
  }
  // Center inside the box: push out along the shallowest axis.
  const left = px - b.x0;
  const right = b.x1 - px;
  const up = pz - b.z0;
  const down = b.z1 - pz;
  const m = Math.min(left, right, up, down);
  if (m === left) return { x: b.x0 - r, z: pz, nx: -1, nz: 0, hit: true };
  if (m === right) return { x: b.x1 + r, z: pz, nx: 1, nz: 0, hit: true };
  if (m === up) return { x: px, z: b.z0 - r, nx: 0, nz: -1, hit: true };
  return { x: px, z: b.z1 + r, nx: 0, nz: 1, hit: true };
}

/** 2D segment vs AABB (slab method) — used for line-of-sight. */
export function segHitsAabb(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  b: AABB,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tmin = 0;
  let tmax = 1;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (x0 < b.x0 || x0 > b.x1) return false;
  } else {
    let t1 = (b.x0 - x0) / dx;
    let t2 = (b.x1 - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (z0 < b.z0 || z0 > b.z1) return false;
  } else {
    let t1 = (b.z0 - z0) / dz;
    let t2 = (b.z1 - z0) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** True when nothing blocks the straight line between the two points. */
export function hasLineOfSight(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blockers: AABB[],
): boolean {
  for (const b of blockers) {
    if (segHitsAabb(x0, z0, x1, z1, b)) return false;
  }
  return true;
}

/** Shortest signed angular difference b - a in [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
