// Crew color resolution with a colorblind-safe alternate palette.
// The server assigns each player a color INDEX (0..7); every render site
// (title swatches, roster dots, team list, results table, 3D avatar suits)
// resolves that index through here so the accessibility toggle can swap the
// whole game to a deuteranopia/protanopia-friendly set in one place.
//
// The default palette (shared COLORS) leans on red/orange/green neighbors —
// amber vs coral vs mint vs seafoam vs lemon is a classic green-red trap. The
// alternate set keeps 8 distinguishable identities using blue/orange/yellow
// poles and large lightness steps, which survive every common color-vision
// deficiency.
import { COLORS } from "@last-stop/shared";

export const COLORS_CB = [
  "#ffb347", // orange (keep — the CB anchor hue)
  "#4fc3ff", // bright blue
  "#f5f5dc", // near-white beige (lightness pole)
  "#00d5ff", // cyan
  "#ff8ab0", // pink
  "#ffe66d", // yellow (large lightness step from orange)
  "#7d8fa8", // steel gray (lightness pole, no hue reliance)
  "#ffffff", // white
] as const;

let colorblind = false;

export function setPaletteMode(cb: boolean): void {
  colorblind = cb;
}

export function paletteMode(): boolean {
  return colorblind;
}

/** Resolve a crew color index to the display hex under the active palette. */
export function crewHex(idx: number): string {
  const arr = colorblind ? COLORS_CB : COLORS;
  return arr[idx % arr.length] ?? "#ffb347";
}
