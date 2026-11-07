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
//
// The severity weights, SEVERITY_CAP and comboSeverity() live in
// packages/shared/src/mission.ts and are imported here -- single source of
// truth, so the cap pickModifiers enforces and this report always agree.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MISSION,
  MODIFIERS,
  MODIFIER_POOL,
  MODIFIER_SEVERITY_WEIGHTS,
  SEVERITY_CAP,
  comboSeverity,
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

// Index weights come straight from the shared severity model (justifications
// live next to MODIFIER_SEVERITY_WEIGHTS in packages/shared/src/mission.ts and
// are reproduced in docs/BALANCE.md).
const W = MODIFIER_SEVERITY_WEIGHTS;

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
  sev: number; // comboSeverity(ids) -- the production cap math, pure
  dealP: number; // post-cap per-mission deal probability (exact)
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
  if (ids.includes("wired")) t *= W.wired;
  if (ids.includes("sensitive")) t *= W.sensitive;
  if (ids.includes("blackout")) t *= W.blackout;
  if (ids.includes("bells")) t *= W.bells;
  return t;
}

// ------------------------------------------------------------- severity cap
// Exact post-cap deal distribution over the 336 ordered initial draws
// (8x7x6, each 1/336). Mirrors pickModifiers' production mechanics: an
// over-cap initial draw re-rolls ONLY the last pick, from the remaining pool
// restricted to candidates that bring the combo back under SEVERITY_CAP
// (falling back to the raw remaining pool if that set were empty), and the
// redraw result is accepted as-is. Pure enumeration -- no rng involved.
function dealDistribution(): Map<string, number> {
  const deal = new Map<string, number>();
  const key = (ids: string[]): string => [...ids].sort().join("+");
  const bump = (k: string, p: number): void => deal.set(k, (deal.get(k) ?? 0) + p);
  for (const a of MODIFIER_POOL) {
    for (const b of MODIFIER_POOL) {
      if (b === a) continue;
      for (const x of MODIFIER_POOL) {
        if (x === a || x === b) continue;
        const first = [a, b];
        const p0 = 1 / 336;
        if (comboSeverity([a, b, x]) <= SEVERITY_CAP) {
          bump(key([a, b, x]), p0);
          continue;
        }
        const rest = MODIFIER_POOL.filter((id) => id !== a && id !== b && id !== x);
        const safe = rest.filter((id) => comboSeverity([...first, id]) <= SEVERITY_CAP);
        const bag = safe.length > 0 ? safe : rest;
        for (const c of bag) bump(key([...first, c]), p0 / bag.length);
      }
    }
  }
  return deal;
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
    const fragileLoss = ids.includes("fragile") ? W.fragile : 1;
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
      sev: comboSeverity(ids),
      dealP: 0,
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
    "#  combo".padEnd(34) + "sec  press  threat  frag  timex   sev  index  xbase  flag";
  const lines = rows.map(
    (r, i) =>
      `${String(i + 1).padStart(2)}. ${r.ids.join("+")}`.padEnd(34) +
      `${r.seconds}`.padStart(3) +
      f3(r.meanPressure).padStart(7) +
      f3(r.threat).padStart(8) +
      f3(r.fragileLoss).padStart(6) +
      f3(r.timeMul).padStart(7) +
      f3(r.sev).padStart(6) +
      f3(r.index).padStart(7) +
      f3(r.overBase).padStart(7) +
      (r.flagged ? "  FLAG" : ""),
  );
  return [head, ...lines].join("\n");
}

