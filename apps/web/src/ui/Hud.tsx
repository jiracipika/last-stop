// In-mission HUD: vitals, quota/timer, scanner, teammates, prompts.
import React from "react";
import { COLORS } from "@last-stop/shared";
import type { HudState } from "../game/store.js";
import { activeNet } from "../net.js";

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export function Hud({
  hud,
  paused,
  onSpectateNext,
}: {
  hud: HudState;
  paused: boolean;
  onSpectateNext: () => void;
}): React.ReactElement {
  const quotaPct = Math.min(100, hud.quota > 0 ? (hud.salvage / hud.quota) * 100 : 0);
  const danger = hud.timer < 120;
  const quotaMet = hud.salvage >= hud.quota;
  const directive = hud.phase === "escape"
    ? (hud.seat > 0 ? "Head west. Bring everyone home." : "Return to the van. Time to leave.")
    : !hud.partInstalled && quotaMet ? "Find the distributor cap. Repair the van."
    : hud.partInstalled ? "Load the van to meet your salvage quota."
    : "Recover valuables. Find the distributor cap.";
  const threat = hud.enemyDist < 12 && !hud.dead && !hud.downed
    ? hud.enemyAi === 3 ? "STRIKE INCOMING · back away"
    : hud.enemyAi === 5 ? "FORCING A DOOR · hold it or run"
    : hud.enemyAi === 2 ? "CHASE · break sight, then stay quiet"
    : null : null;

  // Damage bearing (store contract: radians, (-PI, PI], positive = source to
  // your right = clockwise, same convention as the escape compass).
  const dmgDir = hud.dmgDir;
  const dmgOn = dmgDir !== null && hud.damageFlash > 0;

  // Prompts may lead with a key tag ("[E] " / "[HOLD E] "); render the
  // bracketed prefix dimmer, remainder as-is.
  const close = hud.prompt.indexOf("]");
  const promptKey = hud.prompt.startsWith("[") && close > 0 ? hud.prompt.slice(0, close + 1) : null;

  // Nearest crew member able to stabilize the local player.
  const helper = hud.teammates.reduce<{ nick: string; dist: number } | null>((best, t) => {
    if (!t.connected || t.downed || t.dead) return best;
    return best === null || t.dist < best.dist ? { nick: t.nick, dist: t.dist } : best;
  }, null);

  // First-shift controls card: once per browser, on first scavenge entry.
  const [controlsOn, setControlsOn] = React.useState(false);
  const controlsArmedRef = React.useRef(false);
  React.useEffect(() => {
    if (hud.phase !== "scavenge" || controlsArmedRef.current) return;
    controlsArmedRef.current = true;
    try {
      if (window.localStorage.getItem("laststop.controlsSeen") === "1") return;
      window.localStorage.setItem("laststop.controlsSeen", "1");
    } catch {
      // storage blocked: still show once this session
    }
    setControlsOn(true);
    window.setTimeout(() => setControlsOn(false), 10000);
  }, [hud.phase]);

  // Escape-phase van compass: bearing + distance from the local player's
  // authoritative state (no predictor import). The engine's yaw convention is
  // forward = (sin yaw, cos yaw), but the camera's screen-right is world -X
  // at yaw 0 (right-handed three.js), so the signed SCREEN angle is
  // -(atan2(dx, dz) - yaw): positive = van to the right = clockwise CSS
  // rotation. Recomputed per store sample (~12 Hz) — no second rAF loop.
  let compass: { rot: number; dist: number } | null = null;
  if (hud.phase === "escape" && activeNet) {
    const st = activeNet.state;
    const me = st?.players.get(activeNet.sid);
    if (st && me && !me.dead) {
      const dx = st.van.x - me.x;
      const dz = st.van.z - me.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 4) {
        let rel = -(Math.atan2(dx, dz) - me.yaw);
        rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to (-PI, PI]
        compass = { rot: rel, dist };
      }
    }
  }

  return (
    <div className="hud">
      <div className={`shift-directive ${hud.phase === "escape" ? "escape" : ""}`}>
        <span>{hud.phase === "escape" ? "03 / CLOCK OUT" : quotaMet || hud.partInstalled ? "02 / FINISH THE JOB" : "01 / RECOVERY SHIFT"}</span>
        <b>{directive}</b>
        <small>{hud.phase === "escape" ? "Driver: cab side · Passengers: open rear doors"
          : hud.carrying ? "Open rear doors to load · RMB steadies fragile cargo"
          : "LMB grabs cargo · E uses doors · Q marks a find"}</small>
      </div>
      {threat && <div className={`threat-cue ${hud.enemyAi === 3 ? "strike" : ""}`} role="status">{threat}</div>}
      {/* crosshair + prompt */}
      {!hud.dead && (
        <div className="crosshair">
          <div className="dot" />
          {hud.prompt && (
            <div className="prompt">
              {promptKey !== null && <span className="p-key">{promptKey}</span>}
              {promptKey !== null ? hud.prompt.slice(promptKey.length) : hud.prompt}
            </div>
          )}
          {hud.progress > 0 && hud.progress < 1 && (
            <div className="progress-wrap">
              <div className="progress-label">{hud.progressKind === "revive" ? "PICKING UP" : "INSTALLING"}</div>
              <div className="progress-bar"><div style={{ width: `${hud.progress * 100}%` }} /></div>
            </div>
          )}
        </div>
      )}

      {/* damage vignette */}
      {hud.damageFlash > 0 && <div className="vignette" style={{ opacity: hud.damageFlash * 0.7 }} />}
      {(hud.enemyAi === 2 || hud.enemyAi === 3) && hud.enemyDist < 16 && <div className="chase-vignette" />}

      {/* directional damage indicator: wedge around the crosshair pointing at
          the source; rotates clockwise for a positive bearing, opacity tracks
          the damage flash fade. Stays mounted so CSS can fade it. */}
      <div className={`dmg-dir ${dmgOn ? "on" : ""}`}>
        <div
          className="dmg-dir-rot"
          style={{ transform: `rotate(${dmgDir ?? 0}rad)`, opacity: Math.max(0, hud.damageFlash) }}
        >
          <span className="dmg-dir-wedge" />
        </div>
      </div>

      {/* downed banner: mid-lower screen, above the vitals bars */}
      {hud.downed && !hud.dead && (hud.phase === "scavenge" || hud.phase === "escape") && (
        <div className="downed-banner">
          <b>DOWNED</b> - your crew can stabilize you
          {helper && (
            <span className="downed-helper">
              Nearest: {helper.nick} - {Math.round(helper.dist)} m
            </span>
          )}
        </div>
      )}

      {/* first-shift controls card: bottom-left above the scanner */}
      <div className={`controls-card ${controlsOn ? "on" : ""}`}>
        <div className="cc-head">FIRST SHIFT - QUICK REFERENCE</div>
        <div className="cc-grid">
          <span><b>WASD</b> move</span>
          <span><b>Shift</b> sprint</span>
          <span><b>Mouse</b> look</span>
          <span><b>LMB</b> grab/release</span>
          <span><b>RMB</b> stabilize</span>
          <span><b>E</b> interact</span>
          <span><b>F</b> flashlight</span>
          <span><b>Q</b> ping</span>
          <span><b>1/2/3</b> quick chat</span>
          <span><b>Space</b> jump/handbrake</span>
          <span><b>H</b> horn</span>
        </div>
      </div>

      {/* latency chip */}
      {hud.ping >= 0 && hud.connStatus === "connected" && (
        <div className={`lat-chip ${hud.ping > 300 ? "red" : hud.ping >= 120 ? "amber" : ""}`}>
          {hud.ping} ms
        </div>
      )}

      {/* escape-phase compass to the van; stays mounted so CSS can fade it */}
      <div className={`compass ${compass ? "on" : ""}`}>
        <span
          className="compass-arrow"
          style={compass ? { transform: `rotate(${compass.rot}rad)` } : undefined}
        />
        {compass && <span>VAN - {Math.round(compass.dist)} m</span>}
      </div>

      {/* top center: timer + quota */}
      <div className="topbar">
        <div className={`timer ${danger ? "danger" : ""}`}>{fmtTime(hud.timer)}</div>
        <div className="quota">
          <span className="q-label">SALVAGE</span>
          <span className="q-value">
            ${hud.salvage} <em>/ ${hud.quota}</em>
          </span>
          <div className="q-bar">
            <div style={{ width: `${quotaPct}%` }} />
          </div>
        </div>
        <div className="objectives">
          <span className={hud.partInstalled ? "done" : ""}>
            {hud.partInstalled ? "✔ van repaired" : "… distributor cap"}
          </span>
          <span className={quotaPct >= 100 ? "done" : ""}>
            {quotaPct >= 100 ? "✔ quota met" : "… quota"}
          </span>
          <span className={hud.gateOpen ? "done escape" : ""}>
            {hud.gateOpen ? "GATE OPEN — DRIVE" : "… exit gate"}
          </span>
        </div>
      </div>

      {hud.escalation >= 2 && (
        <div className={`esc-banner ${hud.escalation >= 3 ? "hot" : ""}`}>
          {hud.escalation >= 3 ? "IT IS ANGRY" : "IT IS STIRRING"}
        </div>
      )}

      {/* bottom left: scanner + vitals */}
      <div className="bottom-left">
        <div className="scanner">
          <div className="scanner-head">
            <span className="scanner-led" /> DUSTPAN RECOVERY SCANNER
          </div>
          <div className="scanner-row"><span>CARGO</span><b>{hud.carrying ? hud.carryingName : "—"}</b></div>
          <div className="scanner-row">
            <span>WEIGHT</span>
            <b>
              {hud.carrying ? `${hud.carryingWeight}/5${hud.twoHandle ? " · 2-HANDLE" : ""}` : "—"}
              {hud.twoHandle && " (slow alone)"}
            </b>
          </div>
          <div className="scanner-row"><span>STRAPS</span><b>{hud.strapped ? "SECURED" : "LOOSE"}</b></div>
          <div className="scanner-row"><span>LINK</span><b className={hud.ping >= 150 ? "warn" : ""}>{hud.ping < 0 ? "--" : `${hud.ping}ms`} {hud.connStatus === "connected" ? "" : hud.connStatus}</b></div>
        </div>
      </div>

      {/* bottom center: vitals */}
      <div className="vitals">
        <div className="bar hp"><div style={{ width: `${hud.hp}%` }} /></div>
        <div className="bar stamina"><div style={{ width: `${hud.stamina}%` }} /></div>
        {hud.downed && (
          <div className="downed">
            DOWN — bleeding out {fmtTime(hud.bleedLeft)} — a teammate can pick you up
          </div>
        )}
        {hud.dead && (
          <div className="dead-note">
            You're done for the night{hud.spectating ? ` — watching ${hud.spectating}` : ""}.{" "}
            <button className="btn small" onClick={onSpectateNext}>Next coworker</button>
          </div>
        )}
      </div>

      {/* driving strip */}
      {hud.seat > 0 && (
        <div className="drive-strip">
          {hud.driving ? (
            <>
              <b>DRIVING</b> · W/S throttle · A/D steer · Space handbrake · H horn · E to get out (stopped)
            </>
          ) : (
            <>
              <b>PASSENGER</b> · E to hop out (when stopped)
            </>
          )}
          {hud.leaveWarn > 0 && <span className="leave-warn">⚠ {hud.leaveWarn} left behind — press W again to abandon them</span>}
        </div>
      )}

      {/* right: teammates */}
      <div className="team">
        {hud.teammates.map((t) => (
          <div key={t.sid} className={`mate ${t.dead ? "dead" : t.downed ? "downed" : ""} ${t.connected ? "" : "dc"}`}>
            <span className="dot" style={{ background: COLORS[t.color % COLORS.length] }} />
            <span className="m-nick">{t.nick}</span>
            {t.seat > 0 && <span className="m-seat">🚐</span>}
            {!t.connected && <span className="dc-tag">dc</span>}
            <div className="m-hp"><div style={{ width: `${t.hp}%` }} /></div>
            {t.downed && !t.dead && <span className="m-flag">DOWN</span>}
            {t.dead && <span className="m-flag">LOST</span>}
            {!t.downed && !t.dead && <span className="m-dist">{t.dist}m</span>}
          </div>
        ))}
      </div>

      {/* corner: fps + quick chat reminder */}
      <div className="corner-meta">
        <span>{hud.fps} fps</span>
        <span>1 HELP CARRY · 2 ENEMY HERE · 3 BACK TO VAN</span>
      </div>

      {paused && <div className="pause-note" />}
    </div>
  );
}
