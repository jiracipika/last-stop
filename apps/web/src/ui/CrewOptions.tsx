import React from "react";
import { crewHex } from "../game/palette.js";

export const HEADGEAR = ["Hi-vis cap", "Hard hat", "Beanie", "Headphones", "No headgear"] as const;
const UNIFORMS = ["Amber", "Sky", "Mint", "Coral", "Lilac", "Lemon", "Seafoam", "Tangerine"] as const;

export function CrewOptions({ color, hat, taken = [], onChange }: {
  color: number;
  hat: number;
  taken?: number[];
  onChange: (color: number, hat: number) => void;
}): React.ReactElement {
  return (
    <div className="crew-options">
      <div className="field" role="group" aria-label="Uniform color">
        <span>Uniform color</span>
        <div className="colors">
          {UNIFORMS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-label={`Uniform ${i + 1}`}
              aria-pressed={color === i}
              title={taken.includes(i) ? "Taken by another crew member" : label}
              disabled={taken.includes(i)}
              className={`swatch ${color === i ? "sel" : ""}`}
              style={{ background: crewHex(i) }}
              onClick={() => onChange(i, hat)}
            />
          ))}
        </div>
      </div>
      <label className="field crew-headgear">
        <span>Headgear</span>
        <select value={hat} onChange={(e) => onChange(color, Number(e.target.value))}>
          {HEADGEAR.map((label, i) => <option key={label} value={i}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}
