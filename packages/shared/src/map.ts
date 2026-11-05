// Handcrafted layout: the "Pale Lantern" motel + repair garage lot.
// All geometry is axis-aligned; walls are defined as center-lines with door
// gaps, then expanded into collision boxes + render rectangles.
//
// Orientation: +X east, +Z south, north is -Z. The van parks in the lot and
// escapes WEST through the gate onto the old road.

import type { AABB } from "./math.js";

export const WALL_T = 0.3; // wall thickness

export type WallKind = "wall" | "fence" | "rail" | "gate";

export interface WallDef {
  axis: "x" | "z"; // direction the wall runs along
  at: number; // the fixed coordinate (z for axis x, x for axis z)
  from: number;
  to: number;
  h: number;
  kind: WallKind;
  gaps?: { c: number; w: number }[]; // door/window openings (center + width along the run axis)
}

export interface DoorDef {
  id: string;
  axis: "x" | "z";
  cx: number;
  cz: number;
  w: number;
  startOpen: boolean;
}

export interface NavNode {
  id: string;
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Perimeter fence + gate + escape road
// ---------------------------------------------------------------------------
export const MAP_BOUNDS = { x0: -34, z0: -26, x1: 34, z1: 26 };
export const GATE = { x: -34, z0: 8, z1: 14, w: 6, h: 3.4 };
export const ROAD = { x0: -70, x1: -34, z0: 6, z1: 16 };
export const FINISH_X = -56;

// ---------------------------------------------------------------------------
// Building program
// Motel: front rooms z[-15,-8], corridor z[-18,-15], back rooms z[-24,-18]
// Garage: x[16,30] z[-20,-4]
// ---------------------------------------------------------------------------
export const ROOMS = [
  { id: "R1", label: "Room 1", x0: -22, z0: -15, x1: -15, z1: -8 },
  { id: "R2", label: "Room 2", x0: -15, z0: -15, x1: -8, z1: -8 },
  { id: "R3", label: "Room 3", x0: -8, z0: -15, x1: -1, z1: -8 },
  { id: "R4", label: "Room 4", x0: -1, z0: -15, x1: 5, z1: -8 },
  { id: "ENTRY", label: "Entry Hall", x0: 5, z0: -15, x1: 10, z1: -8 },
  { id: "LAU", label: "Laundry", x0: -22, z0: -24, x1: -14, z1: -18 },
  { id: "MAI", label: "Maintenance", x0: -14, z0: -24, x1: -6, z1: -18 },
  { id: "BOI", label: "Boiler", x0: -6, z0: -24, x1: 2, z1: -18 },
  { id: "STO", label: "Storage", x0: 2, z0: -24, x1: 10, z1: -18 },
  { id: "GAR", label: "Garage", x0: 16, z0: -20, x1: 30, z1: -4 },
  { id: "COR", label: "Corridor", x0: -22, z0: -18, x1: 10, z1: -15 },
] as const;

const DW = 1.2; // standard door width

export const WALLS: WallDef[] = [
  // Perimeter fence (gate gap on the west side)
  { axis: "x", at: -26, from: -34, to: 34, h: 2, kind: "fence" },
  { axis: "x", at: 26, from: -34, to: 34, h: 2, kind: "fence" },
  { axis: "z", at: 34, from: -26, to: 26, h: 2, kind: "fence" },
  { axis: "z", at: -34, from: -26, to: GATE.z0, h: 2, kind: "fence" },
  { axis: "z", at: -34, from: GATE.z1, to: 26, h: 2, kind: "fence" },
  // Escape road fences
  { axis: "x", at: ROAD.z0, from: ROAD.x0, to: -34, h: 2, kind: "fence" },
  { axis: "x", at: ROAD.z1, from: ROAD.x0, to: -34, h: 2, kind: "fence" },
  { axis: "z", at: ROAD.x0, from: ROAD.z0, to: ROAD.z1, h: 2, kind: "fence" },

  // Motel shell
  { axis: "z", at: -22, from: -24, to: -8, h: 3.2, kind: "wall", gaps: [{ c: -16.5, w: DW }] },
  { axis: "z", at: 10, from: -24, to: -8, h: 3.2, kind: "wall", gaps: [{ c: -16.5, w: 2.4 }] },
  { axis: "x", at: -24, from: -22, to: 10, h: 3.2, kind: "wall" },
  {
    axis: "x", at: -8, from: -22, to: 10, h: 3.2, kind: "wall",
    gaps: [{ c: -18.5, w: DW }, { c: -11.5, w: DW }, { c: -4.5, w: DW }, { c: 2, w: DW }, { c: 7.5, w: DW }],
  },
  // Front room dividers
  { axis: "z", at: -15, from: -15, to: -8, h: 3.2, kind: "wall" },
  { axis: "z", at: -8, from: -15, to: -8, h: 3.2, kind: "wall" },
  { axis: "z", at: -1, from: -15, to: -8, h: 3.2, kind: "wall" },
  { axis: "z", at: 5, from: -15, to: -8, h: 3.2, kind: "wall" },
  // Corridor south wall (front rooms' back doors + entry arch)
  {
    axis: "x", at: -15, from: -22, to: 10, h: 3.2, kind: "wall",
    gaps: [{ c: -18.5, w: DW }, { c: -11.5, w: DW }, { c: -4.5, w: DW }, { c: 2, w: DW }, { c: 7.5, w: 2.4 }],
  },
  // Corridor north wall (back rooms' doors)
  {
    axis: "x", at: -18, from: -22, to: 10, h: 3.2, kind: "wall",
    gaps: [{ c: -18, w: DW }, { c: -10, w: DW }, { c: -2, w: DW }, { c: 6, w: DW }],
  },
  // Back room dividers
  { axis: "z", at: -14, from: -24, to: -18, h: 3.2, kind: "wall" },
  { axis: "z", at: -6, from: -24, to: -18, h: 3.2, kind: "wall" },
  { axis: "z", at: 2, from: -24, to: -18, h: 3.2, kind: "wall" },

  // Garage shell
  { axis: "x", at: -4, from: 16, to: 30, h: 4, kind: "wall", gaps: [{ c: 23, w: 8 }] },
  { axis: "x", at: -20, from: 16, to: 30, h: 4, kind: "wall" },
  { axis: "z", at: 16, from: -20, to: -4, h: 4, kind: "wall", gaps: [{ c: -16.5, w: DW }] },
  { axis: "z", at: 30, from: -20, to: -4, h: 4, kind: "wall" },

  // Walkway rail with stair gaps
  {
    axis: "x", at: -5, from: -22, to: 10, h: 1, kind: "rail",
    gaps: [{ c: -18.5, w: 2 }, { c: -4.5, w: 2 }, { c: 7.5, w: 2 }],
  },
];

export const DOORS: DoorDef[] = [
  // Front row room doors (face the walkway)
  { id: "d_r1", axis: "x", cx: -18.5, cz: -8, w: DW, startOpen: false },
  { id: "d_r2", axis: "x", cx: -11.5, cz: -8, w: DW, startOpen: false },
  { id: "d_r3", axis: "x", cx: -4.5, cz: -8, w: DW, startOpen: false },
  { id: "d_r4", axis: "x", cx: 2, cz: -8, w: DW, startOpen: false },
  { id: "d_entry", axis: "x", cx: 7.5, cz: -8, w: DW, startOpen: true },
  // Front rooms' back doors into the corridor
  { id: "b_r1", axis: "x", cx: -18.5, cz: -15, w: DW, startOpen: false },
  { id: "b_r2", axis: "x", cx: -11.5, cz: -15, w: DW, startOpen: false },
  { id: "b_r3", axis: "x", cx: -4.5, cz: -15, w: DW, startOpen: false },
  { id: "b_r4", axis: "x", cx: 2, cz: -15, w: DW, startOpen: false },
  // Back rooms' doors
  { id: "b_lau", axis: "x", cx: -18, cz: -18, w: DW, startOpen: false },
  { id: "b_mai", axis: "x", cx: -10, cz: -18, w: DW, startOpen: false },
  { id: "b_boi", axis: "x", cx: -2, cz: -18, w: DW, startOpen: false },
  { id: "b_sto", axis: "x", cx: 6, cz: -18, w: DW, startOpen: false },
  // West exit + garage side door
  { id: "d_west", axis: "z", cx: -22, cz: -16.5, w: DW, startOpen: false },
  { id: "d_gar", axis: "z", cx: 16, cz: -16.5, w: DW, startOpen: false },
];

export function doorAabb(d: DoorDef): AABB {
  const t = WALL_T;
  if (d.axis === "x") {
    return { x0: d.cx - d.w / 2, x1: d.cx + d.w / 2, z0: d.cz - t / 2, z1: d.cz + t / 2 };
  }
  return { x0: d.cx - t / 2, x1: d.cx + t / 2, z0: d.cz - d.w / 2, z1: d.cz + d.w / 2 };
}

export interface WallBox {
  aabb: AABB;
  h: number;
  kind: WallKind;
}

/** Expand wall center-lines with gaps into solid boxes. */
export function expandWalls(): WallBox[] {
  const out: WallBox[] = [];
  for (const w of WALLS) {
    const sorted = [...(w.gaps ?? [])].sort((a, b) => a.c - b.c);
    let cur = w.from;
    for (const g of sorted) {
      const segEnd = g.c - g.w / 2;
      if (segEnd > cur) pushSeg(w, cur, segEnd);
      cur = g.c + g.w / 2;
    }
    if (w.to > cur) pushSeg(w, cur, w.to);
  }
  function pushSeg(w: WallDef, a: number, b: number) {
    const t = WALL_T;
    const box: AABB =
      w.axis === "x"
        ? { x0: a, x1: b, z0: w.at - t / 2, z1: w.at + t / 2 }
        : { x0: w.at - t / 2, x1: w.at + t / 2, z0: a, z1: b };
    out.push({ aabb: box, h: w.h, kind: w.kind });
  }
  return out;
}

export const WALL_BOXES: WallBox[] = expandWalls();

/** Big props with collision. Cosmetic props live in the client. */
export interface PropDef {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rot?: number; // visual only; collider stays axis-aligned
}

export const PROPS: PropDef[] = [
  { kind: "vending", x: -8, z: -7.4, w: 1.3, d: 0.9 },
  { kind: "vending", x: 4.5, z: -7.4, w: 1.3, d: 0.9 },
  { kind: "car", x: -9, z: 0, w: 4.4, d: 1.9, rot: 0.2 },
  { kind: "car", x: 24, z: 22, w: 4.4, d: 1.9, rot: -0.35 },
  { kind: "dumpster", x: 13, z: -20, w: 2.2, d: 1.3 },
  { kind: "dumpster", x: 32.4, z: -2.6, w: 2.2, d: 1.3 },
  { kind: "boilerTank", x: -3, z: -22.6, w: 2.4, d: 2.4 },
  { kind: "workbench", x: 23, z: -19.2, w: 4.2, d: 1 },
  { kind: "shelf", x: 16.9, z: -10, w: 1, d: 5 },
  { kind: "shelf", x: 29.1, z: -10, w: 1, d: 5 },
  { kind: "sign", x: -13, z: -2.5, w: 1.1, d: 1.1 },
  { kind: "washer", x: -21.2, z: -21, w: 1.6, d: 3 },
  { kind: "tires", x: 27.8, z: -18.9, w: 1.6, d: 1.6 },
];

export function propAabbs(): AABB[] {
  return PROPS.map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }));
}

