// Crew room overlay: roster, ready-up, invite code, host start + the
// gas-station stop (per-player pre-shift shop).
import React, { useState } from "react";
import { SHOP } from "@last-stop/shared";
import { crewHex } from "../game/palette.js";
import { CrewOptions, HEADGEAR } from "./CrewOptions.js";
import type { Net } from "../net.js";
import type { HudState } from "../game/store.js";
import type { Prefs } from "../App.js";

export function LobbyOverlay({
  net,
  hud,
  prefs,
  savePrefs,
  onLeave,
}: {
  net: Net;
  hud: HudState;
  prefs: Prefs;
  savePrefs: (prefs: Prefs) => void;
  onLeave: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [outfit, setOutfit] = useState<{ nick: string; color: number; hat: number } | null>(null);
  const st = net.state;
  if (!st) return <div className="lobby" />;
  const players = [...st.players.entries()].map(([sid, p]) => ({ sid, p }));
  const me = st.players.get(net.sid);
  const allReady = players.every(({ p }) => p.ready && p.connected);
  const connected = net.status === "connected";
  const taken = players.filter(({ sid }) => sid !== net.sid).map(({ p }) => p.color);

  // /?code= pre-fills the title screen's join field (Title.inviteCodeFromUrl)
  const inviteLink = `${location.origin}${location.pathname}?code=${hud.roomCode}`;

  return (
    <div className="lobby">
      {/* gas-station stop: last chance before the lot. Personal budget; the
          coffee and the flashlight cost 4+7 of a $10 allowance — pick one. */}
      <div className="lobby-panel gas-stop">
        <h2>Gas &amp; Sips</h2>
        <div className="gas-budget">
          POCKET MONEY <b>${me?.budget ?? SHOP.BUDGET}</b>
        </div>
        <ul className="gas-shelf">
          {SHOP.ITEMS.map((item) => {
            const owned = me ? (item.id === "coffee" ? me.caffeinated : me.hasFlashlight) : false;
            return (
              <li key={item.id} className={owned ? "owned" : ""}>
                <div className="gas-item">
                  <span className="gas-name">{item.id === "coffee" ? "☕" : "🔦"} {item.name}</span>
                  <span className="gas-price">${item.price}</span>
                </div>
                <p>{item.desc}</p>
                <button
                  className="btn small"
                  disabled={!connected || !me || owned || (me?.budget ?? 0) < item.price}
                  onClick={() => net.act("shop", { item: item.id })}
                >
                  {owned ? "Purchased" : `Buy ${item.name}`}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="hint">Supplies are optional. Buy them before the crew leaves.</p>
      </div>
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
              <span className="dot" style={{ background: crewHex(p.color) }} />
              <span className="nick">{p.nick}{sid === net.sid ? " (you)" : ""}<small>{HEADGEAR[p.hat]}</small></span>
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
        {me && (outfit ? (
          <div className="lobby-outfit">
            <label className="field outfit-nick">
              <span>Crew name</span>
              <input
                maxLength={16}
                value={outfit.nick}
                placeholder="Rookie"
                onChange={(e) => setOutfit({ ...outfit, nick: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <CrewOptions color={outfit.color} hat={outfit.hat} taken={taken}
              onChange={(color, hat) => setOutfit({ ...outfit, color, hat })} />
            <button className="btn small" disabled={!connected || taken.includes(outfit.color) || !outfit.nick.trim()} onClick={() => {
              net.act("profile", { nick: outfit.nick.trim() || me.nick, color: outfit.color, hat: outfit.hat });
              savePrefs({ ...prefs, nick: outfit.nick.trim() || prefs.nick, color: outfit.color, hat: outfit.hat });
              setOutfit(null);
            }}>Save outfit</button>
            <button className="btn small ghost" onClick={() => setOutfit(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn small ghost outfit-button" onClick={() => setOutfit({ nick: me.nick, color: me.color, hat: me.hat })}>Edit outfit &amp; name</button>
        ))}

        {/* first-shift briefing for the wait: what the night looks like and
            which keys matter. Dismissing it remembers the choice. */}
        <details
          className="lobby-howto"
          open={!prefs.seenHowto}
          onToggle={(e) => {
            if (!(e.currentTarget as HTMLDetailsElement).open && !prefs.seenHowto) {
              savePrefs({ ...prefs, seenHowto: true });
            }
          }}
        >
          <summary>New here? How a shift goes</summary>
          <ol className="howto-steps">
            <li>Ready up; the host starts the shift. One random driver brings the van in through three gates — that driver is tonight's exit driver.</li>
            <li>Haul salvage to the van until you hit quota. <b>LMB</b> carries, <b>E</b> stows small loot in your pack, doors bang — stay quiet.</li>
            <li>The Caretaker walks the lot. The flashlight helps you; sprint noise doesn't. <b>Q</b> pings, <b>Z/X/C</b> quick chat.</li>
            <li>Find the distributor cap, install it, pile in, drive west. The van won't leave a downed exit driver — stabilize (<b>RMB</b>) or carry the body home (<b>E</b>).</li>
          </ol>
        </details>
        <div className="lobby-actions">
          <button className="btn" disabled={!me || !connected} onClick={() => net.act("ready")}>
            {me?.ready ? "Not ready" : "Ready up"}
          </button>
          {me?.host && (
            <button className="btn primary" disabled={!connected || !allReady || players.length === 0 || !!outfit} onClick={() => net.act("start")}>
              Start the shift {players.length === 1 ? "(solo practice)" : `(${players.length} crew)`}
            </button>
          )}
          <button className="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
        {me?.host && !allReady && <p className="hint">Start the shift when everyone is ready.</p>}
      </div>
    </div>
  );
}
