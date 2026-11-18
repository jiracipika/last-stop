// Title screen: neon sign vibes, nickname + color + headgear, create/join.
import React, { useEffect, useRef, useState } from "react";
import { CrewOptions } from "./CrewOptions.js";
import type { Prefs } from "../App.js";

// Invite links land here as /?code=CODE (legacy links used ?room=). Sanitize
// hard: uppercase, keep A-Z0-9 only, cap at 5 (the room-code format).
function inviteCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("code") ?? params.get("room") ?? "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

export function TitleScreen({
  prefs,
  savePrefs,
  onEnter,
}: {
  prefs: Prefs;
  savePrefs: (p: Prefs) => void;
  onEnter: (mode: "create" | "join", code: string) => Promise<void>;
}): React.ReactElement {
  const [code, setCode] = useState(inviteCodeFromUrl);
  const [busy, setBusy] = useState(false);
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  const prefilled = code !== "";
  const createLabel = busy ? "Connecting…" : "Start a new shift";

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
        <h1 className="game-title">LAST<span>STOP</span></h1>
        <p className="tagline">
          Your recovery van is stranded at the Pale Lantern Motel. Haul enough salvage, fix the van,
          and get the crew out before the Caretaker catches you.
        </p>
        <div className="form-head">Night shift sign-in</div>

        <label className="field">
          <span>Crew name</span>
          <input
            maxLength={16}
            value={prefs.nick}
            placeholder="Rookie"
            onChange={(e) => savePrefs({ ...prefs, nick: e.target.value })}
          />
        </label>

        <CrewOptions color={prefs.color} hat={prefs.hat}
          onChange={(color, hat) => savePrefs({ ...prefs, color, hat })} />

        <div className="title-actions">
          <button className="btn primary" disabled={busy} onClick={() => void go("create")}>
            {createLabel}
          </button>
          <div className="join-row">
            <input
              ref={joinInputRef}
              maxLength={5}
              placeholder="CODE"
              aria-label="Room code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && void go("join")}
            />
            <button className="btn" disabled={busy || !/^[A-Z0-9]{5}$/.test(code)} onClick={() => void go("join")}>
              Join crew
            </button>
          </div>
        </div>

        <details className="title-controls">
          <summary>Controls</summary>
          <div className="controls-hint">
            <span><b>WASD</b> Move or drive · <b>Mouse</b> Look · <b>Shift</b> Sprint</span>
            <span><b>E</b> Interact or stow · <b>LMB</b> Carry · <b>G</b> Drop</span>
            <span><b>Space</b> Jump or brake · <b>1–3</b> Pack slots · <b>Esc</b> Pause</span>
          </div>
        </details>
      </div>
    </div>
  );
}