export const PROP_AABBS: AABB[] = propAabbs();

/** All static boxes that block player movement. */
export const STATIC_COLLIDERS: AABB[] = [
  ...WALL_BOXES.map((w) => w.aabb),
  ...PROP_AABBS,
];

/** Boxes that also block vision (full-height walls; rails and fences do not). */
export const LOS_BLOCKERS: AABB[] = WALL_BOXES.filter((w) => w.h >= 2 && w.kind === "wall").map((w) => w.aabb);

// ---------------------------------------------------------------------------
// Navigation graph (used by The Caretaker + bot tests)
// ---------------------------------------------------------------------------
export const NAV_NODES: NavNode[] = [
  { id: "L1", x: -12, z: 10 }, { id: "L2", x: 0, z: 8 }, { id: "L3", x: 12, z: 10 },
  { id: "L4", x: -12, z: 20 }, { id: "L5", x: 0, z: 20 }, { id: "L6", x: 12, z: 20 },
  { id: "L7", x: 0, z: 3 }, { id: "L8", x: -20, z: 4 }, { id: "L9", x: 20, z: 4 },
  { id: "LW", x: -24, z: 7 }, { id: "GT", x: -30, z: 11 },
  { id: "Y1", x: -8, z: -1.5 }, { id: "Y2", x: -14, z: -1.5 }, { id: "Y3", x: 4, z: -1.5 }, { id: "Y4", x: -20, z: -1.5 },
  { id: "S1", x: -18.5, z: -4.5 }, { id: "S3", x: -4.5, z: -4.5 }, { id: "S5", x: 7.5, z: -4.5 },
  { id: "W1", x: -18.5, z: -6.5 }, { id: "W2", x: -11.5, z: -6.5 }, { id: "W3", x: -4.5, z: -6.5 },
  { id: "W4", x: 2, z: -6.5 }, { id: "W5", x: 7.5, z: -6.5 },
  { id: "R1n", x: -18.5, z: -11.5 }, { id: "R2n", x: -11.5, z: -11.5 }, { id: "R3n", x: -4.5, z: -11.5 },
  { id: "R4n", x: 2, z: -11.5 }, { id: "ENn", x: 7.5, z: -11.5 },
  { id: "C1", x: -18.5, z: -16.5 }, { id: "C2", x: -11.5, z: -16.5 }, { id: "C3", x: -4.5, z: -16.5 },
  { id: "C4", x: 2, z: -16.5 }, { id: "C5", x: 7.5, z: -16.5 },
  { id: "CB1", x: -18, z: -16.5 }, { id: "CB2", x: -10, z: -16.5 }, { id: "CB3", x: -2, z: -16.5 }, { id: "CB4", x: 6, z: -16.5 },
  { id: "LAUn", x: -18, z: -21 }, { id: "MAIn", x: -10, z: -21 }, { id: "BOIn", x: -2, z: -20.6 }, { id: "STOn", x: 6, z: -21 },
  { id: "WY1", x: -26, z: -16.5 }, { id: "WY2", x: -26, z: -8 }, { id: "WY3", x: -26, z: -1 },
  { id: "GA", x: 23, z: -12 }, { id: "GB", x: 23, z: -6 }, { id: "GC", x: 19, z: -18 },
  { id: "GI", x: 18, z: -16.5 }, { id: "GY", x: 23, z: -1.5 },
  { id: "GL", x: 13, z: -16.5 },
  { id: "EA", x: 32, z: -6 }, { id: "EA2", x: 32, z: -17 }, { id: "ES", x: 28, z: -1.5 },
];

