// Mission configuration: phases, modifiers, quota scaling, escalation,
// results. Server owns all of this; the client renders it.

export type Phase = "lobby" | "briefing" | "arrive" | "scavenge" | "escape" | "results";

export interface ModifierDef {
  id: string;
  name: string;
  desc: string;
}

// Player-facing modifier definitions; the client renders `desc` verbatim.
// The difficulty model the draw uses lives in MODIFIER_SEVERITY_WEIGHTS below;
// per-weight justification and the full combo ranking live in docs/BALANCE.md.
export const MODIFIERS: Record<string, ModifierDef> = {
  blackout: {
    id: "blackout",
    name: "BLACKOUT",
    desc: "Area lights are dead. Bring your own flashlight.",
  },
  fragile: {
    id: "fragile",
    name: "EGGSHELL CONTRACT",
    desc: "Fragile cargo takes double damage on impacts.",
  },
  sensitive: {
    id: "sensitive",
    name: "LIGHT SLEEPER",
    desc: "The Caretaker hears everything. Noise radii +40%.",
  },
  shortclock: {
    id: "shortclock",
    name: "SHORT SHIFT",
    desc: "The shift ends 90 seconds early.",
  },
  bells: {
    id: "bells",
    name: "CURSED BELLS",
    desc: "All cargo rattles while carried.",
  },
  wired: {
    id: "wired",
    name: "AMPED UP",
    desc: "The Caretaker moves 20% faster. It never gets faster than the end of a bad night.",
  },
  fatquota: {
    id: "fatquota",
    name: "RAISED TARGETS",
    desc: "Corporate raised the quota 15%. Corporate gets a bonus.",
  },
  storm: {
    id: "storm",
    name: "STORM CELL",
    desc: "Rain on the roof. The sky flashes. Nobody is coming either way.",
  },
};

export const MODIFIER_POOL = ["blackout", "fragile", "sensitive", "shortclock", "bells", "wired", "fatquota", "storm"];

// Severity model for the mission draw: one relative-difficulty weight per
// modifier (vs a no-modifier shift); a combo's severity is the product of its
// weights. These are the SAME constants the balance sweep scores with
// (apps/server/scripts/balance-sweep.ts imports them), so the cap the draw
// enforces and the report that justifies it cannot drift apart.
// - wired 1.2: verified Caretaker speed x1.2 (enemy.ts:80); a worst case for
//   escalations 1-2 only, since speedMul is capped at 1.3 at esc 3.
// - sensitive 1.4: verified hear() radii x1.4 (world.ts:818); stacks with
//   escalation unbounded.
// - blackout 1.1: NET guess. The server only cuts enemy view range 15%
//   (enemy.ts:115), but the lot lights die client-side too; the player-side
//   visibility loss is modeled as dominating, so 1.1 -- NOT the raw 0.85
//   enemy term. Least rigorous constant here: a modeling choice.
// - bells 1.15: verified server-side stealth tax -- any carried item moving
//   >1.2 m/s pings NOISE.BELL (12 m) hear() every ~1.6-3.1 s
//   (world.ts:573-580); how much that costs is a guess.
// - fragile 1.25: documented guess at the expected cargo-loss share (impact
//   damage x2 is verified, world.ts:593; the 1.25 share is not measured).
// - fatquota 1.15: verified quota x1.15 (quotaFor below).
// - shortclock: the time term 720/630 -- same quota in 12.5% less shift.
// - storm 1.0: verified atmosphere-only; zero server references.
export const MODIFIER_SEVERITY_WEIGHTS: Record<string, number> = {
  blackout: 1.1,
  fragile: 1.25,
  sensitive: 1.4,
  shortclock: 720 / 630,
  bells: 1.15,
  wired: 1.2,
  fatquota: 1.15,
  storm: 1.0,
};

/** Ceiling on the severity of a dealt combo, chosen from the sweep's
 * distribution (docs/BALANCE.md): 1.9 falls between the 8th-ranked combo
 * (sensitive+shortclock+wired, 1.920) and the 9th (sensitive+bells+fatquota,
 * 1.8515), so exactly the top 8 of 56 combos (14.3%, the "top ~15%" line)
 * become undealable, and the cap itself only fires on those same 8/56 = 14.3%
 * of initial draws. */
export const SEVERITY_CAP = 1.9;

/** Pure severity of a modifier combo: the product of its per-modifier weights
 * (see MODIFIER_SEVERITY_WEIGHTS). Unknown ids weigh 1 so hand-built modifier
 * lists can never produce NaN. */
export function comboSeverity(modifiers: string[]): number {
  let sev = 1;
  for (const id of modifiers) sev *= MODIFIER_SEVERITY_WEIGHTS[id] ?? 1;
  return sev;
}

