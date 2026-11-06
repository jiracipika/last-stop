// balance-sweep.ts -- deterministic difficulty sweep over every 3-of-8
// modifier combo for LAST STOP missions.
//
// Run:   pnpm --filter @last-stop/server exec tsx scripts/balance-sweep.ts
//        pnpm --filter @last-stop/server exec tsx scripts/balance-sweep.ts --json
//
// Scores all C(8,3) = 56 combos over a fixed seed set, writes docs/BALANCE.md,
// and prints a ranking table (or raw JSON with --json). Fully deterministic:
// every rng is mulberry32 keyed by a fixed seed xor a hash of the combo ids.
// No Date.now / Math.random anywhere.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MISSION,
  MODIFIERS,
  MODIFIER_POOL,
  hashStr,
  missionSeconds,
  mulberry32,
  planSpawns,
  planValue,
  quotaFactor,
  quotaFor,
} from "@last-stop/shared";

// ------------------------------------------------------------- sweep tuning
const PLAYERS = 3; // crew size the backlog acceptance line targets
const SEEDS = [101, 202, 303, 404, 505]; // fixed plan seeds per combo
const BASE_TIME_S = MISSION.TIME_S; // 720 s reference shift
const FLAG_RATIO = 1.6; // flag when index > 1.6 x median combo index

// Index weights: crude constants, justified inline + in docs/BALANCE.md.
const THREAT_WIRED = 1.2; // verified: Caretaker speed x1.2 (enemy.ts:80)
const THREAT_SENSITIVE = 1.4; // verified: hear() radii x1.4 (world.ts:818)
const THREAT_BLACKOUT = 1.1; // NET guess: enemy sight -15% (enemy.ts:115) but
// lot lights die client-side too (player visibility). Player-side loss is
// modeled as dominating -> 1.1, NOT the raw 0.85 enemy-side term.
const LOSS_FRAGILE = 1.25; // made-up expected cargo-loss share under fragile
// (impact damage x2 verified at world.ts:593; the 1.25 share is NOT measured).
const THREAT_BELLS = 1.15; // verified server-side: every carried item moving
// >1.2 m/s pings NOISE.BELL (12 m) hear() every ~1.6-3.1 s (world.ts:573-580),
// 16.8 m under sensitive — CURSED BELLS is a stealth tax, not just audio.
const THREAT_WIRED_NOTE = "capped at the esc-3 ceiling (enemy.ts: speedMul min 1.3)";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPORT_PATH = path.join(ROOT, "docs", "BALANCE.md");

// ------------------------------------------------------------------ scoring
interface Row {
  ids: string[];
  names: string;
  seconds: number;
  meanPressure: number;
  meanQuota: number; // mean $ quota over seeds (context only)
  meanLoot: number; // mean $ spawned value over seeds (context only)
  threat: number;
  fragileLoss: number;
  timeMul: number; // BASE_TIME_S / seconds -- the index's time term
  index: number;
  overBase: number; // index / no-modifier baseline
  flagged: boolean;
}

/** All 3-element combinations of the pool, in pool order (deterministic). */
function allCombos(pool: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      for (let k = j + 1; k < pool.length; k++)
        out.push([pool[i]!, pool[j]!, pool[k]!]);
  return out;
}

function threatFactor(ids: string[]): number {
  let t = 1;
  if (ids.includes("wired")) t *= THREAT_WIRED;
  if (ids.includes("sensitive")) t *= THREAT_SENSITIVE;
  if (ids.includes("blackout")) t *= THREAT_BLACKOUT;
  if (ids.includes("bells")) t *= THREAT_BELLS;
  return t;
}