export const NAV_EDGES: [string, string][] = [
  // lot grid
  ["L1", "L2"], ["L2", "L3"], ["L4", "L5"], ["L5", "L6"],
  ["L1", "L4"], ["L2", "L5"], ["L3", "L6"], ["L7", "L2"], ["L7", "L3"],
  ["L7", "L8"], ["L8", "L1"], ["L9", "L3"], ["LW", "L4"], ["LW", "L8"], ["LW", "GT"],
  // front yard
  ["Y1", "Y2"], ["Y1", "Y3"], ["Y2", "Y4"], ["Y1", "L7"], ["Y3", "L7"], ["Y4", "L8"], ["Y3", "ES"],
  // stairs -> walkway
  ["Y2", "S1"], ["Y1", "S3"], ["Y3", "S5"], ["S1", "W1"], ["S3", "W3"], ["S5", "W5"],
  // walkway chain + room doors
  ["W1", "W2"], ["W2", "W3"], ["W3", "W4"], ["W4", "W5"],
  ["W1", "R1n"], ["W2", "R2n"], ["W3", "R3n"], ["W4", "R4n"], ["W5", "ENn"],
  // back doors + entry arch
  ["R1n", "C1"], ["R2n", "C2"], ["R3n", "C3"], ["R4n", "C4"], ["ENn", "C5"],
  // corridor chain
  ["C1", "CB1"], ["CB1", "C2"], ["C2", "CB2"], ["CB2", "C3"], ["C3", "CB3"], ["CB3", "C4"], ["C4", "CB4"], ["CB4", "C5"],
  // back rooms
  ["CB1", "LAUn"], ["CB2", "MAIn"], ["CB3", "BOIn"], ["CB4", "STOn"],
  // west yard
  ["C1", "WY1"], ["WY1", "WY2"], ["WY2", "WY3"], ["WY3", "Y4"], ["WY3", "L8"],
  // garage link
  ["C5", "GL"], ["GL", "GI"], ["GI", "GA"], ["GA", "GB"], ["GA", "GC"],
  ["GB", "GY"], ["GY", "L9"], ["GY", "ES"],
  // east alley
  ["EA", "EA2"], ["EA", "ES"],
];