// id -> [index weight text, verified mechanical effect]
const MOD_EFFECTS: Record<string, [string, string]> = {
  blackout: [`${f3(W.blackout)} threat (net)`, "enemy view range -15% (enemy.ts:115) + lot lights dead (client)"],
  fragile: [`${f3(W.fragile)} loss share`, "impact damage x2 for fragile/twoHandle cargo (world.ts:593)"],
  sensitive: [`${f3(W.sensitive)} threat`, "hear() radii x1.4 (world.ts:818), stacks with escalation"],
  shortclock: [`x${f3(W.shortclock)} time term`, "shift 720 -> 630 s (mission.ts:74)"],
  bells: [`${f3(W.bells)} threat`, "ALL carried cargo emits NOISE.BELL (12 m) hear() pings while moved (world.ts:573-580) + client audio"],
  wired: [`${f3(W.wired)} threat (worst case)`, "Caretaker speed x1.2, capped at the esc-3 ceiling of 1.3 (enemy.ts speedMul)"],
  fatquota: [`x${f3(W.fatquota)} (comboSeverity)`, "quota x1.15 after quotaFactor (mission.ts:81); the sim index picks it up via pressure, comboSeverity as a flat term"],
  storm: [`${f3(W.storm)}`, "client atmosphere only; zero server references found"],
};

