// Shared results screen: outcome, awards, per-player rows, instant replay.
import React, { useMemo } from "react";
import { COLORS, type MissionResults } from "@last-stop/shared";
import type { HudState } from "../game/store.js";
import type { Net } from "../net.js";

export function ResultsOverlay({ hud, net }: { hud: HudState; net: Net }): React.ReactElement {
  const results = useMemo<MissionResults | null>(() => {
    try {
      return hud.resultsJson ? (JSON.parse(hud.resultsJson) as MissionResults) : null;
    } catch {
      return null;
    }
  }, [hud.resultsJson]);

  const outcomeTitle =
    hud.outcome === "escaped" ? "GOT OUT ALIVE" : hud.outcome === "wipe" ? "CREW WIPED" : hud.outcome === "timeout" ? "OVERRUN AT DAWN" : "SHIFT OVER";
  const outcomeClass = hud.outcome === "escaped" ? "win" : "loss";

  return (
    <div className="results">
      <div className="results-panel">
        <h1 className={outcomeClass}>{outcomeTitle}</h1>
        {results && (
          <>
            <div className="results-summary">
              <div>
                <b>${results.salvage}</b>
                <span>salvage of ${results.quota} quota</span>
              </div>
              <div>
                <b>${results.cargoDamage}</b>
                <span>cargo damage</span>
              </div>
              <div>
                <b>{results.quotaMet ? "MET" : "MISSED"}</b>
                <span>quota</span>
              </div>
            </div>

            <div className="awards">
              {results.awards.loudest && (
                <div className="award">
                  <span className="award-name">LUDEST EMPLOYEE</span>
                  <span>{results.awards.loudest.nick} ({results.awards.loudest.noise} noise points)</span>
                </div>
              )}
              {results.awards.biggestMistake && (
                <div className="award">
                  <span className="award-name">MOST EXPENSIVE MISTAKE</span>
                  <span>{results.awards.biggestMistake.nick} (${results.awards.biggestMistake.loss} — {results.awards.biggestMistake.item})</span>
                </div>
              )}
              {results.awards.topHauler && (
                <div className="award">
                  <span className="award-name">TOP HAULER</span>
                  <span>{results.awards.topHauler.nick} (${results.awards.topHauler.value})</span>
                </div>
              )}
              {results.awards.medic && (
                <div className="award">
                  <span className="award-name">COWORKER OF THE NIGHT</span>
                  <span>{results.awards.medic.nick} ({results.awards.medic.rescues} rescues)</span>
                </div>
              )}
            </div>

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
                </tr>
              </thead>
              <tbody>
                {results.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="row-nick">
                      <span className="dot" style={{ background: COLORS[r.color % COLORS.length] }} />
                      {r.nick}
                    </td>
                    <td>${r.delivered}</td>
                    <td>{r.items}</td>
                    <td>{r.noise}</td>
                    <td>{r.rescues}</td>
                    <td>{r.biggestLoss > 0 ? `$${r.biggestLoss} (${r.lossItem})` : "—"}</td>
                    <td>{r.downed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
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
        <p className="hint">“Run it back” restarts immediately with a fresh seed for everyone in the room.</p>
      </div>
    </div>
  );
}
