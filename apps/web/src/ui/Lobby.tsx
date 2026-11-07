// Crew room overlay: roster, ready-up, invite code, host start.
import React, { useState } from "react";
import { COLORS } from "@last-stop/shared";
import type { Net } from "../net.js";
import type { HudState } from "../game/store.js";
import type { Prefs } from "../App.js";

export function LobbyOverlay({
  net,
  hud,
  prefs,
  onLeave,
}: {
  net: Net;
  hud: HudState;
  prefs: Prefs;
  onLeave: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const st = net.state;
  if (!st) return <div className="lobby" />;
  const players = [...st.players.entries()].map(([sid, p]) => ({ sid, p }));
  const me = st.players.get(net.sid);
  const allReady = players.every(({ p }) => p.ready);

  // /?code= pre-fills the title screen's join field (Title.inviteCodeFromUrl)
  const inviteLink = `${location.origin}${location.pathname}?code=${hud.roomCode}`;

  return (
    <div className="lobby">
      <div className="lobby-panel">
        <h2>Crew Room</h2>
        <div className="invite">
          <span>
            Room code <b className="code">{hud.roomCode}</b>
          </span>
          <button
            className="btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteLink).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => undefined,
              );
            }}
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>
        <ul className="roster">
          {players.map(({ sid, p }) => (
            <li key={sid} className={p.connected ? "" : "dc"}>
              <span className="dot" style={{ background: COLORS[p.color % COLORS.length] }} />
              <span className="nick">{p.nick}{sid === net.sid ? " (you)" : ""}</span>
              {p.host && <span className="host-tag">host</span>}
              <span className={`ready ${p.ready ? "on" : ""}`}>{p.ready ? "READY" : "warming up"}</span>
              {!p.connected && <span className="dc-tag">reconnecting…</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, i) => (
            <li key={`empty${i}`} className="empty">
              <span className="dot ghost" /> waiting for a coworker…
            </li>
          ))}
        </ul>
        <div className="lobby-actions">
          <button className="btn" onClick={() => net.act("ready")}>
            {me?.ready ? "Not ready" : "Ready up"}
          </button>
          {me?.host && (
            <button className="btn primary" disabled={!allReady || players.length === 0} onClick={() => net.act("start")}>
              Start the shift {players.length === 1 ? "(solo practice)" : `(${players.length} crew)`}
            </button>
          )}
          <button className="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
        {prefs.nick === "" && <p className="hint">Tip: pick a name and color before starting.</p>}
      </div>
    </div>
  );
}