/** Uniform 3-of-8 draw with a severity cap. Same rng pattern as the original:
 * one call per pick from the shrinking pool, in the same order, so a seed
 * deals the same first two picks it always did. If the drawn combo's
 * comboSeverity exceeds SEVERITY_CAP, ONLY the last pick is re-rolled -- one
 * extra rng call, no loop: the redraw bag is the remaining pool restricted to
 * candidates that bring the combo back under the cap, and its result is
 * accepted as-is. The restricted bag is never empty with the current weights:
 * a cap-firing draw can never contain storm (any storm combo weighs <=
 * 1.4 x 1.25 x 1.0 = 1.75), so storm (weight 1.0) always survives into it --
 * but if weights ever change so it could be empty, the raw remaining pool is
 * used as a fallback rather than looping. The re-roll always replaces the
 * third pick with a DIFFERENT id (the rejected pick was spliced out), so the
 * dealt combo never equals the over-cap draw that triggered it. */
export function pickModifiers(rng: () => number): string[] {
  const pool = [...MODIFIER_POOL];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
  }
  if (comboSeverity(out) > SEVERITY_CAP && pool.length > 0) {
    const kept = out.slice(0, 2);
    const safe = pool.filter((id) => comboSeverity([...kept, id]) <= SEVERITY_CAP);
    const bag = safe.length > 0 ? safe : pool;
    const idx = Math.floor(rng() * bag.length);
    out[2] = bag[idx]!;
  }
  return out;
}

/** Quota as a fraction of total spawned value. More players -> stricter, but
 * always comfortably below 100% so every seed is completable. */
export function quotaFactor(playerCount: number): number {
  return [0, 0.44, 0.5, 0.53, 0.56][Math.max(1, Math.min(4, playerCount))] ?? 0.5;
}

export function missionSeconds(modifiers: string[]): number {
  return 720 - (modifiers.includes("shortclock") ? 90 : 0);
}

/** Quota for a mission: the player-scaled fraction of spawned value, pushed
 * 15% higher by the RAISED TARGETS modifier. Pure so tests can pin it. */
export function quotaFor(baseValue: number, playerCount: number, modifiers: string[]): number {
  const base = Math.round(baseValue * quotaFactor(playerCount));
  return modifiers.includes("fatquota") ? Math.round(base * 1.15) : base;
}

/** Where a crew member physically was when the shift ended, as read by the
 * server at the outcome moment: buckled in the van (escaped), standing on the
 * lot (left), or downed/dead (down). */
export type CrewStatus = "escaped" | "left" | "down";

export interface MissionAwardRow {
  nick: string;
  color: number;
  delivered: number;
  items: number;
  noise: number;
  rescues: number;
  biggestLoss: number;
  lossItem: string;
  downed: number;
  status: CrewStatus;
  /** dead player whose body was hauled back and loaded into the van */
  recovered?: boolean;
}

export interface MissionResults {
  outcome: "escaped" | "timeout" | "wipe";
  quotaMet: boolean;
  salvage: number;
  quota: number;
  cargoDamage: number; // total value destroyed by damage
  /** Actual shift length in seconds, measured from the scavenge start (end of
   * briefing) to the outcome moment. */
  shiftSeconds: number;
  awards: {
    loudest?: { nick: string; noise: number };
    biggestMistake?: { nick: string; loss: number; item: string };
    topHauler?: { nick: string; value: number };
    medic?: { nick: string; rescues: number };
  };
  rows: MissionAwardRow[];
}

export function computeAwards(rows: MissionAwardRow[]): MissionResults["awards"] {
  const awards: MissionResults["awards"] = {};
  if (rows.length) {
    const loudest = [...rows].sort((a, b) => b.noise - a.noise)[0]!;
    if (loudest.noise > 0) awards.loudest = { nick: loudest.nick, noise: Math.round(loudest.noise) };
    const worst = [...rows].sort((a, b) => b.biggestLoss - a.biggestLoss)[0]!;
    if (worst.biggestLoss > 0) awards.biggestMistake = { nick: worst.nick, loss: Math.round(worst.biggestLoss), item: worst.lossItem };
    const hauler = [...rows].sort((a, b) => b.delivered - a.delivered)[0]!;
    if (hauler.delivered > 0) awards.topHauler = { nick: hauler.nick, value: Math.round(hauler.delivered) };
    const medic = [...rows].sort((a, b) => b.rescues - a.rescues)[0]!;
    if (medic.rescues > 0) awards.medic = { nick: medic.nick, rescues: medic.rescues };
  }
  return awards;
}

export const PHASE_LABEL: Record<Phase, string> = {
  lobby: "Crew Room",
  briefing: "Arrival",
  arrive: "Drive-In",
  scavenge: "Recovery Shift",
  escape: "GET OUT",
  results: "Debrief",
};
