// Title screen: neon sign vibes, nickname + color + headgear, create/join.
import React, { useEffect, useRef, useState } from "react";
import { COLORS } from "@last-stop/shared";
import type { Prefs } from "../App.js";

// Invite links land here as /?code=CODE (legacy links used ?room=). Sanitize
// hard: uppercase, keep A-Z0-9 only, cap at 5 (the room-code format).
function inviteCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("code") ?? params.get("room") ?? "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

const HATS = [
  { label: "Hi-vis cap", glyph: "🧢" },
  { label: "Hard hat", glyph: "⛑" },
  { label: "Beanie", glyph: "🎩" },
  { label: "Headphones", glyph: "🎧" },
  { label: "Bare head", glyph: "🚫" },
];

export function TitleScreen({
  prefs,
  savePrefs,
  onEnter,
}: {
  prefs: Prefs;
  savePrefs: (p: Prefs) => void;
  onEnter: (mode: "create" | "join", code: string) => void;
}): React.ReactElement {
  const [code, setCode] = useState(inviteCodeFromUrl);
  const [busy, setBusy] = useState(false);
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  const prefilled = code !== "";

  // An invite-link code focuses the join field so the friend only adds a name.
  useEffect(() => {
    if (prefilled) joinInputRef.current?.focus();
    // mount-only: the URL cannot change while the title screen is up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="vacancy-strip">NO VACANCY</div>
        <h1 className="game-title">
          <span className="t-pale">PALE</span> <span className="t-lantern">LA<span className="t-dead">N</span>TERN</span>
          <span className="t-sub">ROADSIDE RECOVERY</span>
        </h1>
        <p className="tagline">
          The van broke down at the worst motel on the highway. Haul the valuables, find a distributor cap,
          and get out before The Caretaker collects <em>you</em>.
        </p>

        <div className="form-head">DUSTPAN RECOVERY CO. — NIGHT-SHIFT SIGN-IN · FORM 2AM-B</div>

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

        <div className="field">
          <span>Headgear</span>
          <div className="hats">
            {HATS.map((h, i) => (
              <button
                key={h.label}
                className={`hat-btn ${prefs.hat === i ? "sel" : ""}`}
                onClick={() => savePrefs({ ...prefs, hat: i })}
                title={h.label}
              >
                {h.glyph}
              </button>
            ))}
          </div>
        </div>

        <div className="title-actions">
          <button className="btn primary" disabled={busy} onClick={() => void go("create")}>
            Start a new shift
          </button>
          <div className="join-row">
            <input
              ref={joinInputRef}
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
          <b>WASD</b> move · <b>Shift</b> sprint · <b>Mouse</b> look · <b>LMB</b> haul cargo ·{" "}
          <b>RMB</b> stabilize · <b>E</b> stow / interact · <b>F</b> flashlight · <b>Q</b> ping ·{" "}
          <b>1/2/3</b> pack slots · <b>Z/X/C</b> quick chat · <b>Space</b> jump/handbrake · <b>H</b> horn
          <br />
          1–4 players · headphones recommended
        </div>
      </div>
    </div>
  );
}
