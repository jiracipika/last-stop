// Results screen: DUSTPAN RECOVERY shift report (debrief) — outcome, crew
// ledger, employee file, management notes, personnel file, instant replay.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MODIFIERS, type MissionAwardRow, type MissionResults } from "@last-stop/shared";
import { crewHex } from "../game/palette.js";
import type { HudState } from "../game/store.js";
import type { Net } from "../net.js";

const money = (n: number): string => `$${Math.round(n)}`;

// Shift clock for the report meta line: 754s -> "12:34".
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

// Management notes for the report footer, keyed to outcome. Picked at random
// on mount; nothing here needs to be reproducible. 10 lines total, 2-4 shown.
const MGMT_NOTES: Record<string, string[]> = {
  escaped: [
    "Quota met. Do not discuss the smell in R2.",
    "Van returned with all four doors and most of its paint. Management is calling it a win.",
    "Crew clocked out before the office opened. This is the preferred way to leave a site.",
    "Cargo appraised, sold, forgotten. That is the healthy way to do this job.",
  ],
  timeout: [
    "Corporate notes the van was not full. Corporate was not there.",
    "The clock beat the crew to the van. Dawn wins again; it always was a morning person.",
    "Remaining inventory has been written off. Briefly, so was the crew.",
  ],
  wipe: [
    "Crew unaccounted for as of dawn. Payroll resolved this efficiently.",
    "HR prefers the term 'involuntary early retirement'.",
    "The motel declined to comment. The motel also declined to unlock the doors.",
  ],
};

function pickNotes(outcome: string, count: number): string[] {
  const pool = [...(MGMT_NOTES[outcome] ?? MGMT_NOTES.wipe ?? [])];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  return out;
}

// Personnel file: per-browser personal bests, kept in localStorage
// ("laststop.best", same pattern as App's "laststop.prefs"). haul = best
// single-shift salvage (max, any outcome); time = fastest successful shift in
// seconds (min, escaped runs only). A missing/blank record means the section
// stays hidden until a first shift files one.
const BEST_KEY = "laststop.best";

interface PersonnelBest {
  haul?: number;
  time?: number;
}

function loadBest(): PersonnelBest {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as PersonnelBest;
    return {
      haul: typeof p.haul === "number" ? p.haul : undefined,
      time: typeof p.time === "number" ? p.time : undefined,
    };
  } catch {
    return {};
  }
}

// Crew status derived from outcome + per-row stats (all client-visible data).
// Legacy fallback only: the server now stamps each row with what the player
// actually was at the outcome moment (row.status).
function crewStatus(outcome: string, r: MissionAwardRow): { label: string; left: boolean } {
  if (outcome === "escaped") {
    if (r.downed >= 3) return { label: "barely clocked out", left: false };
    if (r.delivered <= 0) return { label: "clocked out (empty-handed)", left: false };
    return { label: "clocked out", left: false };
  }
  if (outcome === "timeout" && r.downed > 0) return { label: "left on site (limping)", left: true };
  return { label: "left on site", left: true };
}

// Server-provided status wins (it knows who was in the van and who bled out);
// fall back to the outcome-only guess for payloads missing the field.
function rowStatus(outcome: string, r: MissionAwardRow): { label: string; left: boolean } {
  if (r.status === "escaped") {
    if (r.downed >= 3) return { label: "barely clocked out", left: false };
    if (r.delivered <= 0) return { label: "clocked out (empty-handed)", left: false };
    return { label: "clocked out", left: false };
  }
  if (r.status === "down") {
    // dead, but the crew hauled the body home — a different kind of kept promise
    if (r.recovered) return { label: "brought home", left: false };
    return { label: "did not clock out", left: true };
  }
  if (r.status === "left") {
    return { label: r.downed > 0 ? "left on site (limping)" : "left on site", left: true };
  }
  return crewStatus(outcome, r);
}