export const NAV_INDEX: Map<string, number> = new Map(NAV_NODES.map((n, i) => [n.id, i]));

function buildAdj(): number[][] {
  const adj: number[][] = NAV_NODES.map(() => []);
  for (const [a, b] of NAV_EDGES) {
    const ia = NAV_INDEX.get(a);
    const ib = NAV_INDEX.get(b);
    if (ia === undefined || ib === undefined) throw new Error(`bad nav edge ${a}-${b}`);
    adj[ia]!.push(ib);
    adj[ib]!.push(ia);
  }
  return adj;
}

export const NAV_ADJ: number[][] = buildAdj();

/** BFS shortest path by hop count between node indexes. */
export function navPath(from: number, to: number): number[] {
  if (from === to) return [from];
  const prev = new Int16Array(NAV_NODES.length).fill(-1);
  const seen = new Uint8Array(NAV_NODES.length);
  const q = [from];
  seen[from] = 1;
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of NAV_ADJ[cur]!) {
      if (seen[nb]) continue;
      seen[nb] = 1;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let p = cur;
        while (p !== -1 && p !== from) {
          path.unshift(p);
          p = prev[p]!;
        }
        path.unshift(from);
        return path;
      }
      q.push(nb);
    }
  }
  return [];
}

export function nearestNavNode(x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NAV_NODES.length; i++) {
    const n = NAV_NODES[i]!;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Patrol loops The Caretaker picks between (index lists into NAV_NODES). */
export const PATROL_ROUTES: string[][] = [
  ["W1", "W2", "W3", "W4", "W5", "ENn", "C5", "CB4", "C4", "CB3", "C3", "CB2", "C2", "CB1", "C1"],
  ["CB1", "LAUn", "CB2", "MAIn", "CB3", "BOIn", "CB4", "STOn"],
  ["C5", "GL", "GI", "GA", "GB", "GY", "GB", "GA", "GC", "GA", "GI", "GL"],
  ["L8", "LW", "GT", "LW", "L4", "L5", "L6", "L9", "L3", "L2", "L1"],
  ["L2", "L7", "Y1", "Y2", "Y3", "L7", "L3", "L9", "GY", "GB", "GA"],
];

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------
export const PLAYER_SPAWNS = [
  { x: -0.6, z: 9.6, yaw: Math.PI },
  { x: 4.2, z: 10.2, yaw: Math.PI },
  { x: -3, z: 11.5, yaw: Math.PI },
  { x: 4.2, z: 14.5, yaw: Math.PI },
];

export const VAN_START = { x: 2, z: 13.5, yaw: Math.PI }; // facing north (-Z)

export interface SpawnPoint {
  x: number;
  z: number;
  tag: string;
}

export const LOOT_SPAWNS: SpawnPoint[] = [
  { x: -20, z: -13.5, tag: "R1" }, { x: -16.8, z: -9.5, tag: "R1" },
  { x: -13, z: -13.5, tag: "R2" }, { x: -9.5, z: -9.8, tag: "R2" },
  { x: -6, z: -13.5, tag: "R3" }, { x: -2.8, z: -9.5, tag: "R3" },
  { x: 1, z: -13.5, tag: "R4" }, { x: 3.8, z: -9.5, tag: "R4" },
  { x: 8.8, z: -11.5, tag: "ENTRY" },
  { x: -19, z: -21.5, tag: "LAU" }, { x: -16, z: -23, tag: "LAU" },
  { x: -12, z: -21.5, tag: "MAI" }, { x: -8, z: -23, tag: "MAI" },
  { x: -5, z: -22.5, tag: "BOI" }, { x: 0.8, z: -19.5, tag: "BOI" },
  { x: 4, z: -21.5, tag: "STO" }, { x: 8, z: -23, tag: "STO" },
  { x: -6, z: -16.5, tag: "COR" }, { x: 4.5, z: -16.5, tag: "COR" },
  { x: 18.5, z: -7, tag: "GAR" }, { x: 27, z: -7, tag: "GAR" },
  { x: 19.5, z: -16, tag: "GAR" }, { x: 27.5, z: -14, tag: "GAR" },
  { x: -8.9, z: -6.2, tag: "WALK" }, { x: 4.6, z: -6.2, tag: "WALK" },
  { x: -9.2, z: 2.1, tag: "YARD" }, { x: 13.2, z: -18.8, tag: "YARD" },
  { x: 31.8, z: -7.5, tag: "ALLEY" }, { x: 32.2, z: -1.2, tag: "ALLEY" },
];

export const PART_SPAWNS = [
  { x: 23, z: -18.2, tag: "workbench" },
  { x: -8.5, z: -23.2, tag: "maintenance shelf" },
  { x: -1.1, z: -22.6, tag: "boiler room" },
];

/** Points lamp posts / area lights occupy (render + light). */
export const LAMPS = [
  { x: -10, z: 8 }, { x: 14, z: 8 }, { x: -10, z: 20 }, { x: 14, z: 20 },
];
