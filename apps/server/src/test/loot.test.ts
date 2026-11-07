// Pure loot-planning pins: catalog integrity, economy bands, spawn coverage,
// and the heavy-pool invariants that keep every seed completable.
import { describe, it, expect } from "vitest";
import { ITEM_DEFS, LOOT_SPAWNS, PART_SPAWNS, planSpawns, planValue, quotaFor, mulberry32 } from "@last-stop/shared";

const NEW_IDS = ["gumball", "velvet", "payphone", "mattress", "cuckoo"];
const SEEDS = 300;

// planSpawns deals pool blocks in a fixed order: small, fragile, noisy, heavy.
// Block sizes per player count (small, fragile, noisy, heavy) — pinned contract.
const COMPOSITION: Record<number, [number, number, number, number]> = {
  1: [6, 2, 2, 1],
  2: [7, 3, 2, 3],
  3: [8, 4, 2, 3],
  4: [9, 5, 2, 3],
};

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function sweep(): { pc: number; seed: number; plan: ReturnType<typeof planSpawns> }[] {
  const out: { pc: number; seed: number; plan: ReturnType<typeof planSpawns> }[] = [];
  for (let pc = 1; pc <= 4; pc++) {
    for (let seed = 0; seed < SEEDS; seed++) {
      out.push({ pc, seed, plan: planSpawns(mulberry32(seed), pc) });
    }
  }
  return out;
}
const RUNS = sweep();

describe("loot planning", () => {
  it("every planned defId exists in ITEM_DEFS; the part is always the distributor", () => {
    for (const { plan } of RUNS) {
      for (const it of plan.items) {
        expect(ITEM_DEFS[it.defId], `defId ${it.defId} missing from ITEM_DEFS`).toBeDefined();
      }
      expect(plan.part.defId).toBe("distributor");
      expect(PART_SPAWNS.some((p) => p.x === plan.part.x && p.z === plan.part.z)).toBe(true);
    }
  });

  it("planSpawns is deterministic per seed", () => {
    for (let pc = 1; pc <= 4; pc++) {
      for (const seed of [0, 1, 7, 42, 12345]) {
        const a = planSpawns(mulberry32(seed), pc);
        const b = planSpawns(mulberry32(seed), pc);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it("block composition per player count, with pool flags on each block", () => {
    for (const { pc, plan } of RUNS) {
      const [nSmall, nFragile, nNoisy, nHeavy] = COMPOSITION[pc]!;
      expect(plan.items.length).toBe(nSmall + nFragile + nNoisy + nHeavy);
      const smalls = plan.items.slice(0, nSmall);
      const fragiles = plan.items.slice(nSmall, nSmall + nFragile);
      const noisies = plan.items.slice(nSmall + nFragile, nSmall + nFragile + nNoisy);
      const heavies = plan.items.slice(nSmall + nFragile + nNoisy);
      expect(smalls.every((it) => !ITEM_DEFS[it.defId]!.fragile && !ITEM_DEFS[it.defId]!.noisy && !ITEM_DEFS[it.defId]!.twoHandle)).toBe(true);
      expect(fragiles.every((it) => ITEM_DEFS[it.defId]!.fragile)).toBe(true);
      expect(noisies.every((it) => ITEM_DEFS[it.defId]!.noisy)).toBe(true);
      expect(heavies.length).toBeLessThanOrEqual(3);
      expect(heavies.every((it) => ITEM_DEFS[it.defId]!.twoHandle)).toBe(true);
      // heavyDefs are dealt from a shuffled full pool by index: distinct ids
      expect(new Set(heavies.map((it) => it.defId)).size).toBe(heavies.length);
    }
  });

  it("economy bands: new defs priced correctly, planValue sane, quota payable", () => {
    const gumball = ITEM_DEFS["gumball"]!;
    const velvet = ITEM_DEFS["velvet"]!;
    const cuckoo = ITEM_DEFS["cuckoo"]!;
    const payphone = ITEM_DEFS["payphone"]!;
    const mattress = ITEM_DEFS["mattress"]!;
    expect(gumball.value).toBeGreaterThanOrEqual(35);
    expect(gumball.value).toBeLessThanOrEqual(110);
    expect(velvet.value).toBeGreaterThanOrEqual(35);
    expect(velvet.value).toBeLessThanOrEqual(110);
    expect(cuckoo.value).toBeGreaterThanOrEqual(35);
    expect(cuckoo.value).toBeLessThanOrEqual(110);
    expect(payphone.value).toBeGreaterThanOrEqual(170);
    expect(payphone.value).toBeLessThanOrEqual(260);
    // pinned low on purpose: nobody pays for used mattresses (see items.ts)
    expect(mattress.value).toBe(95);
    expect(mattress.weight).toBe(3);
    expect(mattress.radius).toBeLessThanOrEqual(0.55);

    for (const { pc, plan } of RUNS) {
      const pv = planValue(plan.items);
      if (pc === 3) {
        // analytic worst case: smalls 8x55 + fragiles 4x35 + noisy 2x40 + 3
        // lightest distinct heavies (95+170+190) = 1115
        expect(pv).toBeGreaterThan(800);
        expect(pv).toBeLessThan(3000);
      }
      if (pc === 4) {
        expect(pv).toBeGreaterThan(900);
        expect(pv).toBeLessThan(3000);
      }
      // worst quota (RAISED TARGETS) must stay below total spawned value
      expect(quotaFor(pv, pc, ["fatquota"])).toBeLessThan(pv);
    }
  });

  it("all five new items actually spawn across the seed sweep", () => {
    const seen: Record<string, number> = {};
    for (const id of NEW_IDS) seen[id] = 0;
    for (const { plan } of RUNS) {
      for (const it of plan.items) {
        if (seen[it.defId] !== undefined) seen[it.defId]!++;
      }
    }
    for (const id of NEW_IDS) {
      expect(seen[id]!, `${id} spawned ${seen[id]} times`).toBeGreaterThanOrEqual(20);
    }
  });

  it("spawn points never repeat within a plan; heavies land apart", () => {
    // nearest distinct LOOT_SPAWNS pair is ~3.0 apart; jitter shifts each item
    // at most 0.25 per axis, so shared points would collapse toward 0 distance.
    // (The distributor part is exempt: it lands on PART_SPAWNS points, which
    // legitimately sit right next to loot points, e.g. the maintenance shelf.)
    let closestSpawns = Infinity;
    for (let i = 0; i < LOOT_SPAWNS.length; i++) {
      for (let j = i + 1; j < LOOT_SPAWNS.length; j++) {
        closestSpawns = Math.min(closestSpawns, dist(LOOT_SPAWNS[i]!, LOOT_SPAWNS[j]!));
      }
    }
    for (const { plan } of RUNS) {
      expect(plan.items.length).toBeLessThanOrEqual(LOOT_SPAWNS.length);
      let minD = Infinity;
      for (let i = 0; i < plan.items.length; i++) {
        for (let j = i + 1; j < plan.items.length; j++) {
          minD = Math.min(minD, dist(plan.items[i]!, plan.items[j]!));
        }
      }
      expect(minD).toBeGreaterThan(closestSpawns - 0.75);
      const heavies = plan.items.filter((it) => ITEM_DEFS[it.defId]!.twoHandle);
      expect(heavies.length).toBeLessThanOrEqual(3);
    }
  });
});