/** Median (mean of the two middle values for even lengths). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function sweep(): { rows: Row[]; medianIndex: number; baseline: number } {
  const baseline = quotaFactor(PLAYERS); // no-modifier pressure = 0.53 at 3p
  const rows: Row[] = allCombos([...MODIFIER_POOL]).map((ids) => {
    const seconds = missionSeconds(ids);
    let pressureSum = 0;
    let quotaSum = 0;
    let lootSum = 0;
    for (const seed of SEEDS) {
      const rng = mulberry32((seed ^ hashStr(ids.join("+"))) >>> 0);
      const plan = planSpawns(rng, PLAYERS);
      const loot = planValue(plan.items);
      const quota = quotaFor(loot, PLAYERS, ids);
      pressureSum += quota / loot;
      quotaSum += quota;
      lootSum += loot;
    }
    const n = SEEDS.length;
    const meanPressure = pressureSum / n;
    const threat = threatFactor(ids);
    const fragileLoss = ids.includes("fragile") ? LOSS_FRAGILE : 1;
    const timeMul = BASE_TIME_S / seconds;
    const index = meanPressure * timeMul * threat * fragileLoss;
    return {
      ids,
      names: ids.map((id) => MODIFIERS[id]?.name ?? id).join(" + "),
      seconds,
      meanPressure,
      meanQuota: quotaSum / n,
      meanLoot: lootSum / n,
      threat,
      fragileLoss,
      timeMul,
      index,
      overBase: index / baseline,
      flagged: false,
    };
  });
  const medianIndex = median(rows.map((r) => r.index));
  for (const r of rows) r.flagged = r.index > medianIndex * FLAG_RATIO;
  // Most brutal first; ties broken by id join for full determinism.
  rows.sort((a, b) => b.index - a.index || a.ids.join("+").localeCompare(b.ids.join("+")));
  return { rows, medianIndex, baseline };
}

// ---------------------------------------------------------------- rendering
const f3 = (x: number): string => x.toFixed(3);

function tableText(rows: Row[]): string {
  const head =
    "#  combo".padEnd(34) + "sec  press  threat  frag  timex  index  xbase  flag";
  const lines = rows.map(
    (r, i) =>
      `${String(i + 1).padStart(2)}. ${r.ids.join("+")}`.padEnd(34) +
      `${r.seconds}`.padStart(3) +
      f3(r.meanPressure).padStart(7) +
      f3(r.threat).padStart(8) +
      f3(r.fragileLoss).padStart(6) +
      f3(r.timeMul).padStart(7) +
      f3(r.index).padStart(7) +
      f3(r.overBase).padStart(7) +
      (r.flagged ? "  FLAG" : ""),
  );
  return [head, ...lines].join("\n");
}

// id -> [index weight text, verified mechanical effect]
const MOD_EFFECTS: Record<string, [string, string]> = {
  blackout: [`${f3(THREAT_BLACKOUT)} threat (net)`, "enemy view range -15% (enemy.ts:115) + lot lights dead (client)"],
  fragile: [`${f3(LOSS_FRAGILE)} loss share`, "impact damage x2 for fragile/twoHandle cargo (world.ts:593)"],
  sensitive: [`${f3(THREAT_SENSITIVE)} threat`, "hear() radii x1.4 (world.ts:818), stacks with escalation"],
  shortclock: [`x${f3(720 / 630)} time term`, "shift 720 -> 630 s (mission.ts:74)"],
  bells: [`${f3(THREAT_BELLS)} threat`, "ALL carried cargo emits NOISE.BELL (12 m) hear() pings while moved (world.ts:573-580) + client audio"],
  wired: [`${f3(THREAT_WIRED)} threat (worst case)`, "Caretaker speed x1.2, capped at the esc-3 ceiling of 1.3 (enemy.ts speedMul)"],
  fatquota: ["pressure x1.15", "quota x1.15 after quotaFactor (mission.ts:81)"],
  storm: ["1.0", "client atmosphere only; zero server references found"],
};

function markdown(rows: Row[], medianIndex: number, baseline: number): string {
  const flagged = rows.filter((r) => r.flagged);
  const overBase = rows.filter((r) => r.overBase > FLAG_RATIO);
  const p = 1 / rows.length; // uniform 3-of-8 draw: 1/C(8,3)
  const out: string[] = [];
  const add = (...ls: string[]): void => out.push(...ls);

  add("# Mission Balance Sweep", "");
  add(
    `Generated by \`apps/server/scripts/balance-sweep.ts\` (deterministic; rerun with`,

    "`pnpm --filter @last-stop/server exec tsx scripts/balance-sweep.ts`).",
    "",
    "## Method",
    "",
    `Every 3-of-8 modifier combo (C(8,3) = ${rows.length}) is scored over ${SEEDS.length} fixed plan seeds at ${PLAYERS} players.`,

    "Each seed draws a spawn plan via the game's own `planSpawns`/`planValue`/`quotaFor`",

    "(`packages/shared/src/mission.ts`, `items.ts`), so the sweep uses the exact production quota math.",

    "rng = `mulberry32(seed ^ hashStr(ids))`.",
    "",
    "The difficulty index is deliberately crude and transparent:",
    "",
    "```",
    "pressure = quotaFor(planValue(plan.items), players, combo) / planValue(plan.items)",
    "index    = pressure x (720 / missionSeconds(combo)) x threat x fragile",
    `threat   = (wired ? ${THREAT_WIRED} : 1) x (sensitive ? ${THREAT_SENSITIVE} : 1) x (blackout ? ${THREAT_BLACKOUT} : 1)`,
    `fragile  = fragile ? ${LOSS_FRAGILE} : 1`,
    "```",
    "",
    "- `720 / missionSeconds` is the reciprocal of `timeFactor = missionSeconds/720`: SHORT SHIFT",
    "  (630 s) squeezes the same quota into 12.5% less time.",
    `- wired ${THREAT_WIRED} = verified Caretaker speed multiplier (enemy.ts:80).`,
    `- sensitive ${THREAT_SENSITIVE} = verified hear() radius multiplier (world.ts:818), approximating`,
    "  all enemy-side noise response.",
    `- blackout ${THREAT_BLACKOUT} is a **net** guess: the server only cuts enemy view range 15%`,
    "  (enemy.ts:115, 15 -> 12.75 m), but blackout also kills the lot lights client-side, i.e. player",
    "  visibility. We model the player-side loss as dominating and score blackout as a 1.1x threat",
    "  rather than the raw 0.85x enemy term. Least rigorous constant in the index: a modeling choice,",
    "  not a measurement.",
    `- fragile ${LOSS_FRAGILE} is a made-up expected-loss share (see caveats).`,
    "",
    `No-modifier baseline index at ${PLAYERS} players = \`quotaFactor(${PLAYERS})\` = ${f3(baseline)}.`,

    `The backlog acceptance line ("no combo should exceed ~1.6x base difficulty") is applied below as`,
    `\`index > ${FLAG_RATIO} x median combo index\` (= > ${f3(medianIndex * FLAG_RATIO)}) per the sweep spec;`,

    "the ratio to the true baseline is also reported in the `xbase` column so both readings are visible.",
    "",
    "## Modifier weights used",
    "",
    "| id | name | index weight | verified mechanical effect |",
    "| --- | --- | --- | --- |",
  );
  for (const id of MODIFIER_POOL) {
    const [w, e] = MOD_EFFECTS[id] ?? ["?", "?"];
    add(`| ${id} | ${MODIFIERS[id]?.name ?? id} | ${w} | ${e} |`);
  }
  add(
    "",
    "## Results",
    "",
    `Median combo index: **${f3(medianIndex)}**; flag line (1.6x median): **${f3(medianIndex * FLAG_RATIO)}**.`,
    "",
  );
  if (flagged.length === 0) {
    add(
      `No combo exceeds the flag line. Highest index is ${f3(rows[0]!.index)} (${rows[0]!.names}),`,

      `i.e. ${f3(rows[0]!.overBase)}x the no-modifier baseline.`,
    );
  } else {
    add(
      `${flagged.length} combo(s) exceed the flag line. Each specific combo has probability`,

      `${(100 * p).toFixed(2)}% per mission (uniform 3-of-8 draw, 1/C(8,3) = 1/${rows.length});`,

      `P(at least one flagged combo) = ${flagged.length}/${rows.length} = ` +
        `${((100 * flagged.length) / rows.length).toFixed(1)}% per mission.`,
      "",
      "| combo | index | xbase |",
      "| --- | --- | --- |",
    );
    for (const r of flagged) add(`| ${r.names} | ${f3(r.index)} | ${f3(r.overBase)} |`);
  }
  if (overBase.length > 0) {
    add(
      "",
      `Context (NOT the spec flag): ${overBase.length} combo(s) sit above ${FLAG_RATIO}x the true`,

      `no-modifier baseline (${f3(baseline)}, i.e. index > ${f3(baseline * FLAG_RATIO)}), which is the`,

      "stricter reading of the acceptance line:",
      "",
      "| combo | index | xbase |",
      "| --- | --- | --- |",
    );
    for (const r of overBase) add(`| ${r.names} | ${f3(r.index)} | ${f3(r.overBase)} |`);
  }
  add(
    "",
    "### All combos, most brutal first",
    "",
    "| # | combo | sec | pressure | threat | fragile | timex | index | xbase | flag |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  rows.forEach((r, i) =>
    add(
      `| ${i + 1} | ${r.names} | ${r.seconds} | ${f3(r.meanPressure)} | ${f3(r.threat)} | ` +
        `${f3(r.fragileLoss)} | ${f3(r.timeMul)} | ${f3(r.index)} | ${f3(r.overBase)} | ` +
        `${r.flagged ? "FLAG" : ""} |`,
    ),
  );
  add("", "### 5 most brutal", "");
  for (const r of rows.slice(0, 5)) add(`- ${r.names} -- index ${f3(r.index)} (${f3(r.overBase)}x base)`);
  add("", "### 5 most benign", "");
  for (const r of rows.slice(-5).reverse()) add(`- ${r.names} -- index ${f3(r.index)} (${f3(r.overBase)}x base)`);
  add(
    "",
    "### Draw frequency",
    "",
    "`pickModifiers` draws 3 of 8 uniformly without replacement (mission.ts:57), so all " +
      `${rows.length} combos are equally likely: ${(100 * p).toFixed(2)}% per mission each. ` +
      "A flagged combo is rare in absolute terms (~1-in-56 per mission per combo), but across a " +
      "session of ~30 missions the expected hits for any 3 specific combos is ~1.6, so brutal " +
      "combos WILL be seen in regular play.",
    "",
    "## Caveats -- what the index ignores (read before trusting it)",
    "",
    "1. **bells was under-weighted in v1; now 1.15.** The brief called CURSED BELLS client audio",
    "   only; the sweep found otherwise: any carried item moving > 1.2 m/s emits a NOISE.BELL",
    "   (12 m) hear() ping every ~1.6-3.1 s (world.ts:573-580), 16.8 m under sensitive. 1.15 is",
    "   still a guess at how much that stealth tax costs, not a measurement.",
    "2. **Escalation stacking, since capped.** The sweep's 7.1 m/s finding (chase at esc3+wired",
    "   vs sprint 5.2) drove a fix: speedMul is now capped at 1.3 (enemy.ts), so wired is a big",
    "   early-night threat and a no-op at escalation 3. The 1.2 weight is now a worst-case for",
    "   the first two escalations only; sensitive still stacks with escalation unbounded.",
    "3. **shortclock is double-edged.** The index counts only the time squeeze (720/630 = 1.143x), but",
    "   the shorter shift also cuts escalation-3 exposure from 180 s to 90 s (escalate at 300/540 s),",
    "   partially offsetting it.",
    "4. **blackout's 1.1 is a guess**, not a measurement; the player-visibility loss it stands in for",
    "   is unmodeled everywhere else.",
    "5. **fragile's 1.25 is a made-up constant.** Real cargo loss depends on handling, throws, van",
    "   bumps, and stabilizing; nothing in this sweep measures it.",
    "6. **Ignores player skill, hide spots, van route, enemy pathing luck, map geometry, spawn-point",
    "   distances** (planValue is distance-blind), crew coordination, and revive dynamics.",
    "7. **pressure is seed-stable by construction.** Quota scales with spawned value, so the pressure",
    "   ratio barely moves across seeds (rounding jitter < 0.001); the 5 seeds mostly scatter the",
    "   absolute $ quota / $ loot figures.",
    "8. **storm genuinely has no server effect** (verified: no references in apps/server/src), so storm",
    "   combos score only via their two partners; atmosphere-only distraction is not modeled.",
    "",
  );
  return out.join("\n") + "\n";
}

// --------------------------------------------------------------------- main
function main(): void {
  const { rows, medianIndex, baseline } = sweep();
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, markdown(rows, medianIndex, baseline));

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          config: {
            players: PLAYERS,
            seeds: SEEDS,
            baseTimeS: BASE_TIME_S,
            flagRatio: FLAG_RATIO,
            weights: {
              wired: THREAT_WIRED,
              sensitive: THREAT_SENSITIVE,
              blackout: THREAT_BLACKOUT,
              fragileLoss: LOSS_FRAGILE,
            },
          },
          baselineIndex: baseline,
          medianIndex,
          flagLine: medianIndex * FLAG_RATIO,
          reportPath: REPORT_PATH,
          results: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  const flagged = rows.filter((r) => r.flagged);
  console.log(
    `LAST STOP balance sweep -- ${rows.length} combos x ${SEEDS.length} seeds, ` +
      `players=${PLAYERS}, baseline index ${f3(baseline)}`,
  );
  console.log(
    `median index ${f3(medianIndex)}, flag line (1.6x median) ${f3(medianIndex * FLAG_RATIO)}`,
  );
  console.log(
    flagged.length
      ? `FLAGGED ${flagged.length}: ${flagged.map((r) => r.ids.join("+")).join(", ")}`
      : "no combo exceeds the flag line",
  );
  console.log(`wrote ${REPORT_PATH}\n`);
  console.log(tableText(rows));
  console.log("\n5 most brutal / 5 most benign:");
  const extremes = [...rows.slice(0, 5), ...rows.slice(-5).reverse()];
  for (const r of extremes) console.log(`  ${f3(r.index)}  x${f3(r.overBase)} base  ${r.names}`);
}

main();