function markdown(rows: Row[], medianIndex: number, baseline: number, deal: Map<string, number>): string {
  const flagged = rows.filter((r) => r.flagged);
  const overBase = rows.filter((r) => r.overBase > FLAG_RATIO);
  const p = 1 / rows.length; // pre-cap uniform 3-of-8 draw: 1/C(8,3)
  const out: string[] = [];
  const add = (...ls: string[]): void => out.push(...ls);
  const pct = (x: number): string => `${(100 * x).toFixed(3)}%`;

  // ---- severity cap bookkeeping ----
  const capped = rows.filter((r) => r.sev > SEVERITY_CAP);
  const unreachable = rows.filter((r) => r.dealP === 0);
  const dealt = rows.filter((r) => r.dealP > 0);
  const maxDeal = dealt.reduce((m, r) => (r.dealP > m.dealP ? r : m), dealt[0]!);
  const minDeal = dealt.reduce((m, r) => (r.dealP < m.dealP ? r : m), dealt[0]!);
  // sev extremes computed over the sets, NOT row order: the sim index carries
  // a tiny pressure jitter that pure comboSeverity does not.
  const cappedSevMax = Math.max(...capped.map((r) => r.sev));
  const cappedSevMin = Math.min(...capped.map((r) => r.sev));
  const keptSevMax = Math.max(...dealt.map((r) => r.sev));
  const firstKept = dealt.find((r) => r.sev === keptSevMax)!;
  const OVER_BASE_SEV = 1.6 + 1e-9; // epsilon: shortclock term is 8/7 and can dust 1.6
  const reachableHot = dealt.filter((r) => r.sev > OVER_BASE_SEV);
  const hotShare = reachableHot.reduce((s, r) => s + r.dealP, 0);
  const preCapHot = rows.filter((r) => r.sev > OVER_BASE_SEV);
  const pSum = [...deal.values()].reduce((s, x) => s + x, 0);

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
    `threat   = (wired ? ${W.wired} : 1) x (sensitive ? ${W.sensitive} : 1) x (blackout ? ${W.blackout} : 1) x (bells ? ${W.bells} : 1)`,
    `fragile  = fragile ? ${W.fragile} : 1`,
    "```",
    "",
    "The per-modifier weights are the production severity weights (`MODIFIER_SEVERITY_WEIGHTS` in",
    "`packages/shared/src/mission.ts`) imported here, so this report and the `pickModifiers`",
    "severity cap score every combo with the same numbers. `comboSeverity(combo)` = the product of",
    "a combo's weights (reported in the `sev` column) is exactly what the draw's `SEVERITY_CAP`",
    "compares against; it matches the `xbase` column up to the pressure term's rounding jitter",
    "(fatquota enters the sim index via pressure and comboSeverity as a flat x1.15 -- same effect).",
    "",
    "- `720 / missionSeconds` is the reciprocal of `timeFactor = missionSeconds/720`: SHORT SHIFT",
    "  (630 s) squeezes the same quota into 12.5% less time.",
    `- wired ${W.wired} = verified Caretaker speed multiplier (enemy.ts:80).`,
    `- sensitive ${W.sensitive} = verified hear() radius multiplier (world.ts:818), approximating`,
    "  all enemy-side noise response.",
    `- blackout ${W.blackout} is a **net** guess: the server only cuts enemy view range 15%`,
    "  (enemy.ts:115, 15 -> 12.75 m), but blackout also kills the lot lights client-side, i.e. player",
    "  visibility. We model the player-side loss as dominating and score blackout as a 1.1x threat",
    "  rather than the raw 0.85x enemy term. Least rigorous constant in the index: a modeling choice,",
    "  not a measurement.",
    `- fragile ${W.fragile} is a made-up expected-loss share (see caveats).`,
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
  // ---------------------------------------------------------------- cap section
  add(
    "",
    "## Severity cap (SEVERITY_CAP = " + f3(SEVERITY_CAP) + ")",
    "",
    "`pickModifiers` (`packages/shared/src/mission.ts`) no longer deals the harshest stacks at full",
    "probability. Mechanics:",
    "",
    "- Draw 3 of 8 uniformly as before: one rng call per pick from the shrinking pool, in the same",
    "  order, so a seed deals the same first two picks it always did.",
    "- If `comboSeverity(draw) > " + f3(SEVERITY_CAP) + "`, ONLY the last pick is re-rolled: one extra rng call, no loop.",
    "  The redraw bag is the remaining pool restricted to candidates that bring the combo back",
    "  under the cap; the redraw result is accepted as-is. The re-roll always lands on a DIFFERENT",
    "  id (the rejected pick was spliced out of the pool), so the dealt combo never equals the",
    "  over-cap draw that triggered it.",
    "- Refinement vs the raw \"re-draw and accept unconditionally\" rule: the redraw bag is filtered",
    "  to under-cap candidates. Unfiltered, a re-roll can still land over the cap (e.g.",
    "  LIGHT SLEEPER + SHORT SHIFT + AMPED UP re-rolled to EGGSHELL CONTRACT = 2.0), which would",
    "  (a) break the invariant that no dealt combo exceeds the cap and (b) keep every combo",
    "  reachable, leaving this reachability section nothing to report. The filtered bag is never",
    "  empty with the current weights: any storm combo weighs <= 1.4 x 1.25 x 1.0 = 1.75, so a",
    "  cap-firing draw can never contain STORM CELL, and storm (weight 1.0) therefore always",
    "  survives into the bag. If weights ever change so it could be empty, the raw remaining pool",
    "  is the fallback (still bounded, no loop).",
    "",
    "### What the cap excludes",
    "",
  );
  add(
    `CAP = ${f3(SEVERITY_CAP)} excludes ${capped.length} of ${rows.length} combos (${pct(capped.length / rows.length)} of the`,

    `pre-cap distribution -- the "top ~15%" line): severities ${f3(cappedSevMin)} to`,

    `${f3(cappedSevMax)}. Highest-severity combo still dealt: ${firstKept.names} at sev ${f3(keptSevMax)}.`,
    "",
    "| excluded combo | sev |",
    "| --- | --- |",
  );
  for (const r of capped) add(`| ${r.names} | ${f3(r.sev)} |`);
  add(
    "",
    "The cap fires on " + `${capped.length}/${rows.length} = ${pct(capped.length / rows.length)}` + " of initial draws (the same combos: severity is",

    "order-independent, so every permutation of an over-cap combo trips it). Those missions",
    "re-roll their third pick once; the dealt combo is always back under the cap.",
    "",
    "### Post-cap reachability",
    "",
    "Exact per-combo deal probabilities, from enumerating all 336 ordered initial draws",
    "(8x7x6, each 1/336) plus the production redraw rule above -- no rng involved; they sum to",

    `${f3(pSum)}:`,
    "",
  );
  if (unreachable.length > 0) {
    add(
      `- ${unreachable.length} combos are UNREACHABLE -- the cap can never deal them:`,
      "",
    );
    for (const r of unreachable) add(`  - ${r.names} (sev ${f3(r.sev)})`);
    add("");
  } else {
    add("- No combo is fully unreachable (every over-cap combo stays redraw-reachable).", "");
  }
  add(
    `- ${dealt.length} combos remain reachable. Per-mission deal probability ranges from`,

    `${pct(minDeal.dealP)} (${minDeal.names}) to ${pct(maxDeal.dealP)} (${maxDeal.names}); the pre-cap`,

    `uniform value was ${pct(p)}. The distribution is no longer uniform: combos that are the only`,
    "    safe re-roll target for a common over-cap first pair gain the most (STORM CELL after",
    "    EGGSHELL CONTRACT + LIGHT SLEEPER).",
    `- Reachable combos still above 1.6x base severity (sev > 1.6): ${reachableHot.length} of ${dealt.length};`,
    `  expected share of missions dealing one of them: ${pct(hotShare)} (pre-cap: ${preCapHot.length}/${rows.length}`,
    `  combos = ${pct(preCapHot.length / rows.length)} of missions). The mission can still be hard -- the cap only`,
    "  removes the harshest ~15% of the distribution.",
    "",
  );
  add(
    "",
    "### All combos, most brutal first",
    "",
    "| # | combo | sec | pressure | threat | fragile | timex | sev | index | xbase | deal% | flag |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  rows.forEach((r, i) =>
    add(
      `| ${i + 1} | ${r.names} | ${r.seconds} | ${f3(r.meanPressure)} | ${f3(r.threat)} | ` +
        `${f3(r.fragileLoss)} | ${f3(r.timeMul)} | ${f3(r.sev)} | ${f3(r.index)} | ${f3(r.overBase)} | ` +
        `${pct(r.dealP)} | ${r.flagged ? "FLAG" : ""} |`,
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
    `Pre-cap, \`pickModifiers\` drew 3 of 8 uniformly without replacement, so all ${rows.length} combos`,
    `were equally likely at ${pct(p)} per mission. With SEVERITY_CAP the live distribution is no`,
    "longer uniform: the \"deal%\" column above and the \"Post-cap reachability\" section give the",
    `exact numbers. The ${unreachable.length} capped combos can never appear; the rest still show`,
    "up regularly (the expected hits for any 3 specific reachable combos across a ~30-mission",
    `session is ~1.6), just never harsher than sev ${f3(SEVERITY_CAP)}.`,
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
  const deal = dealDistribution();
  const comboKey = (ids: string[]): string => [...ids].sort().join("+");
  for (const r of rows) r.dealP = deal.get(comboKey(r.ids)) ?? 0;
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, markdown(rows, medianIndex, baseline, deal));

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          config: {
            players: PLAYERS,
            seeds: SEEDS,
            baseTimeS: BASE_TIME_S,
            flagRatio: FLAG_RATIO,
            severityCap: SEVERITY_CAP,
            weights: MODIFIER_SEVERITY_WEIGHTS,
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
  const capped = rows.filter((r) => r.sev > SEVERITY_CAP);
  const unreachableCount = rows.filter((r) => r.dealP === 0).length;
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
  console.log(
    `severity cap ${f3(SEVERITY_CAP)}: ${capped.length}/${rows.length} combos excluded ` +
      `(${capped.map((r) => r.ids.join("+")).join(", ") || "none"}); ` +
      `unreachable post-cap: ${unreachableCount}`,
  );
  console.log(`wrote ${REPORT_PATH}\n`);
  console.log(tableText(rows));
  console.log("\n5 most brutal / 5 most benign:");
  const extremes = [...rows.slice(0, 5), ...rows.slice(-5).reverse()];
  for (const r of extremes) console.log(`  ${f3(r.index)}  x${f3(r.overBase)} base  ${r.names}`);
}

main();
