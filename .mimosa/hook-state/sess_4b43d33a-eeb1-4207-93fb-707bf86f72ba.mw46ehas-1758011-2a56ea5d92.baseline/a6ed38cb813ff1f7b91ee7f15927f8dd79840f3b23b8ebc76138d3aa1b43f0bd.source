// Dev-time validation of the handcrafted map (run with tsx). Kept as a
// permanent check: also used by server tests.
import { NAV_EDGES, NAV_NODES, NAV_INDEX, STATIC_COLLIDERS, LOOT_SPAWNS, PART_SPAWNS, WALL_BOXES, PLAYER_SPAWNS, VAN_START, ROAD } from "./map.js";
import { segHitsAabb, circleVsAabb } from "./math.js";

export function validateMap(): string[] {
  const problems: string[] = [];
  for (const [a, b] of NAV_EDGES) {
    const na = NAV_NODES[NAV_INDEX.get(a)!]!;
    const nb = NAV_NODES[NAV_INDEX.get(b)!]!;
    for (const w of WALL_BOXES) {
      if (segHitsAabb(na.x, na.z, nb.x, nb.z, w.aabb)) {
        problems.push(`EDGE ${a}-${b} crosses wall ${JSON.stringify(w.aabb)}`);
      }
    }
  }
  const checkPoint = (name: string, x: number, z: number) => {
    for (const c of STATIC_COLLIDERS) {
      const r = circleVsAabb(x, z, 0.45, c);
      if (r.hit) {
        problems.push(`${name} (${x},${z}) overlaps collider ${JSON.stringify(c)}`);
        return;
      }
    }
  };
  LOOT_SPAWNS.forEach((s, i) => checkPoint(`loot[${i}]`, s.x, s.z));
  PART_SPAWNS.forEach((s, i) => checkPoint(`part[${i}]`, s.x, s.z));
  PLAYER_SPAWNS.forEach((s, i) => checkPoint(`spawn[${i}]`, s.x, s.z));
  checkPoint("vanStart", VAN_START.x, VAN_START.z);
  for (const n of NAV_NODES) checkPoint(`nav ${n.id}`, n.x, n.z);
  // Escape road: two drive lines (van half-width + margin) must be clear from
  // just past the gate to the finish line.
  for (const laneZ of [9.3, 12.7]) {
    for (const c of STATIC_COLLIDERS) {
      if (segHitsAabb(-58, laneZ, -35.5, laneZ, c)) {
        problems.push(`escape lane z=${laneZ} blocked by ${JSON.stringify(c)}`);
      }
    }
  }
  return problems;
}

// CLI entry only in Node (this module is also imported by the browser client)
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("mapcheck.ts")) {
  const problems = validateMap();
  if (problems.length === 0) console.log("MAP OK");
  else {
    problems.forEach((p) => console.log(p));
    console.log(`MAP BAD: ${problems.length} problems`);
    process.exit(1);
  }
}
