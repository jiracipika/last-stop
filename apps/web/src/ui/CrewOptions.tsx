import React from "react";
import { crewHex } from "../game/palette.js";

export const HEADGEAR = ["Hi-vis cap", "Hard hat", "Beanie", "Headphones", "No headgear"] as const;
const UNIFORMS = ["Amber", "Sky", "Mint", "Coral", "Lilac", "Lemon", "Seafoam", "Tangerine"] as const;

// Headgear marks, drawn on the same 16-unit stroke grid as icons.tsx: a cap
// with its brim, a hard hat with its ridge, a beanie with a fold, a headset
// band with cups, and a crossed-out head for "nothing".
const HEADGEAR_PATHS: React.ReactNode[] = [
  <>
    <path d="M3 10a5 5 0 0 1 10 0" />
    <path d="M3 10h9a2 2 0 0 1 2 1.6" />
    <path d="M8 5V3.5" />
  </>,
  <>
    <path d="M3 11a5 5 0 0 1 10 0" />
    <path d="M2 11h12v1.6H2z" />
    <path d="M8 6v5" />
  </>,
  <>
    <path d="M3 10a5 5 0 0 1 10 0" />
    <path d="M3 10h10v2.6H3z" />
    <path d="M8 2.5v1.2" />
  </>,
  <>
    <path d="M3 11V9a5 5 0 0 1 10 0v2" />
    <rect x="2" y="9.5" width="3" height="4" rx="1" />
    <rect x="11" y="9.5" width="3" height="4" rx="1" />
  </>,
  <>
    <circle cx="8" cy="8" r="5.2" />
    <path d="M4.4 3.6l7.2 8.8" />
  </>,
];

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
      <div className="field crew-headgear" role="radiogroup" aria-label="Headgear">
        <span>Headgear</span>
        <div className="headgear">
          {HEADGEAR.map((label, i) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={hat === i}
              aria-label={label}
              title={label}
              className={`hat ${hat === i ? "sel" : ""}`}
              onClick={() => onChange(color, i)}
            >
              <svg width={20} height={20} viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {HEADGEAR_PATHS[i]}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
