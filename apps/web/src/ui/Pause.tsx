// Pause / settings overlay (Esc while in a mission).
import React from "react";
import type { Prefs } from "../App.js";
import type { Engine } from "../game/engine.js";
import { audio } from "../game/audio.js";

// Graphics tiers: applied instantly via Engine.applyQuality (renderer pixel
// ratio, fog) + World3D.setQuality (dust, flicker, light-cull radius) and
// persisted so the next boot starts at the same tier.
const QUALITY_TIERS: { value: Prefs["quality"]; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

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
        <div className="setting quality">
          <span>Graphics quality</span>
          <div className="q-btns">
            {QUALITY_TIERS.map((q) => (
              <button
                key={q.value}
                className={`q-btn ${prefs.quality === q.value ? "sel" : ""}`}
                onClick={() => apply({ ...prefs, quality: q.value })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
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
