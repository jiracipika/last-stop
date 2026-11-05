// Title screen: neon sign vibes, nickname + color, create/join.
import React, { useState } from "react";
import { COLORS } from "@last-stop/shared";
import type { Prefs } from "../App.js";

export function TitleScreen({
  prefs,
  savePrefs,
  onEnter,
}: {
  prefs: Prefs;
  savePrefs: (p: Prefs) => void;
  onEnter: (mode: "create" | "join", code: string) => void;
}): React.ReactElement {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [busy, setBusy] = useState(false);

  const go = async (mode: "create" | "join") => {
    if (busy) return;
    if (mode === "join" && !/^[A-Z0-9]{5}$/.test(code)) return;
    setBusy(true);
    try {
      await onEnter(mode, code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="title-screen">
      <div className="title-backdrop" />
      <div className="title-panel">
        <h1 className="game-title">
          <span className="t-pale">PALE</span> <span className="t-lantern">LANTERN</span>
          <span className="t-sub">ROADSIDE RECOVERY</span>
        </h1>
        <p className="tagline">
          The van broke down at the worst motel on the highway. Haul the valuables, find a distributor cap,
          and get out before The Caretaker collects <em>you</em>.
        </p>

        <label className="field">
          <span>Crew name</span>
          <input
            maxLength={16}
            value={prefs.nick}
            placeholder="Rookie"
            onChange={(e) => savePrefs({ ...prefs, nick: e.target.value })}
          />
        </label>

        <div className="field">
          <span>Uniform color</span>
          <div className="colors">
            {COLORS.map((c, i) => (
              <button
                key={c}
                aria-label={`color ${i}`}
                className={`swatch ${prefs.color === i ? "sel" : ""}`}
                style={{ background: c }}
                onClick={() => savePrefs({ ...prefs, color: i })}
              />
            ))}
          </div>
        </div>

        <div className="title-actions">
          <button className="btn primary" disabled={busy} onClick={() => void go("create")}>
            Start a new shift
          </button>
          <div className="join-row">
            <input
              maxLength={5}
              placeholder="CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && void go("join")}
            />
            <button className="btn" disabled={busy || !/^[A-Z0-9]{5}$/.test(code)} onClick={() => void go("join")}>
              Join crew
            </button>
          </div>
        </div>

        <div className="controls-hint">
          <b>WASD</b> move · <b>Shift</b> sprint · <b>Mouse</b> look · <b>LMB</b> grab/release ·{" "}
          <b>RMB</b> stabilize · <b>E</b> interact · <b>F</b> flashlight · <b>Q</b> ping ·{" "}
          <b>1/2/3</b> quick chat · <b>Space</b> jump/handbrake · <b>H</b> horn
          <br />
          1–4 players · headphones recommended
        </div>
      </div>
    </div>
  );
}
