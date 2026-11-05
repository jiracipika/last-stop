// Pause / settings overlay (Esc while in a mission).
import React from "react";
import type { Prefs } from "../App.js";
import type { Engine } from "../game/engine.js";
import { audio } from "../game/audio.js";

export function PauseOverlay({
  prefs,
  savePrefs,
  onResume,
  onLeave,
  engine,
}: {
  prefs: Prefs;
  savePrefs: (p: Prefs) => void;
  onResume: () => void;
  onLeave: () => void;
  engine: Engine | null;
}): React.ReactElement {
  const apply = (p: Prefs) => {
    savePrefs(p);
    audio.setVolume(p.volume);
    if (engine) {
      engine.settings = { quality: p.quality, headBob: p.headBob, shake: p.shake, sensitivity: p.sensitivity };
      engine.input.sensitivity = p.sensitivity;
      engine.applyQuality();
    }
  };

  return (
    <div className="pause">
      <div className="pause-panel">
        <h2>Paused — catching your breath</h2>
        <label className="setting">
          <span>Mouse sensitivity</span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.1}
            value={prefs.sensitivity}
            onChange={(e) => apply({ ...prefs, sensitivity: Number(e.target.value) })}
          />
          <b>{prefs.sensitivity.toFixed(1)}×</b>
        </label>
        <label className="setting">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            onChange={(e) => apply({ ...prefs, volume: Number(e.target.value) })}
          />
          <b>{Math.round(prefs.volume * 100)}%</b>
        </label>
        <label className="setting">
          <span>Graphics quality</span>
          <select value={prefs.quality} onChange={(e) => apply({ ...prefs, quality: e.target.value as Prefs["quality"] })}>
            <option value="low">Low (integrated GPUs)</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <div className="setting row">
          <label>
            <input
              type="checkbox"
              checked={prefs.headBob}
              onChange={(e) => apply({ ...prefs, headBob: e.target.checked })}
            />{" "}
            Head bob
          </label>
          <label>
            <input
              type="checkbox"
              checked={prefs.shake}
              onChange={(e) => apply({ ...prefs, shake: e.target.checked })}
            />{" "}
            Camera shake
          </label>
        </div>
        <div className="pause-actions">
          <button className="btn primary" onClick={onResume}>
            Back to work
          </button>
          <button className="btn ghost" onClick={onLeave}>
            Quit shift
          </button>
        </div>
      </div>
    </div>
  );
}
