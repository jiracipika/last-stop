// Valuables catalog + seeded spawn planning.
// Every def is original: chunky low-poly shapes are generated procedurally
// on the client from `mesh` + `color`.

import { LOOT_SPAWNS, PART_SPAWNS } from "./map.js";

export interface ItemDef {
  id: string;
  name: string;
  weight: number; // 1 (feather) .. 5 (vending machine)
  value: number;
  radius: number; // collision radius
  restY: number; // center height when resting on the ground
  mesh: string; // client mesh generator key
  color: string;
  fragile?: boolean;
  noisy?: boolean; // rattles/rings while moving
  twoHandle?: boolean; // heavy: needs a hand from two players for full speed
  part?: boolean; // the van repair part
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  toolbox: { id: "toolbox", name: "Roadie Toolbox", weight: 2, value: 70, radius: 0.32, restY: 0.22, mesh: "box", color: "#b5442c" },
  battery: { id: "battery", name: "Trucker Battery", weight: 3, value: 85, radius: 0.3, restY: 0.24, mesh: "box", color: "#2c2c34" },
  cooler: { id: "cooler", name: "Motel Cooler", weight: 2, value: 55, radius: 0.36, restY: 0.26, mesh: "box", color: "#d9553a" },
  radio: { id: "radio", name: "Dash Radio", weight: 1, value: 60, radius: 0.26, restY: 0.18, mesh: "box", color: "#7a5c36" },
  typewriter: { id: "typewriter", name: "Front Desk Typewriter", weight: 2, value: 90, radius: 0.3, restY: 0.2, mesh: "box", color: "#3d4c5c", fragile: true },
  cat: { id: "cat", name: "Ceramic Cat", weight: 1, value: 45, radius: 0.22, restY: 0.24, mesh: "cat", color: "#e8e2d4", fragile: true },
  globe: { id: "globe", name: "Snow Globe", weight: 1, value: 35, radius: 0.2, restY: 0.2, mesh: "sphere", color: "#aacde8", fragile: true },
  raccoon: { id: "raccoon", name: "Taxidermy Raccoon", weight: 1, value: 65, radius: 0.24, restY: 0.22, mesh: "cat", color: "#8b8478" },
  barsign: { id: "barsign", name: "Neon Bar Sign", weight: 2, value: 110, radius: 0.3, restY: 0.24, mesh: "panel", color: "#ff5c8a", fragile: true },
  bell: { id: "bell", name: "Antique Service Bell", weight: 1, value: 40, radius: 0.18, restY: 0.14, mesh: "bell", color: "#d8b544", noisy: true },
  chimes: { id: "chimes", name: "Wind Chime Set", weight: 1, value: 50, radius: 0.22, restY: 0.3, mesh: "chimes", color: "#9aa8b5", noisy: true, fragile: true },
  gumball: { id: "gumball", name: "Gumball Machine", weight: 1, value: 40, radius: 0.2, restY: 0.2, mesh: "sphere", color: "#c94f42", fragile: true },
  velvet: { id: "velvet", name: "Velvet Painting", weight: 2, value: 85, radius: 0.3, restY: 0.24, mesh: "panel", color: "#a34a2a", fragile: true },
  cuckoo: { id: "cuckoo", name: "Cuckoo Clock", weight: 1, value: 75, radius: 0.22, restY: 0.18, mesh: "cuckoo", color: "#6e4a28", noisy: true, fragile: true },
  vending: { id: "vending", name: "Soda Vending Machine", weight: 5, value: 260, radius: 0.55, restY: 0.85, mesh: "vending", color: "#c23b3b", twoHandle: true },
  arcade: { id: "arcade", name: "Arcade Cabinet", weight: 4, value: 220, radius: 0.5, restY: 0.85, mesh: "arcade", color: "#3b62c2", twoHandle: true },
  compressor: { id: "compressor", name: "Air Compressor", weight: 4, value: 170, radius: 0.42, restY: 0.5, mesh: "canister", color: "#5c7a3d", twoHandle: true },
  freezer: { id: "freezer", name: "Chest Freezer", weight: 5, value: 200, radius: 0.55, restY: 0.45, mesh: "box", color: "#cfd6dd", twoHandle: true },
  fishtank: { id: "fishtank", name: "Office Fish Tank", weight: 4, value: 240, radius: 0.45, restY: 0.4, mesh: "tank", color: "#7fd4ff", twoHandle: true, fragile: true },
  clock: { id: "clock", name: "Grandfather Clock", weight: 4, value: 230, radius: 0.4, restY: 0.95, mesh: "clock", color: "#6b4a2c", twoHandle: true, fragile: true },
  payphone: { id: "payphone", name: "Payphone", weight: 4, value: 190, radius: 0.45, restY: 0.85, mesh: "vending", color: "#3a5578", twoHandle: true },
  // value deliberately sits below the heavy band: nobody pays for a used
  // mattress; it ships because it is heavy, awkward, and already on the manifest
  mattress: { id: "mattress", name: "Queen Mattress", weight: 3, value: 95, radius: 0.55, restY: 0.3, mesh: "box", color: "#cfc3a4", twoHandle: true },
  distributor: { id: "distributor", name: "Van Distributor Cap", weight: 2, value: 0, radius: 0.28, restY: 0.2, mesh: "distributor", color: "#c8a03c", part: true },
};