export function ResultsOverlay({ hud, net }: { hud: HudState; net: Net }): React.ReactElement {
  const results = useMemo<MissionResults | null>(() => {
    try {
      return hud.resultsJson ? (JSON.parse(hud.resultsJson) as MissionResults) : null;
    } catch {
      return null;
    }
  }, [hud.resultsJson]);

  const outcome = hud.outcome || results?.outcome || "";
  const win = outcome === "escaped";

  // 2-4 management notes, sampled without replacement on mount.
  const [notes] = useState<string[]>(() => pickNotes(outcome, 2 + Math.floor(Math.random() * 3)));

  const outcomeTitle =
    outcome === "escaped" ? "GOT OUT ALIVE" : outcome === "wipe" ? "CREW WIPED" : outcome === "timeout" ? "OVERRUN AT DAWN" : "SHIFT OVER";
  const outcomeClass = win ? "win" : "loss";
  const outcomeLine =
    outcome === "escaped"
      ? results && !results.quotaMet
        ? "Out the gate short of quota. Management will be scheduling a meeting about it."
        : "Quota met, van loaded, crew aboard. Nobody made eye contact on the way out."
      : outcome === "timeout"
        ? "The clock hit zero before the van hit the highway. Dawn rolled in; the crew rolled out."
        : outcome === "wipe"
          ? "The night shift is not currently accepting new applicants."
          : "The printer jammed. The meeting will continue until morale improves.";
  const stamp = win ? "PAID IN FULL" : outcome === "wipe" ? "POSITIONS CLOSED" : outcome === "timeout" ? "DO NOT RE-ENTER" : "FILED";

  const conditions = hud.modifiers.map((m) => MODIFIERS[m]?.name ?? m.toUpperCase()).join(" · ") || "STANDARD DREAD";
  const awardsCount = results ? Object.values(results.awards).filter(Boolean).length : 0;
  const crewSize = results ? results.rows.length : 0;
  // Actual server-measured shift length; omitted from the line if a payload
  // predates the field.
  const shiftLen =
    typeof results?.shiftSeconds === "number" ? clock(Math.max(0, Math.round(results.shiftSeconds))) : "";

  // Personnel file bookkeeping. Reads once on mount, then re-reads + persists
  // once per fresh results payload (ref-guarded, so re-renders and StrictMode
  // double-fired effects can't double-count a record). A stat is only flagged
  // as a new record when it beats a value that already existed — a first-ever
  // entry files itself quietly.
  const bestRef = useRef<string | null>(null);
  const [best, setBest] = useState<PersonnelBest>(loadBest);
  const [newHaul, setNewHaul] = useState(false);
  const [newTime, setNewTime] = useState(false);

  useEffect(() => {
    if (!results || bestRef.current === hud.resultsJson) return;
    bestRef.current = hud.resultsJson;
    const prev = loadBest();
    const next: PersonnelBest = { ...prev };
    let haulPB = false;
    let timePB = false;
    const haul = Math.round(results.salvage);
    if (typeof prev.haul === "number") {
      if (haul > prev.haul) {
        next.haul = haul;
        haulPB = true;
      }
    } else {
      next.haul = haul;
    }
    if (win && typeof results.shiftSeconds === "number") {
      const t = Math.max(0, Math.round(results.shiftSeconds));
      if (typeof prev.time === "number") {
        if (t < prev.time) {
          next.time = t;
          timePB = true;
        }
      } else {
        next.time = t;
      }
    }
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable (private mode etc): bests just don't persist */
    }
    setBest(next);
    setNewHaul(haulPB);
    setNewTime(timePB);
  }, [results, win, hud.resultsJson]);

  return (
    <div className="results">
      <div className="results-panel">
        <div className="report-head">
          <span className="report-brand">DUSTPAN RECOVERY CO.</span>
          <span className="report-motto">WE TOW REGRETS</span>
        </div>
        <div className="report-doc">SHIFT REPORT — PALE LANTERN SITE</div>
        <div className="report-meta">
          FORM 2AM-B · ROOM {hud.roomCode || "-----"} · CREW OF {crewSize}
          {shiftLen && <> · SHIFT LENGTH {shiftLen}</>} · SITE CONDITIONS: {conditions}
        </div>

        {/* stamp anchors to the verdict title (not a fixed page offset), so a
            long SITE CONDITIONS line can never run underneath it; on narrow
            screens it drops into the flow below the title */}
        <div className="report-verdict">
          <h1 className={outcomeClass}>{outcomeTitle}</h1>
          <span className={`report-stamp ${outcomeClass}`}>{stamp}</span>
        </div>
        <p className="report-line">{outcomeLine}</p>

        {results && crewSize > 0 && (
          <>
            <div className="results-summary">
              <div>
                <b>{money(results.salvage)}</b>
                <span>salvage of {money(results.quota)} quota</span>
              </div>
              <div>
                <b>{money(results.cargoDamage)}</b>
                <span>cargo damage</span>
              </div>
              <div>
                <b>{results.quotaMet ? "MET" : "MISSED"}</b>
                <span>quota</span>
              </div>
            </div>

            <div className="report-sec">CREW LEDGER</div>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th />
                    <th>delivered</th>
                    <th>items</th>
                    <th>noise</th>
                    <th>rescues</th>
                    <th>biggest loss</th>
                    <th>times down</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((r, i) => {
                    const st = rowStatus(outcome, r);
                    return (
                      <tr key={i}>
                        <td className="row-nick">
                          <span className="dot" style={{ background: crewHex(r.color) }} />
                          {r.nick}
                        </td>
                        <td>{money(r.delivered)}</td>
                        <td>{r.items}</td>
                        <td>{Math.round(r.noise)}</td>
                        <td>{r.rescues}</td>
                        <td>{r.biggestLoss > 0 ? `${money(r.biggestLoss)} (${r.lossItem})` : "—"}</td>
                        <td>{r.downed}</td>
                        <td className={st.left ? "st-left" : "st-out"}>{st.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {awardsCount > 0 && (
              <>
                <div className="report-sec">EMPLOYEE FILE — DO NOT LAMINATE</div>
                <div className="awards">
                  {results.awards.loudest && (
                    <div className="award">
                      <span className="award-name">LOUDEST EMPLOYEE</span>
                      <span>{results.awards.loudest.nick} ({Math.round(results.awards.loudest.noise)} noise points)</span>
                    </div>
                  )}
                  {results.awards.biggestMistake && (
                    <div className="award">
                      <span className="award-name">MOST EXPENSIVE MISTAKE</span>
                      <span>{results.awards.biggestMistake.nick} ({money(results.awards.biggestMistake.loss)} — {results.awards.biggestMistake.item})</span>
                    </div>
                  )}
                  {results.awards.topHauler && (
                    <div className="award">
                      <span className="award-name">TOP HAULER</span>
                      <span>{results.awards.topHauler.nick} ({money(results.awards.topHauler.value)})</span>
                    </div>
                  )}
                  {results.awards.medic && (
                    <div className="award">
                      <span className="award-name">COWORKER OF THE NIGHT</span>
                      <span>{results.awards.medic.nick} ({results.awards.medic.rescues} rescues)</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {(!results || crewSize === 0) && (
          <p className="report-line">The detailed sheet jammed in the printer. Assume everyone did great.</p>
        )}

        <div className="mgmt-notes">
          <div className="report-sec">MANAGEMENT NOTES</div>
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>

        {(best.haul !== undefined || best.time !== undefined) && (
          <div className="personnel">
            <div className="report-sec">PERSONNEL FILE — PERMANENT RECORD</div>
            <ul>
              {best.haul !== undefined && (
                <li className={newHaul ? "record" : undefined}>best haul {money(best.haul)}</li>
              )}
              {best.time !== undefined && (
                <li className={newTime ? "record" : undefined}>fastest clean exit {clock(best.time)}</li>
              )}
            </ul>
          </div>
        )}

        <div className="results-actions">
          <button className="btn primary" onClick={() => net.act("replay")}>
            Run it back
          </button>
          <button
            className="btn"
            onClick={() => {
              net.leave();
              location.reload();
            }}
          >
            Back to title
          </button>
        </div>
        <p className="hint">“Run it back” returns everyone to the gas stop to buy supplies and ready up for a fresh shift.</p>
      </div>
    </div>
  );
}

