// Mission configuration: phases, modifiers, quota scaling, escalation,
// results. Server owns all of this; the client renders it.

export type Phase = "lobby" | "briefing" | "scavenge" | "escape" | "results";

export interface ModifierDef {
  id: string;
  name: string;
  desc: string;
}

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

export function pickModifiers(rng: () => number): string[] {
  const pool = [...MODIFIER_POOL];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
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
  scavenge: "Recovery Shift",
  escape: "GET OUT",
  results: "Debrief",
};
