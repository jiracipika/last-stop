// Procedural material set — the whole art direction lives here.
// Every texture is drawn once at boot onto a 512px canvas (deterministic,
// seeded), so there are no asset downloads, no licenses, no hotlinks.
// Docs/ART.md is the manifest; keep it in sync when adding materials.
import * as THREE from "three";
import { mulberry32 } from "@last-stop/shared";

// palette tokens (docs/ART.md)
export const PAL = {
  asphalt: "#1e2833",
  asphaltDark: "#141b23",
  gravel: "#26251f",
  cream: "#C6B99B",
  creamDim: "#b3a688",
  teal: "#477D78",
  tealDark: "#33565a",
  rust: "#A55235",
  tungsten: "#E6AD61",
  red: "#B63D35",
  ink: "#10141a",
};

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const rnd = mulberry32(seed);
  (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd = rnd;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** soft radial blob (stains, damp, grime) */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/** jagged crack polyline */
function crack(ctx: CanvasRenderingContext2D, rnd: () => number, s: number): void {
  const margin = s * 0.12;
  let x = margin + rnd() * (s - margin * 2);
  let y = margin + rnd() * (s * 0.3);
  ctx.strokeStyle = "rgba(6,8,10,0.55)";
  ctx.lineWidth = 1 + rnd();
  ctx.beginPath();
  ctx.moveTo(x, y);
  const steps = 5 + Math.floor(rnd() * 5);
  for (let i = 0; i < steps; i++) {
    x += (rnd() - 0.5) * s * 0.16;
    y += rnd() * s * 0.14;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function speckle(ctx: CanvasRenderingContext2D, rnd: () => number, s: number, n: number, light: string, dark: string): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() > 0.5 ? light : dark;
    ctx.globalAlpha = 0.04 + rnd() * 0.09;
    const r = 0.6 + rnd() * 1.8;
    ctx.fillRect(rnd() * s, rnd() * s, r, r);
  }
  ctx.globalAlpha = 1;
}

export interface Tex {
  asphalt: THREE.CanvasTexture;
  gravel: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  garageSteel: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  vinyl: THREE.CanvasTexture;
  carpet: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  corrugated: THREE.CanvasTexture;
  metalWorn: THREE.CanvasTexture;
  vanPaint: THREE.CanvasTexture;
  /** faded teal junker paint with rust streaks (front-yard sedan) */
  junkerTeal: THREE.CanvasTexture;
  /** patchy brown/grey primer junker paint (south-fence sedan) */
  primerCar: THREE.CanvasTexture;
  /** clone with independent repeat (shares the canvas — cheap) */
  rep(tex: THREE.CanvasTexture, x: number, y: number): THREE.CanvasTexture;
  /** flat decal texture from a draw fn, no repeat */
  decal(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture;
}

export function buildTextures(): Tex {
  // ---- asphalt: aggregate speckle, cracks, tar patches
  const asphalt = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = PAL.asphalt;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 2600, "#5a6a78", "#05070a");
    for (let i = 0; i < 5; i++) crack(ctx, rnd, s);
    // tar repair patches
    for (let i = 0; i < 3; i++) {
      const x = s * 0.2 + rnd() * s * 0.6;
      const y = s * 0.2 + rnd() * s * 0.6;
      ctx.fillStyle = PAL.asphaltDark;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x, y, s * (0.12 + rnd() * 0.16), s * (0.1 + rnd() * 0.1));
      ctx.globalAlpha = 1;
    }
  }, 0xa51);

  // ---- gravel: yard dirt
  const gravel = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = PAL.gravel;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const g = 0x22 + Math.floor(rnd() * 0x30);
      ctx.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
      ctx.fillRect(rnd() * s, rnd() * s, 1.5 + rnd() * 2.5, 1.5 + rnd() * 2.5);
    }
    blob(ctx, s * 0.3, s * 0.6, s * 0.25, "#141310", 0.5);
    blob(ctx, s * 0.75, s * 0.3, s * 0.2, "#17150f", 0.4);
  }, 0x9a7e1);

  // ---- motel plaster: dirty cream, stains, drips, teal wainscot at the bottom
  // (walls are boxes with v=0 at the bottom, so the band reads as trim everywhere)
  const plaster = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = PAL.cream;
    ctx.fillRect(0, 0, s, s);
    // stucco grain — strong enough to read under moonlight at 128 px/m
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "#e8dcbc" : "#7c6f58";
      ctx.globalAlpha = 0.08 + rnd() * 0.1;
      const r = 1 + rnd() * 2.4;
      ctx.fillRect(rnd() * s, rnd() * s, r, r);
    }
    ctx.globalAlpha = 1;
    // mid-frequency weathering: big blotches that stay visible at gameplay
    // distance (grain-scale speckle is sub-pixel on screen at 8 m)
    for (let i = 0; i < 7; i++) {
      blob(ctx, rnd() * s, rnd() * s, s * (0.16 + rnd() * 0.24), rnd() > 0.5 ? "#5c4f3a" : "#8a8874", 0.3 + rnd() * 0.18);
    }
    for (let i = 0; i < 5; i++) {
      blob(ctx, rnd() * s, rnd() * s, s * (0.08 + rnd() * 0.12), "#43392c", 0.34);
    }
    // drips under stains
    ctx.strokeStyle = "rgba(70,58,40,0.45)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const x = rnd() * s;
      const y = rnd() * s * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 10, y + s * (0.1 + rnd() * 0.22));
      ctx.stroke();
    }
    // grime toward the base + teal wainscot band (bottom of canvas = wall bottom)
    const grime = ctx.createLinearGradient(0, s * 0.55, 0, s);
    grime.addColorStop(0, "rgba(0,0,0,0)");
    grime.addColorStop(1, "rgba(20,18,14,0.55)");
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.55, s, s * 0.45);
    ctx.fillStyle = "#5b968f"; // brighter teal so the trim survives moonlight
    ctx.fillRect(0, s * 0.84, s, s * 0.16);
    ctx.fillStyle = PAL.cream;
    ctx.fillRect(0, s * 0.84, s, 5); // cream cap line on the trim
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, s * 0.84, s, 3);
    // scuffed trim
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "rgba(198,185,155,0.5)" : "rgba(30,34,30,0.45)";
      ctx.fillRect(rnd() * s, s * 0.87 + rnd() * s * 0.11, 4 + rnd() * 14, 1 + rnd() * 2.5);
    }
  }, 0x91a57);

  // ---- garage painted block wall: teal cinderblock + edge wear + sparse rust
  const garageSteel = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = PAL.teal;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 1100, "#6fa39c", "#2b464a");
    // block coursing (16" block -> ~3 courses per meter; 8 rows over the wall)
    ctx.strokeStyle = "rgba(20,32,34,0.5)";
    ctx.lineWidth = 2;
    for (let y = 0; y <= s; y += s / 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    // staggered vertical joints
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * (s / 8);
      for (let x = off; x < s; x += s / 4) {
        ctx.beginPath();
        ctx.moveTo(x, r * (s / 8));
        ctx.lineTo(x, (r + 1) * (s / 8));
        ctx.stroke();
      }
    }
    // lower-wall wear + rust
    for (let i = 0; i < 5; i++) blob(ctx, rnd() * s, s * (0.7 + rnd() * 0.25), s * 0.09, PAL.rust, 0.28);
    const wear = ctx.createLinearGradient(0, s * 0.7, 0, s);
    wear.addColorStop(0, "rgba(0,0,0,0)");
    wear.addColorStop(1, "rgba(10,14,14,0.4)");
    ctx.fillStyle = wear;
    ctx.fillRect(0, s * 0.7, s, s * 0.3);
  }, 0x57ee1);

  // ---- concrete: pores, damp patches, cracks
  const concrete = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#6f726d";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 2400, "#8d908a", "#3c3f3c");
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = "rgba(30,32,30,0.5)";
      ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
    }
    for (let i = 0; i < 4; i++) blob(ctx, rnd() * s, rnd() * s, s * (0.12 + rnd() * 0.2), "#3a4038", 0.3);
    for (let i = 0; i < 3; i++) crack(ctx, rnd, s);
  }, 0xc0c);

  // ---- aged vinyl tile: 8x8 checker, stains, a few missing tiles
  const vinyl = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    const t = s / 8;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const even = (r + c) % 2 === 0;
        ctx.fillStyle = even ? PAL.creamDim : "#4d6a66";
        ctx.fillRect(c * t, r * t, t, t);
        if (rnd() < 0.12) blob(ctx, c * t + t / 2, r * t + t / 2, t * 0.55, "#4a3f2c", 0.35);
        if (rnd() < 0.05) {
          ctx.fillStyle = "#14171c";
          ctx.fillRect(c * t + 2, r * t + 2, t - 4, t - 4); // missing tile
        }
      }
    }
    // grout
    ctx.strokeStyle = "rgba(18,20,24,0.7)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * t, 0);
      ctx.lineTo(i * t, s);
      ctx.moveTo(0, i * t);
      ctx.lineTo(s, i * t);
      ctx.stroke();
    }
  }, 0x711);

  // ---- worn carpet: two-tone noise + blotches
  const carpet = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#4a4348";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 5200, "#5d555c", "#332e33");
    for (let i = 0; i < 5; i++) blob(ctx, rnd() * s, rnd() * s, s * (0.1 + rnd() * 0.18), "#2c2620", 0.35);
  }, 0xca4);

  // ---- painted wood door: vertical grain + chips
  const wood = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = rnd() > 0.5 ? "rgba(56,38,22,0.5)" : "rgba(140,108,70,0.4)";
      ctx.lineWidth = 1 + rnd() * 3;
      const x = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y < s; y += 32) ctx.lineTo(x + Math.sin(y * 0.02 + i) * 4, y);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) blob(ctx, rnd() * s, s * (0.6 + rnd() * 0.4), s * 0.06, PAL.cream, 0.5);
  }, 0xd00);

  // ---- corrugated roof: vertical seams + rust streaks
  const corrugated = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#23262c";
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      ctx.fillStyle = "#2c3038";
      ctx.fillRect(x, 0, 14, s);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x + 26, 0, 6, s);
    }
    for (let i = 0; i < 14; i++) {
      const x = rnd() * s;
      const g = ctx.createLinearGradient(x, 0, x, s);
      g.addColorStop(0, "rgba(165,82,53,0.45)");
      g.addColorStop(1, "rgba(165,82,53,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, s * (0.2 + rnd() * 0.3), 3 + rnd() * 8, s * 0.6);
    }
  }, 0x40f);

  // ---- worn painted steel (shelves, gate, drums)
  const metalWorn = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#4e565c";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 1600, "#6d767e", "#2b3136");
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = "rgba(160,170,178,0.35)";
      ctx.lineWidth = 1 + rnd() * 2;
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(rnd() * s * 0.4, y);
      ctx.lineTo(rnd() * s * 0.5 + s * 0.5, y + (rnd() - 0.5) * 30);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) blob(ctx, rnd() * s, rnd() * s, s * 0.08, PAL.rust, 0.4);
  }, 0x7e7);

  // ---- van livery paint: cream with teal sweep + rust bottom
  const vanPaint = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = PAL.cream;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 900, "#e8dcbc", "#9a8d70");
    // teal sweep along the lower body
    const band = ctx.createLinearGradient(0, s * 0.52, 0, s * 0.82);
    band.addColorStop(0, "rgba(71,125,120,0)");
    band.addColorStop(0.5, PAL.teal);
    band.addColorStop(1, PAL.tealDark);
    ctx.fillStyle = band;
    ctx.fillRect(0, s * 0.52, s, s * 0.3);
    // road grime + rust at the rocker
    const grime = ctx.createLinearGradient(0, s * 0.78, 0, s);
    grime.addColorStop(0, "rgba(0,0,0,0)");
    grime.addColorStop(1, "rgba(40,30,20,0.8)");
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.78, s, s * 0.22);
    for (let i = 0; i < 6; i++) blob(ctx, rnd() * s, s * (0.8 + rnd() * 0.18), s * 0.05, PAL.rust, 0.5);
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = "rgba(60,52,40,0.4)";
      ctx.lineWidth = 1 + rnd();
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(rnd() * s * 0.5, y);
      ctx.lineTo(rnd() * s * 0.5 + s * 0.4, y);
      ctx.stroke();
    }
  }, 0xa17);

  // ---- faded teal junker paint: sun-bleached panels, rust bleeding down
  // from panel edges, grime at the rocker (front-yard sedan livery)
  const junkerTeal = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    // base lifted ~18% (was #48706a) so the sedan stays readable from the yard
    // under the night grade — same trick as the plaster wainscot teal above
    ctx.fillStyle = "#55847d";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 1400, "#6da296", "#22383a");
    for (let i = 0; i < 6; i++) blob(ctx, rnd() * s, rnd() * s, s * (0.14 + rnd() * 0.22), "#7ba69a", 0.28);
    // rust streaks run down the panels (v is up on box side faces)
    for (let i = 0; i < 11; i++) {
      const x = rnd() * s;
      const y = rnd() * s * 0.55;
      const len = s * (0.18 + rnd() * 0.34);
      const streak = ctx.createLinearGradient(x, y, x, y + len);
      streak.addColorStop(0, "rgba(165,82,53,0.6)");
      streak.addColorStop(1, "rgba(165,82,53,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(x, y, 3 + rnd() * 7, len);
    }
    for (let i = 0; i < 5; i++) blob(ctx, rnd() * s, rnd() * s * 0.7, s * 0.05, PAL.rust, 0.5);
    const grime = ctx.createLinearGradient(0, s * 0.78, 0, s);
    grime.addColorStop(0, "rgba(0,0,0,0)");
    grime.addColorStop(1, "rgba(28,20,12,0.72)");
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.78, s, s * 0.22);
  }, 0x2ea7);

  // ---- primer-splotched junker paint: mismatched brown/grey patches, scuffs,
  // no clear coat left (south-fence sedan livery)
  const primerCar = canvasTex(512, (ctx, s) => {
    const rnd = (ctx as CanvasRenderingContext2D & { rnd: () => number }).rnd;
    ctx.fillStyle = "#6b6052";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, rnd, s, 1700, "#8a8072", "#453e34");
    for (let i = 0; i < 9; i++) {
      blob(ctx, rnd() * s, rnd() * s, s * (0.14 + rnd() * 0.22), rnd() > 0.5 ? "#7a6c5a" : "#6e6e66", 0.5);
    }
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = rnd() > 0.5 ? "rgba(200,190,170,0.3)" : "rgba(30,26,20,0.4)";
      ctx.lineWidth = 1 + rnd() * 2;
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(rnd() * s * 0.4, y);
      ctx.lineTo(rnd() * s * 0.4 + s * 0.45, y + (rnd() - 0.5) * 26);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) blob(ctx, rnd() * s, rnd() * s, s * 0.05, PAL.rust, 0.42);
    const grime = ctx.createLinearGradient(0, s * 0.8, 0, s);
    grime.addColorStop(0, "rgba(0,0,0,0)");
    grime.addColorStop(1, "rgba(24,18,12,0.7)");
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.8, s, s * 0.2);
  }, 0x5b21);

  const rep = (tex: THREE.CanvasTexture, x: number, y: number) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(x, y);
    return t;
  };

  const decal = (size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };

  return { asphalt, gravel, plaster, garageSteel, concrete, vinyl, carpet, wood, corrugated, metalWorn, vanPaint, junkerTeal, primerCar, rep, decal };
}