const SMALL_POOL = ["toolbox", "battery", "cooler", "radio", "raccoon"];
const FRAGILE_POOL = ["cat", "globe", "barsign", "typewriter", "gumball", "velvet"];
const NOISY_POOL = ["bell", "chimes", "cuckoo"];
const HEAVY_POOL = ["vending", "arcade", "compressor", "freezer", "fishtank", "clock", "payphone", "mattress"];

export interface PlannedItem {
  defId: string;
  x: number;
  z: number;
  yaw: number;
}

/** Deterministic per-seed spawn plan; always completable by construction. */
export function planSpawns(rng: () => number, playerCount: number): { items: PlannedItem[]; part: PlannedItem } {
  // Shuffle loot spawn points, then deal items onto them.
  const pts = [...LOOT_SPAWNS];
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pts[i], pts[j]] = [pts[j]!, pts[i]!];
  }
  let cursor = 0;
  const take = (): { x: number; z: number } => {
    const p = pts[cursor % pts.length]!;
    cursor++;
    // jitter inside the point's tile so repeat seeds differ visually
    return { x: p.x + (rng() - 0.5) * 0.5, z: p.z + (rng() - 0.5) * 0.5 };
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

  const items: PlannedItem[] = [];
  const smallCount = 5 + playerCount;
  const fragileCount = 2 + Math.floor(playerCount * 0.75);
  const noisyCount = 2;
  const heavyCount = Math.min(3, Math.max(1, playerCount - (playerCount >= 3 ? 1 : 0)) + (playerCount >= 2 ? 1 : 0)) || 1;

  for (let i = 0; i < smallCount; i++) {
    const p = take();
    items.push({ defId: pick(SMALL_POOL), x: p.x, z: p.z, yaw: rng() * Math.PI * 2 });
  }
  for (let i = 0; i < fragileCount; i++) {
    const p = take();
    items.push({ defId: pick(FRAGILE_POOL), x: p.x, z: p.z, yaw: rng() * Math.PI * 2 });
  }
  for (let i = 0; i < noisyCount; i++) {
    const p = take();
    items.push({ defId: pick(NOISY_POOL), x: p.x, z: p.z, yaw: rng() * Math.PI * 2 });
  }
  const heavyDefs = [...HEAVY_POOL];
  for (let i = heavyDefs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [heavyDefs[i], heavyDefs[j]] = [heavyDefs[j]!, heavyDefs[i]!];
  }
  for (let i = 0; i < heavyCount; i++) {
    const p = take();
    items.push({ defId: heavyDefs[i % heavyDefs.length]!, x: p.x, z: p.z, yaw: rng() * Math.PI * 2 });
  }

  const pp = PART_SPAWNS[Math.floor(rng() * PART_SPAWNS.length)]!;
  const part: PlannedItem = { defId: "distributor", x: pp.x, z: pp.z, yaw: 0 };
  return { items, part };
}

/** Total base value of a plan (for quota math). */
export function planValue(items: PlannedItem[]): number {
  return items.reduce((sum, it) => sum + (ITEM_DEFS[it.defId]?.value ?? 0), 0);
}
