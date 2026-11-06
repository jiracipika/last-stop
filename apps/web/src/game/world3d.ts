// Builds the static 3D world from the shared handcrafted map data.
// Everything is procedural low-poly geometry; surfaces use the seeded
// procedural texture set from textures.ts (see docs/ART.md for the palette
// and manifest). Lighting rule: warm = safety, cold = building interior,
// red = hazard.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  WALL_BOXES, DOORS, doorAabb, PROPS, ROOMS, LAMPS, ROAD, GATE, MAP_BOUNDS, HIDE_SPOTS, mulberry32, type DoorDef, type PropDef,
} from "@last-stop/shared";
import { buildTextures, PAL, type Tex } from "./textures.js";

export interface DoorView {
  def: DoorDef;
  group: THREE.Group;
  open: boolean;
}

interface ManagedLight {
  light: THREE.PointLight;
  range: number;
  essential?: boolean; // never culled, survives blackout
}

interface Flicker {
  light: THREE.PointLight;
  mat: THREE.MeshBasicMaterial | null;
  base: number;
  style: 0 | 1 | 2 | 3; // steady | buzz | failing | pulse
  seed: number;
  /** original style, kept so a Low -> higher tier switch can restore it */
  style0?: 0 | 1 | 2 | 3;
}

/** one merged draw call produced by bakeStatic() */
interface BakeBucket {
  geos: THREE.BufferGeometry[];
  meshes: THREE.Mesh[];
  mat: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
}

// STORM CELL: distant lightning. The flash is a cold sky-wide hemisphere
// spike, additive to the existing night grade; spikes are counted in frames,
// not timed, so a flash is literally 2-4 rendered frames of jittered light.
const STORM_FLASH_PEAK = 2.2;
const STORM_FLASH_GAP_MIN = 8; // seconds between flashes
const STORM_FLASH_GAP_MAX = 25;

// light-cull radius multiplier (see cullLights); the Low tier halves it so
// weak GPUs light fewer pixels per frame
const CULL_SCALE_FULL = 3.4;
const CULL_SCALE_LOW = 1.7;

export class World3D {
  group = new THREE.Group();
  doorViews: DoorView[] = [];
  gateGroup = new THREE.Group();
  lamps: { light: THREE.PointLight; head: THREE.Mesh }[] = [];
  signGroup: THREE.Group | null = null;

  private tex: Tex;
  /** shared texture kit (the van borrows vanPaint + decals from it) */
  get textureKit(): Tex {
    return this.tex;
  }
  private managed: ManagedLight[] = [];
  private flickers: Flicker[] = [];
  private fan: THREE.Group | null = null;
  private dust: THREE.Points[] = [];
  private blackout: boolean;
  private lowQuality = false;
  private cullScale = CULL_SCALE_FULL;
  // storm atmosphere (STORM CELL modifier)
  private stormLight: THREE.HemisphereLight | null = null;
  private stormOn = false;
  private stormFlashAt = 0; // update-clock seconds; < 0 = needs scheduling
  private stormFramesLeft = 0;
  /** Wired by the engine to the thunder cue; fired when a flash begins. */
  onFlash: (() => void) | null = null;
  private disposables: { geo?: THREE.BufferGeometry; mat?: THREE.Material; tex?: THREE.Texture }[] = [];
  /** static scenery tagged during the build; bakeStatic() merges it per material family */
  private staticParts: THREE.Mesh[] = [];

  constructor(blackout: boolean) {
    this.blackout = blackout;
    this.tex = buildTextures();
    this.buildGround();
    this.buildWalls();
    this.buildRoomsAndRoofs();
    this.buildDoors();
    this.buildGate();
    this.buildProps();
    this.buildHideSpotDoors();
    this.buildLamps(blackout);
    this.buildInteriorLights(blackout);
    this.buildRoomDressing();
    this.buildSign();
    this.buildAtmosphere();
    this.buildSky();
    this.buildStorm();
    // fold every tagged static mesh into one draw call per material family
    this.bakeStatic();
  }

  // ------------------------------------------------------------------ helpers
  private mat(map: THREE.Texture, color = 0xffffff, flat = false): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ map, color, flatShading: flat });
    this.disposables.push({ mat: m, tex: map });
    return m;
  }

  private solid(color: number, flat = false): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: flat });
    this.disposables.push({ mat: m });
    return m;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.disposables.push({ geo: m.geometry });
    return m;
  }

  /** this.box for never-animated scenery: tagged so bakeStatic() can merge it */
  private sbox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = this.box(w, h, d, mat, x, y, z);
    this.staticParts.push(m);
    return m;
  }

  /** custom-geometry static mesh (cylinders, tires, cones...) tagged for the merge */
  private smesh<T extends THREE.Mesh>(m: T): T {
    this.staticParts.push(m);
    return m;
  }

  // -------------------------------------------------------------- static bake
  /**
   * Draw-call pass: the software-renderer target pays per draw call, so all
   * tagged static scenery is folded into one BufferGeometry per material
   * family. Two tricks keep the buckets coarse:
   *  - repeat: rep() clones share .source with their base canvas, and a
   *    material repeat is just a UV multiply — so it is baked into each
   *    geometry's UVs and the merged mesh uses the base texture at repeat
   *    (1,1). This is what lets every plaster wall / room floor merge despite
   *    their per-wall / per-room repeat clones.
   *  - tint: material.color is baked into a vertex-color attribute and the
   *    merged material is white + vertexColors, so every tint of one texture
   *    (all the metalWorn props, the wood furniture) and every solid color
   *    shares a single draw call. Color math is unchanged (white * vColor *
   *    map == original color * map).
   * Deliberately NOT merged: door/hide-door/gate/fan/sign groups (animated),
   * interior-light casings and flicker-driven bulbs/tubes (their materials are
   * recolored every frame), transparent decals/pools/car glass (blend order),
   * and dust/stars (Points). Merged geometry spans the whole lot, so the
   * per-mesh frustum culling the originals had is gone — accepted trade: the
   * merged vertex counts are tiny while SwiftShader's per-draw overhead is not.
   */
  private bakeStatic(): void {
    // materials the flicker loop recolors must stay on their own live meshes
    const live = new Set<THREE.Material>();
    for (const f of this.flickers) if (f.mat) live.add(f.mat);
    // rep() clones share .source with the base texture; map source -> base (repeat 1,1)
    const baseOf = new Map<string, THREE.Texture>();
    const kit: THREE.Texture[] = [
      this.tex.asphalt, this.tex.gravel, this.tex.plaster, this.tex.garageSteel,
      this.tex.concrete, this.tex.vinyl, this.tex.carpet, this.tex.wood,
      this.tex.corrugated, this.tex.metalWorn, this.tex.vanPaint,
      this.tex.junkerTeal, this.tex.primerCar,
    ];
    for (const t of kit) baseOf.set(t.source.uuid, t);
    const buckets = new Map<string, BakeBucket>();
    for (const mesh of this.staticParts) {
      const src = mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
      const lambert = src instanceof THREE.MeshLambertMaterial;
      const basic = src instanceof THREE.MeshBasicMaterial;
      // skip anything animated (flicker recolor) or blended (draw-order sensitive)
      if ((!lambert && !basic) || live.has(src) || src.transparent) continue;
      const flat = lambert ? src.flatShading : false;
      const map = src.map;
      const key = `${lambert ? "L" : "B"}|${flat ? 1 : 0}|${map ? map.source.uuid : "none"}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        const baseMap = map ? baseOf.get(map.source.uuid) ?? map : null;
        const mat = lambert
          ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat, map: baseMap })
          : new THREE.MeshBasicMaterial({ vertexColors: true, map: baseMap });
        this.disposables.push({ mat, tex: baseMap ?? undefined });
        bucket = { geos: [], meshes: [], mat };
        buckets.set(key, bucket);
      }
      const geo = mesh.geometry.clone();
      mesh.updateMatrix(); // tagged meshes are direct group children: local TRS is everything
      geo.applyMatrix4(mesh.matrix);
      // bake the material's texture repeat into the UVs (see doc comment)
      if (map) {
        const uv = geo.getAttribute("uv");
        const rx = map.repeat.x;
        const ry = map.repeat.y;
        if (uv && (rx !== 1 || ry !== 1)) {
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
        }
      }
      // bake tint into vertex colors; src.color is already linear working space
      const n = geo.getAttribute("position").count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = src.color.r;
        colors[i * 3 + 1] = src.color.g;
        colors[i * 3 + 2] = src.color.b;
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      bucket.geos.push(geo);
      bucket.meshes.push(mesh);
    }
    for (const [key, bucket] of buckets) {
      const merged = mergeGeometries(bucket.geos, false);
      if (!merged) continue; // attribute mismatch would be a bug; keep originals
      const baked = new THREE.Mesh(merged, bucket.mat);
      baked.name = `baked.${key}.${bucket.meshes.length}`;
      this.group.add(baked);
      this.disposables.push({ geo: merged });
      // originals leave the graph; their geometries/materials stay in
      // disposables and are freed exactly once by dispose() (they were never
      // rendered, so no GPU resources were ever allocated for them)
      for (const m of bucket.meshes) this.group.remove(m);
    }
  }

  private pointLight(color: number, intensity: number, range: number, x: number, y: number, z: number, essential = false): THREE.PointLight {
    const l = new THREE.PointLight(color, intensity, range, 1.8);
    l.position.set(x, y, z);
    this.group.add(l);
    this.managed.push({ light: l, range, essential });
    return l;
  }

  private decalPlane(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.group.add(m);
    this.disposables.push({ geo: m.geometry, mat, tex });
    return m;
  }

  // ------------------------------------------------------------------ ground
  private buildGround(): void {
    // asphalt lot (6 m per texture tile keeps texel density consistent everywhere)
    const lotMat = this.mat(this.tex.rep(this.tex.asphalt, 70 / 6, 54 / 6));
    this.group.add(this.sbox(70, 0.1, 54, lotMat, 0, -0.05, 0));
    const roadMat = this.mat(this.tex.rep(this.tex.asphalt, (ROAD.x1 - ROAD.x0 + 36) / 6, (ROAD.z1 - ROAD.z0) / 6));
    this.group.add(this.sbox(ROAD.x1 - ROAD.x0 + 36, 0.1, ROAD.z1 - ROAD.z0 - 0.4, roadMat, ROAD.x0 + (ROAD.x1 - ROAD.x0) / 2 - 18, -0.045, 11));
    // center dashes + faded stall lines (paint sits on the asphalt)
    const paint = this.solid(0x8a8064);
    for (let x = -66; x < -30; x += 5) {
      this.group.add(this.sbox(2.2, 0.02, 0.16, paint, x, 0.03, 11));
    }
    for (const [bx, bz] of [[-8, 6], [4, 6], [16, 6], [-8, 17], [4, 17]] as [number, number][]) {
      this.group.add(this.sbox(0.14, 0.02, 3.2, paint, bx - 1.5, 0.03, bz + 1.9));
      this.group.add(this.sbox(0.14, 0.02, 3.2, paint, bx + 1.5, 0.03, bz + 1.9));
    }
    // gravel yards
    const gravelMat = this.mat(this.tex.rep(this.tex.gravel, 12 / 5, 26 / 5));
    this.group.add(this.sbox(12, 0.06, 26, gravelMat, -28, 0.0, -8));
    this.group.add(this.sbox(6, 0.06, 22, this.mat(this.tex.rep(this.tex.gravel, 6 / 5, 22 / 5)), 32, 0.0, -10));
    // parking bumpers
    const bump = this.solid(0x3a3d42);
    for (const [bx, bz] of [[-8, 6], [4, 6], [16, 6], [-8, 17], [4, 17]] as [number, number][]) {
      this.group.add(this.sbox(2.4, 0.14, 0.5, bump, bx, 0.07, bz));
    }
    // oil stains near the dead car + dumpster
    const oil = (x: number, z: number, s: number) =>
      this.decalPlane(this.tex.decal(256, (ctx, sz) => {
        const rnd = mulberry32(Math.floor(x * 31 + z * 7));
        for (let i = 0; i < 5; i++) {
          const g = ctx.createRadialGradient(sz / 2 + (rnd() - 0.5) * sz * 0.3, sz / 2 + (rnd() - 0.5) * sz * 0.3, 4, sz / 2, sz / 2, sz * (0.2 + rnd() * 0.25));
          g.addColorStop(0, "rgba(8,10,10,0.75)");
          g.addColorStop(0.7, "rgba(15,16,14,0.35)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, sz, sz);
        }
      }), s, s, x, 0.028, z, 0);
    oil(-9, 1.6, 3.2);
    oil(13, -19, 2.6);
    oil(23, -12, 4.2); // garage floor gets the big one
  }

  // ------------------------------------------------------------------ walls
  private buildWalls(): void {
    // tile wall textures every ~4 m so speckle/stain detail survives on long
    // walls (each wall box maps UV 0..1 per face; repeat comes from clones)
    const wallMatCache = new Map<string, THREE.MeshLambertMaterial>();
    const tiledWallMat = (base: THREE.CanvasTexture, alongM: number, tileM: number): THREE.MeshLambertMaterial => {
      const rx = Math.max(1, Math.round(alongM / tileM));
      const key = `${base.uuid}:${rx}`;
      let m = wallMatCache.get(key);
      if (!m) {
        m = this.mat(this.tex.rep(base, rx, 1));
        wallMatCache.set(key, m);
      }
      return m;
    };
    const garageMat = this.mat(this.tex.garageSteel);
    const fenceMat = this.solid(0x2a2c31);
    const railMat = this.mat(this.tex.wood, 0x9a8a76);
    for (const w of WALL_BOXES) {
      const { x0, z0, x1, z1 } = w.aabb;
      const width = x1 - x0;
      const depth = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const along = Math.max(width, depth);
      const isGarage = w.kind === "wall" && w.h > 3.5;
      const mat =
        w.kind === "wall"
          ? isGarage
            ? along > 6
              ? tiledWallMat(this.tex.garageSteel, along, 3)
              : garageMat
            : tiledWallMat(this.tex.plaster, along, 4)
          : w.kind === "rail"
            ? railMat
            : fenceMat;
      this.group.add(this.sbox(width, w.h, depth, mat, cx, w.h / 2, cz));
      if (w.kind === "fence") {
        const post = this.solid(0x232529);
        const alongFence = width > depth;
        const len = alongFence ? width : depth;
        for (let d = 0; d < len; d += 4) {
          const px = alongFence ? x0 + d : cx;
          const pz = alongFence ? cz : z0 + d;
          this.group.add(this.sbox(0.14, w.h + 0.15, 0.14, post, px, (w.h + 0.15) / 2, pz));
        }
      }
    }
  }

  // ------------------------------------------------------------------ rooms
  private buildRoomsAndRoofs(): void {
    ROOMS.forEach((room, i) => {
      const w = room.x1 - room.x0;
      const d = room.z1 - room.z0;
      let mat: THREE.MeshLambertMaterial;
      if (room.id === "GAR") mat = this.mat(this.tex.rep(this.tex.concrete, w / 4, d / 4), 0x8f9294);
      else if (["LAU", "MAI", "BOI", "STO"].includes(room.id)) mat = this.mat(this.tex.rep(this.tex.concrete, w / 4, d / 4), 0xb8b0a4);
      else if (room.id === "COR") mat = this.mat(this.tex.rep(this.tex.vinyl, w / 4, d / 4));
      else mat = this.mat(this.tex.rep(i % 2 === 0 ? this.tex.carpet : this.tex.vinyl, w / 4, d / 4), 0xc8c2b4);
      this.group.add(this.sbox(w, 0.06, d, mat, (room.x0 + room.x1) / 2, 0.03, (room.z0 + room.z1) / 2));
    });
    // walkway floor
    this.group.add(this.sbox(32, 0.08, 3, this.mat(this.tex.rep(this.tex.concrete, 8, 0.8), 0xa8a49a), -6, 0.04, -6.5));
    // roofs
    const roofMat1 = this.mat(this.tex.rep(this.tex.corrugated, 16, 9));
    this.group.add(this.sbox(33, 0.35, 18, roofMat1, -6, 3.35, -16));
    this.group.add(this.sbox(15.4, 0.4, 17, this.mat(this.tex.rep(this.tex.corrugated, 7.7, 8.5)), 23, 4.15, -12));
    // walkway awning + posts
    this.group.add(this.sbox(32.6, 0.22, 3.4, this.solid(0x2b2830), -6, 3.05, -6.5));
    for (const px of [-22, -14, -6, 2, 10]) {
      this.group.add(this.sbox(0.16, 3, 0.16, this.solid(0x35313a), px, 1.5, -7.9));
    }
    // windows on the front wall: dark glass + cream frames
    const glass = new THREE.MeshBasicMaterial({ color: 0x0e151d });
    this.disposables.push({ mat: glass });
    const frame = this.solid(0x8d8067);
    for (const wx of [-20, -13, -6, 0.5, 5]) {
      this.group.add(this.sbox(1.9, 1.35, 0.1, frame, wx, 1.9, -7.8));
      this.group.add(this.sbox(1.6, 1.1, 0.06, glass, wx, 1.9, -7.82));
      this.group.add(this.sbox(0.08, 1.1, 0.04, frame, wx, 1.9, -7.86));
      this.group.add(this.sbox(1.6, 0.07, 0.04, frame, wx, 1.9, -7.86));
    }
  }

  // ------------------------------------------------------------------ doors
  private buildDoors(): void {
    const doorMat = this.mat(this.tex.wood);
    const brass = this.solid(0xb9975a);
    for (const def of DOORS) {
      const a = doorAabb(def);
      const width = def.w;
      const g = new THREE.Group();
      const panel = this.box(width - 0.08, 2.15, 0.09, doorMat, (width - 0.08) / 2, 0, 0);
      g.add(panel);
      g.add(this.box(0.06, 0.06, 0.16, brass, width - 0.24, 0.05, 0));
      if (def.axis === "x") {
        g.position.set(a.x0, 1.08, def.cz);
        g.rotation.y = 0;
      } else {
        g.position.set(def.cx, 1.08, a.z0);
        g.rotation.y = Math.PI / 2;
      }
      this.group.add(g);
      this.doorViews.push({ def, group: g, open: def.startOpen });
      this.setDoor(this.doorViews.length - 1, def.startOpen, true);
    }
    // room numbers + corridor plates (findable doors > identical doors)
    const num = (n: string) => this.tex.decal(128, (ctx, sz) => {
      ctx.fillStyle = PAL.cream;
      ctx.fillRect(sz * 0.1, sz * 0.25, sz * 0.8, sz * 0.5);
      ctx.fillStyle = "#2a2118";
      ctx.font = `bold ${sz * 0.42}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n, sz / 2, sz / 2 + 2);
    });
    const front = [["1", -19.4], ["2", -12.4], ["3", -5.4], ["4", 1.1]] as [string, number][];
    for (const [n, x] of front) this.decalPlane(num(n), 0.42, 0.42, x, 1.75, -7.83, 0);
    const plates: [string, string][] = [["LAUNDRY", "-18.9"], ["MAINT", "-10.9"], ["BOILER", "-2.9"], ["STORAGE", "5.1"]];
    const plateTex = (t: string) => this.tex.decal(256, (ctx, sz) => {
      ctx.fillStyle = PAL.teal;
      ctx.fillRect(0, sz * 0.3, sz, sz * 0.4);
      ctx.fillStyle = "#d8d2c0";
      ctx.font = `bold ${sz * 0.19}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t, sz / 2, sz / 2);
    });
    for (const [t, xs] of plates) this.decalPlane(plateTex(t), 1.15, 0.34, Number(xs) - 0.35, 1.95, -17.83, 0);
  }

  setDoor(idx: number, open: boolean, instant = false): void {
    const dv = this.doorViews[idx]!;
    dv.open = open;
    const target = open ? -1.9 : 0;
    if (instant) dv.group.rotation.y = (dv.def.axis === "x" ? 0 : Math.PI / 2) + target;
    dv.group.userData.targetRot = (dv.def.axis === "x" ? 0 : Math.PI / 2) + target;
  }

  // ------------------------------------------------------------------ gate
  private buildGate(): void {
    const mat = this.mat(this.tex.metalWorn, 0xb0a89a);
    const bar = this.box(GATE.z1 - GATE.z0, 0.5, 0.22, mat, 0, 0, 0);
    const bar2 = this.box(GATE.z1 - GATE.z0, 0.5, 0.22, mat, 0, 1.4, 0);
    const top = this.box(GATE.z1 - GATE.z0, 0.3, 0.3, this.mat(this.tex.metalWorn), 0, 3.1, 0);
    for (let z = -(GATE.z1 - GATE.z0) / 2; z <= (GATE.z1 - GATE.z0) / 2; z += 1.4) {
      this.gateGroup.add(this.box(0.12, 3.2, 0.12, this.mat(this.tex.metalWorn, 0x8a8578), 0, 1.6, z));
    }
    this.gateGroup.add(bar, bar2, top);
    this.gateGroup.position.set(GATE.x + 0.4, 0, (GATE.z0 + GATE.z1) / 2);
    this.group.add(this.gateGroup);
    // hazard-red gate lamps — the recognizable EXIT
    const lampMat = new THREE.MeshBasicMaterial({ color: PAL.red });
    this.disposables.push({ mat: lampMat });
    this.group.add(this.sbox(0.3, 0.3, 0.3, lampMat, GATE.x + 0.3, 3.4, GATE.z0 - 0.4));
    this.group.add(this.sbox(0.3, 0.3, 0.3, lampMat, GATE.x + 0.3, 3.4, GATE.z1 + 0.4));
    if (!this.blackout) {
      this.flickers.push({ light: this.pointLight(0xb63d35, 5, 9, GATE.x + 0.6, 3.2, GATE.z0 - 0.2, true), mat: null, base: 5, style: 3, seed: 7 });
      this.pointLight(0xb63d35, 5, 9, GATE.x + 0.6, 3.2, GATE.z1 + 0.2, true);
    }
  }

  // ------------------------------------------------------------------ props
  private buildProps(): void {
    const rust = this.mat(this.tex.metalWorn, 0xa98a72);
    for (const p of PROPS) {
      switch (p.kind) {
        case "vending": {
          this.group.add(this.sbox(p.w, 1.9, p.d, this.mat(this.tex.metalWorn, 0x8a3030), p.x, 0.95, p.z));
          const face = new THREE.MeshBasicMaterial({ color: 0x2a3d55 });
          this.disposables.push({ mat: face });
          this.group.add(this.sbox(p.w - 0.2, 1.2, 0.05, face, p.x, 1.15, p.z + p.d / 2 + 0.03));
          break;
        }
        case "car":
          // two junkers, told apart by world position (map.ts): the
          // front-yard sedan (x < 0) hides players in its cabin, the
          // south-fence one in its trunk
          if (p.x < 0) this.buildFrontYardSedan(p);
          else this.buildSouthFenceSedan(p);
          break;
        case "dumpster": {
          this.group.add(this.sbox(p.w, 1.1, p.d, this.mat(this.tex.metalWorn, 0x3d5a44), p.x, 0.55, p.z));
          // a dumpster that is a hide spot gets its animated lid from
          // buildHideSpotDoors instead of this static top
          const isHide = HIDE_SPOTS.some((h) => h.kind === "trunk" && Math.abs(h.x - p.x) < 0.5 && Math.abs(h.z - p.z) < 0.5);
          if (isHide) {
            // dark muck so looking in under the tipped lid reads as garbage
            this.group.add(this.sbox(p.w - 0.2, 0.04, p.d - 0.2, this.solid(0x1c211c), p.x, 1.08, p.z));
          } else {
            this.group.add(this.sbox(p.w + 0.1, 0.12, p.d + 0.1, this.mat(this.tex.metalWorn, 0x2f4636), p.x, 1.16, p.z));
          }
          break;
        }
        case "boilerTank": {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 10), rust);
          t.position.set(p.x, 1.2, p.z);
          this.disposables.push({ geo: t.geometry });
          this.group.add(this.smesh(t));
          break;
        }
        case "workbench":
          this.group.add(this.sbox(p.w, 0.12, p.d, this.mat(this.tex.wood, 0xb0a084), p.x, 0.95, p.z));
          this.group.add(this.sbox(p.w - 0.4, 0.9, p.d - 0.3, this.mat(this.tex.metalWorn, 0x6a6258), p.x, 0.45, p.z));
          break;
        case "shelf":
          for (const hy of [0.5, 1.1, 1.7]) {
            this.group.add(this.sbox(p.w, 0.08, p.d, this.mat(this.tex.metalWorn, 0x7c7468), p.x, hy, p.z));
          }
          this.group.add(this.sbox(0.08, 1.8, 0.08, this.mat(this.tex.metalWorn), p.x, 0.9, p.z - p.d / 2 + 0.06));
          this.group.add(this.sbox(0.08, 1.8, 0.08, this.mat(this.tex.metalWorn), p.x, 0.9, p.z + p.d / 2 - 0.06));
          break;
        case "washer":
          for (const oz of [-0.8, 0, 0.8]) {
            this.group.add(this.sbox(p.w, 0.9, 0.7, this.solid(0x9aa0a8), p.x, 0.45, p.z + oz));
            const door = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshBasicMaterial({ color: 0x18242e }));
            door.position.set(p.x + p.w / 2 + 0.01, 0.5, p.z + oz);
            door.rotation.y = Math.PI / 2;
            this.disposables.push({ geo: door.geometry, mat: door.material as THREE.Material });
            this.group.add(this.smesh(door));
          }
          break;
        case "tires":
          for (let i = 0; i < 3; i++) {
            const tire = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.18, 8, 14), this.solid(0x181a1d));
            tire.rotation.x = Math.PI / 2;
            tire.position.set(p.x + (i % 2) * 0.5, 0.2 + Math.floor(i / 2) * 0.42, p.z);
            this.disposables.push({ geo: tire.geometry });
            this.group.add(this.smesh(tire));
          }
          break;
      }
    }
    // knocked-over cones + scattered junk (non-colliding flavour)
    const coneMat = this.solid(0xa55235);
    const cones: [number, number, number][] = [[-2.2, 3.4, 1.4], [1.4, 4.3, 2.2], [-11.5, 14.2, 0.6]];
    for (const [cx, cz, rot] of cones) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 8), coneMat);
      cone.position.set(cx, 0.28, cz);
      cone.rotation.set(Math.PI / 2.1, rot, 0);
      this.disposables.push({ geo: cone.geometry });
      this.group.add(this.smesh(cone));
    }
    const junk = this.solid(0x2c2a26);
    for (const [jx, jz] of [[-16, 9], [8, 18], [-24, 2], [26, 2], [12, -16.8]] as [number, number][]) {
      this.group.add(this.sbox(0.5, 0.3, 0.4, junk, jx, 0.15, jz));
    }
  }

  // ---------------------------------------------------------- junker sedans
  // Both "car" props are stealth hide spots now (cabin / trunk) and the hide
  // camera sits at eye height inside them, so each gets a real three-volume
  // body, tinted glass, bumpers and a furnished interior. Bodies stay
  // axis-aligned inside the p.w x p.d collider footprint; the offsets below
  // assume the 4.4 x 1.9 sedan of map.ts and are placed so the HIDE_SPOTS
  // door anchors land exactly on the faces opened here.

  private buildFrontYardSedan(p: PropDef): void {
    // faded teal livery with rust streaks; the driver-door throat is cut into
    // the south flank so the engine's hide door closes over a real opening
    const X = p.x;
    const Z = p.z;
    const paint = this.mat(this.tex.junkerTeal);
    const dark = this.solid(0x1a1d20);
    const trim = this.mat(this.tex.metalWorn, 0xc8c2b6);
    const seat = this.solid(0x3d3a34);
    const dash = this.solid(0x22262a);
    const glass = new THREE.MeshLambertMaterial({ color: 0x26323e, transparent: true, opacity: 0.35 });
    this.disposables.push({ mat: glass });
    // lower hull, split around the door throat (south flank local x 0.85..1.78)
    this.group.add(this.sbox(2.89, 0.28, 1.9, paint, X - 0.595, 0.54, Z));
    this.group.add(this.sbox(0.93, 0.28, 1.65, paint, X + 1.315, 0.54, Z - 0.125));
    this.group.add(this.sbox(0.93, 0.05, 0.25, paint, X + 1.315, 0.425, Z + 0.825));
    this.group.add(this.sbox(0.26, 0.28, 1.9, paint, X + 1.91, 0.54, Z));
    // beltline: hood / cabin walls / trunk deck, inset for a bevel
    this.group.add(this.sbox(1.34, 0.36, 1.84, paint, X - 1.37, 0.86, Z));
    this.group.add(this.sbox(2.5, 0.36, 0.4, paint, X + 0.55, 0.86, Z - 0.75));
    this.group.add(this.sbox(1.55, 0.36, 0.34, paint, X + 0.075, 0.86, Z + 0.78));
    this.group.add(this.sbox(0.26, 0.36, 1.84, paint, X + 1.91, 0.86, Z));
    // greenhouse: glass bands, pillars, roof (glass stays unbaked: transparent,
    // so its blend order must not get frozen by the merge)
    this.group.add(this.box(2.5, 0.38, 0.04, glass, X + 0.55, 1.23, Z + 0.7));
    this.group.add(this.box(2.5, 0.38, 0.04, glass, X + 0.55, 1.23, Z - 0.7));
    this.group.add(this.box(0.05, 0.38, 1.36, glass, X - 0.675, 1.23, Z));
    this.group.add(this.box(0.05, 0.38, 1.36, glass, X + 1.775, 1.23, Z));
    for (const [px, pz] of [[-0.7, 0.7], [-0.7, -0.7], [1.8, 0.7], [1.8, -0.7]] as [number, number][]) {
      this.group.add(this.sbox(0.09, 0.4, 0.1, paint, X + px, 1.23, Z + pz));
    }
    this.group.add(this.sbox(2.62, 0.08, 1.62, paint, X + 0.55, 1.46, Z));
    // cabin interior — the hide camera sits between the front seat backs at
    // the HIDE_SPOTS anchor, so the cabin must not read hollow
    this.group.add(this.sbox(2.5, 0.05, 1.86, dark, X + 0.55, 0.685, Z));
    this.group.add(this.sbox(0.14, 0.22, 1.36, dash, X - 0.6, 0.91, Z));
    for (const sz of [-0.48, 0.48]) {
      this.group.add(this.sbox(0.14, 0.55, 0.4, seat, X - 0.35, 0.955, Z + sz));
      this.group.add(this.sbox(0.42, 0.12, 0.4, seat, X - 0.52, 0.74, Z + sz));
    }
    this.group.add(this.sbox(0.14, 0.52, 1.3, seat, X + 1.45, 0.94, Z));
    // wheels: axis rotated to z so they actually roll, plus light hubs
    const tire = this.solid(0x14161a);
    const hub = this.mat(this.tex.metalWorn, 0xb0aa9c);
    for (const [wx, wz] of [[-1.4, 0.78], [1.4, 0.78], [-1.4, -0.78], [1.4, -0.78]] as [number, number][]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tire);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(X + wx, 0.34, Z + wz);
      this.disposables.push({ geo: wheel.geometry });
      this.group.add(this.smesh(wheel));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8), hub);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(X + wx, 0.34, Z + wz);
      this.disposables.push({ geo: cap.geometry });
      this.group.add(this.smesh(cap));
    }
    // wheel well lining the throat where the rear tire would show through
    this.group.add(this.sbox(0.26, 0.23, 0.25, dark, X + 1.4, 0.565, Z + 0.825));
    // bumpers as light metal end caps, flush with the footprint
    this.group.add(this.sbox(0.16, 0.28, 1.72, trim, X - 2.12, 0.54, Z));
    this.group.add(this.sbox(0.16, 0.28, 1.72, trim, X + 2.12, 0.54, Z));
    // rust blister sits proud of the hood, clear of the hood face (no z-fighting)
    this.group.add(this.sbox(0.55, 0.03, 0.65, this.solid(0x8a4a32), X - 1.37, 1.07, Z + 0.2));
    this.group.add(this.sbox(0.015, 0.16, 0.5, this.solid(0xc6b99b), X + 2.0475, 0.8, Z));
  }

  private buildSouthFenceSedan(p: PropDef): void {
    // primer-brown/grey livery, rear facing west: the trunk is a mouth cut
    // through the rear deck + south flank right under the hide-spot's trunk
    // lid hinge, so the closed lid reads as a junker lid resting ajar
    const X = p.x;
    const Z = p.z;
    const paint = this.mat(this.tex.primerCar);
    const dark = this.solid(0x1a1d20);
    const trim = this.mat(this.tex.metalWorn, 0xc8c2b6);
    const seat = this.solid(0x3d3a34);
    const dash = this.solid(0x22262a);
    const glass = new THREE.MeshLambertMaterial({ color: 0x26323e, transparent: true, opacity: 0.35 });
    this.disposables.push({ mat: glass });
    // lower hull: solid east of the trunk, rusted-open tub walls to the west
    this.group.add(this.sbox(3.54, 0.28, 1.9, paint, X + 0.27, 0.54, Z));
    this.group.add(this.sbox(0.54, 0.28, 1.35, paint, X - 1.77, 0.54, Z - 0.275));
    this.group.add(this.sbox(0.08, 0.28, 0.4, dark, X - 2.0, 0.54, Z + 0.75));
    this.group.add(this.sbox(0.46, 0.06, 0.55, dark, X - 1.73, 0.43, Z + 0.675));
    // trunk deck ring around the mouth; the deck top sits just under the lid
    this.group.add(this.sbox(1.14, 0.24, 1.35, paint, X - 1.47, 0.8, Z - 0.275));
    this.group.add(this.sbox(0.08, 0.24, 0.55, paint, X - 2.0, 0.8, Z + 0.675));
    this.group.add(this.sbox(0.6, 0.24, 1.9, paint, X - 1.2, 0.8, Z));
    // beltline: hood + cabin walls (the cabin is a ring so glass sees an interior)
    this.group.add(this.sbox(1.14, 0.36, 1.84, paint, X + 1.47, 0.86, Z));
    this.group.add(this.sbox(1.8, 0.36, 0.4, paint, X, 0.86, Z - 0.75));
    this.group.add(this.sbox(1.8, 0.36, 0.34, paint, X, 0.86, Z + 0.78));
    // greenhouse: glass bands, pillars, roof (glass stays unbaked: transparent,
    // so its blend order must not get frozen by the merge)
    this.group.add(this.box(1.8, 0.38, 0.04, glass, X, 1.23, Z + 0.7));
    this.group.add(this.box(1.8, 0.38, 0.04, glass, X, 1.23, Z - 0.7));
    this.group.add(this.box(0.05, 0.38, 1.36, glass, X + 0.875, 1.23, Z));
    this.group.add(this.box(0.05, 0.38, 1.36, glass, X - 0.875, 1.23, Z));
    for (const [px, pz] of [[-0.9, 0.7], [-0.9, -0.7], [0.9, 0.7], [0.9, -0.7]] as [number, number][]) {
      this.group.add(this.sbox(0.09, 0.4, 0.1, paint, X + px, 1.23, Z + pz));
    }
    this.group.add(this.sbox(2.0, 0.08, 1.62, paint, X, 1.46, Z));
    // cabin interior seen through the glass
    this.group.add(this.sbox(1.8, 0.04, 1.44, dark, X, 0.685, Z));
    this.group.add(this.sbox(0.14, 0.22, 1.36, dash, X + 0.72, 0.91, Z));
    this.group.add(this.sbox(0.14, 0.5, 1.3, seat, X - 0.62, 0.95, Z));
    // wheels: rear-south tire is flat, rear-north hubcap is gone
    const tire = this.solid(0x14161a);
    const hub = this.mat(this.tex.metalWorn, 0xb0aa9c);
    for (const [wx, wz] of [[-1.4, 0.78], [1.4, 0.78], [-1.4, -0.78], [1.4, -0.78]] as [number, number][]) {
      const flat = wx < 0 && wz > 0;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), tire);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(X + wx, flat ? 0.245 : 0.34, Z + wz);
      if (flat) wheel.scale.z = 0.72; // squash the vertical radius: reads as flat
      this.disposables.push({ geo: wheel.geometry });
      this.group.add(this.smesh(wheel));
      if (wx < 0 && wz < 0) continue; // missing hubcap
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8), hub);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(X + wx, flat ? 0.245 : 0.34, Z + wz);
      if (flat) cap.scale.z = 0.72;
      this.disposables.push({ geo: cap.geometry });
      this.group.add(this.smesh(cap));
    }
    // bumpers as light metal end caps, flush with the footprint
    this.group.add(this.sbox(0.16, 0.28, 1.72, trim, X - 2.12, 0.54, Z));
    this.group.add(this.sbox(0.16, 0.28, 1.72, trim, X + 2.12, 0.54, Z));
    // primer delamination blister + plate above the rear bumper
    this.group.add(this.sbox(0.5, 0.03, 0.6, this.solid(0x8a4a32), X + 1.47, 1.07, Z - 0.2));
    this.group.add(this.sbox(0.015, 0.16, 0.5, this.solid(0xc6b99b), X - 2.0475, 0.8, Z - 0.2));
  }

  // -------------------------------------------------------- hide-spot doors
  private hideDoors = new Map<string, { group: THREE.Group; open: boolean; kind: string; baseYaw: number }>();

  private buildHideSpotDoors(): void {
    for (const s of HIDE_SPOTS) {
      const g = new THREE.Group();
      if (s.kind === "car") {
        // driver door, hinged at its front edge, swings out; wears the
        // junker's body paint (see the sedan builders)
        const paint = this.mat(s.id === "carA" ? this.tex.junkerTeal : this.tex.primerCar);
        g.add(this.box(0.95, 0.8, 0.06, paint, 0.48, 0, 0));
        g.add(this.box(0.05, 0.05, 0.1, this.solid(0x14161a), 0.8, 0, 0.05));
        g.position.set(s.doorX, 0.85, s.doorZ);
      } else {
        // lid, hinged at the body edge, tips up; sized per spot so it
        // actually covers the tub it belongs to (dumpster >> sedan trunk)
        const lidW = s.lidW ?? 1.5;
        const lidD = s.lidD ?? 0.75;
        const lidY = s.lidY ?? 0.95;
        const paint = s.lidY !== undefined ? this.mat(this.tex.metalWorn, 0x2f4636) : this.mat(this.tex.primerCar);
        g.add(this.box(lidW, 0.08, lidD, paint, 0, 0, lidD / 2 + 0.005));
        g.add(this.box(0.5, 0.05, 0.06, this.solid(0x14161a), 0, 0.03, lidD / 2 - 0.15));
        g.position.set(s.doorX, lidY, s.doorZ);
      }
      g.rotation.y = s.doorYaw;
      this.group.add(g);
      this.hideDoors.set(s.id, { group: g, open: false, kind: s.kind, baseYaw: s.doorYaw });
    }
  }

  /** engine syncs this from replicated player.hidden flags */
  setHideOpen(spotId: string, open: boolean): void {
    const d = this.hideDoors.get(spotId);
    if (d) d.open = open;
  }

  private animateHideDoors(dt: number): void {
    const k = Math.min(1, 8 * dt);
    for (const d of this.hideDoors.values()) {
      if (d.kind === "car") {
        const target = d.baseYaw + (d.open ? -1.35 : 0);
        d.group.rotation.y += (target - d.group.rotation.y) * k;
      } else {
        const target = d.open ? -1.25 : 0; // lid tips up around the hinge
        d.group.rotation.x += (target - d.group.rotation.x) * k;
      }
    }
  }

  // ------------------------------------------------------------------ lamps
  private groundPool(color: string, radius: number, x: number, z: number, alpha = 0.5): void {
    // additive pool decal — guarantees a readable pool on the asphalt no
    // matter how the tonemapping treats the physical falloff
    const tex = this.tex.decal(256, (ctx, sz) => {
      const g = ctx.createRadialGradient(sz / 2, sz / 2, 2, sz / 2, sz / 2, sz / 2);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color.replace(/[\d.]+\)$/, `${alpha * 0.35})`));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sz, sz);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.032, z);
    this.group.add(m);
    this.disposables.push({ geo: m.geometry, mat, tex });
  }

  private buildLamps(blackout: boolean): void {
    for (const l of LAMPS) {
      // poles are static scenery and bake; heads stay out — their material is
      // recolored by the flicker loop below
      this.group.add(this.sbox(0.16, 4.6, 0.16, this.solid(0x2e3034), l.x, 2.3, l.z));
      const headMat = new THREE.MeshBasicMaterial({ color: blackout ? 0x223038 : 0xffd9a0 });
      this.disposables.push({ mat: headMat });
      const head = this.box(0.6, 0.25, 0.6, headMat, l.x, 4.65, l.z);
      this.group.add(head);
      const light = new THREE.PointLight(0xffc98a, blackout ? 0 : 26, 18, 1.6);
      light.position.set(l.x, 4.4, l.z);
      this.group.add(light);
      this.managed.push({ light, range: 18 });
      this.lamps.push({ light, head });
      if (!blackout) {
        this.groundPool("rgba(255,190,120,0.5)", 4.4, l.x, l.z);
        // sodium-arc buzz: the second lamp is dying
        this.flickers.push({ light, mat: headMat, base: 26, style: l.x === -10 && l.z === 8 ? 2 : 1, seed: l.x });
      }
    }
    // warm porch bulbs over the walkway doors — the facade reads from the lot
    const porch: [number, boolean][] = [[-18.5, true], [-11.5, false], [-4.5, true], [2, true], [7.5, true]];
    if (!blackout) {
      for (const [x, works] of porch) {
        const bulbMat = new THREE.MeshBasicMaterial({ color: works ? PAL.tungsten : 0x2a2318 });
        this.disposables.push({ mat: bulbMat });
        this.group.add(this.box(0.22, 0.16, 0.22, bulbMat, x, 2.5, -7.72));
        if (works) {
          const l = this.pointLight(0xE6AD61, 5.5, 7, x, 2.45, -7.6);
          this.flickers.push({ light: l, mat: bulbMat, base: 5.5, style: 0, seed: x });
          this.groundPool("rgba(230,173,97,0.42)", 1.7, x, -7.2, 0.42);
        }
      }
    }
  }

  // ---------------------------------------------------------- interior lights
  private buildInteriorLights(blackout: boolean): void {
    // Fixtures stay out of the bakeStatic merge: their tube/bulb materials are
    // recolored every frame by the flicker loop and must stay on live meshes.
    // fluorescent fixture: casing + emissive tube + cool point light
    const fixture = (x: number, z: number, y: number, intensity: number, color: number, style: 0 | 1 | 2 | 3, seed: number, len = 1.3): Flicker => {
      const casing = this.box(len, 0.1, 0.28, this.solid(0x3a3f44), x, y + 0.06, z);
      this.group.add(casing);
      const tubeMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ea });
      this.disposables.push({ mat: tubeMat });
      this.group.add(this.box(len - 0.15, 0.05, 0.18, tubeMat, x, y, z));
      const light = this.pointLight(color, intensity, 11, x, y - 0.15, z);
      return { light, mat: tubeMat, base: intensity, style, seed };
    };

    if (!blackout) {
      // reception: one steady cool tube + ceiling fan; cold light spills onto the walkway
      this.flickers.push(fixture(7.5, -11.5, 2.98, 14, 0xcfe0e8, 1, 3));
      this.groundPool("rgba(170,215,230,0.4)", 2.4, 7.5, -6.8, 0.4);
      // corridor: two tubes, the east one is failing hard
      this.flickers.push(fixture(-8, -16.5, 2.98, 12, 0xbfd4dc, 1, 4));
      this.flickers.push(fixture(2, -16.5, 2.98, 12, 0xbfd4dc, 2, 5));
      // garage: two hanging tubes, one buzzes
      this.flickers.push(fixture(23, -8, 3.7, 13, 0xd8e2e6, 1, 6, 1.8));
      this.flickers.push(fixture(23, -16, 3.7, 13, 0xd8e2e6, 2, 8, 1.8));
      // laundry: one weak warm bulb
      const l = this.pointLight(0xE6AD61, 6, 8, -18, 2.6, -21);
      this.flickers.push({ light: l, mat: null, base: 6, style: 0, seed: 9 });
      // Room 3 bedside lamp — one warm room among the dark ones
      const l2 = this.pointLight(0xE6AD61, 5, 6.5, -2.1, 1.1, -14.2);
      this.flickers.push({ light: l2, mat: null, base: 5, style: 0, seed: 10 });
      // passage bug-lamp on the garage wall — the only light near the dumpster
      // hide spot: it helps you find the lid and betrays you while you climb in
      const bug = this.pointLight(0xE6AD61, 5.5, 7.5, 15.4, 2.3, -19.5);
      this.flickers.push({ light: bug, mat: null, base: 5.5, style: 1, seed: 13 });
      const bugBulb = new THREE.MeshBasicMaterial({ color: 0xe6c489 });
      this.disposables.push({ mat: bugBulb });
      this.group.add(this.box(0.22, 0.3, 0.22, bugBulb, 15.55, 2.3, -19.5));
      this.groundPool("rgba(230,173,97,0.35)", 2.2, 14.6, -19.5, 0.45);
    }
    // maintenance stays red even in blackout — the emergency circuit
    const red = this.pointLight(0xb63d35, 9, 9, -10, 2.7, -21, true);
    this.flickers.push({ light: red, mat: null, base: 9, style: 3, seed: 11 });
    const redBulb = new THREE.MeshBasicMaterial({ color: PAL.red });
    this.disposables.push({ mat: redBulb });
    this.group.add(this.box(0.2, 0.26, 0.2, redBulb, -10, 2.82, -21));
    // boiler ember
    const ember = this.pointLight(0xA55235, 3.5, 5, -3, 0.6, -22.6, true);
    this.flickers.push({ light: ember, mat: null, base: 3.5, style: 3, seed: 12 });
  }

  // ---------------------------------------------------------- room dressing
  private buildRoomDressing(): void {
    const bed = (cx: number, cz: number, stripped: boolean): void => {
      const frame = this.mat(this.tex.wood, 0x8a7a5e);
      this.group.add(this.sbox(2.4, 0.3, 1.15, frame, cx, 0.15, cz));
      this.group.add(this.sbox(0.12, 1.0, 1.15, frame, cx - 1.14, 0.5, cz));
      if (!stripped) {
        this.group.add(this.sbox(2.2, 0.22, 1.0, this.solid(0x8d8578), cx + 0.05, 0.4, cz));
        this.group.add(this.sbox(0.5, 0.14, 0.7, this.solid(0xc8c2b0), cx - 0.75, 0.55, cz));
        // slept-in lump
        this.group.add(this.sbox(1.2, 0.16, 0.8, this.solid(0x746c60), cx + 0.45, 0.53, cz));
      }
    };
    // R1: intact bed + nightstand
    bed(-16.9, -13.5, false);
    this.group.add(this.sbox(0.55, 0.55, 0.45, this.mat(this.tex.wood), -18.7, 0.28, -13.6));
    // R2: bed + TV dresser (screen dead)
    bed(-12.2, -13.5, false);
    this.group.add(this.sbox(1.7, 0.75, 0.5, this.mat(this.tex.wood, 0x9a8a70), -12.2, 0.38, -14.5));
    this.group.add(this.sbox(0.85, 0.55, 0.3, this.solid(0x22262c), -12.2, 1.03, -14.5));
    const tvGlass = new THREE.MeshBasicMaterial({ color: 0x0c141c });
    this.disposables.push({ mat: tvGlass });
    this.group.add(this.sbox(0.7, 0.42, 0.04, tvGlass, -12.2, 1.03, -14.33));
    // R3: armchair + the lit floor lamp
    this.group.add(this.sbox(0.85, 0.75, 0.8, this.solid(0x5a4a3c), -6.8, 0.38, -13.2));
    this.group.add(this.sbox(0.85, 0.5, 0.22, this.solid(0x4c3e32), -6.8, 0.85, -12.9));
    this.group.add(this.sbox(0.08, 1.5, 0.08, this.solid(0x2e2a26), -2.1, 0.75, -14.3));
    const shade = new THREE.MeshBasicMaterial({ color: PAL.tungsten });
    this.disposables.push({ mat: shade });
    this.group.add(this.sbox(0.42, 0.3, 0.42, shade, -2.1, 1.6, -14.3));
    // R4: stripped frame + cardboard boxes
    bed(3.4, -13.4, true);
    const card = this.solid(0x6a5a44);
    this.group.add(this.sbox(0.8, 0.6, 0.6, card, 1.6, 0.3, -14.2));
    this.group.add(this.sbox(0.6, 0.45, 0.5, card, 1.7, 0.82, -14.25));
    // ENTRY reception: desk + key rack + wall clock
    this.group.add(this.sbox(2.4, 1.05, 0.7, this.mat(this.tex.wood, 0x8d7a5c), 8.2, 0.53, -13.6));
    this.group.add(this.sbox(2.5, 0.08, 0.8, this.mat(this.tex.wood, 0xa08c68), 8.2, 1.08, -13.6));
    this.group.add(this.sbox(1.1, 0.7, 0.06, this.mat(this.tex.wood, 0x7a684e), 9.4, 1.9, -14.8));
    for (let i = 0; i < 6; i++) {
      this.group.add(this.sbox(0.07, 0.16, 0.04, this.solid(0xb9975a), 9.05 + i * 0.15, 1.72, -14.76));
    }
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }));
    clockFace.position.set(6.4, 2.2, -14.82);
    this.disposables.push({ geo: clockFace.geometry, mat: clockFace.material as THREE.Material });
    this.group.add(this.smesh(clockFace));
    this.group.add(this.sbox(0.03, 0.2, 0.02, this.solid(0x22262c), 6.4, 2.28, -14.8));
    // corridor: ice machine against the north wall
    this.group.add(this.sbox(1.1, 1.6, 0.75, this.mat(this.tex.metalWorn, 0x7a8a94), -20.3, 0.8, -17.5));
    const iceFace = new THREE.MeshBasicMaterial({ color: 0x9fd8e8 });
    this.disposables.push({ mat: iceFace });
    this.group.add(this.sbox(0.5, 0.3, 0.04, iceFace, -20.3, 1.1, -17.1));
    // MAINT: pipes along the north wall
    const pipeMat = this.mat(this.tex.metalWorn, 0x9a8a74);
    for (const [y, r] of [[2.1, 0.09], [2.5, 0.07]] as [number, number][]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6.6, 8), pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-10, y, -23.8);
      this.disposables.push({ geo: pipe.geometry });
      this.group.add(this.smesh(pipe));
    }
    // BOILER: gauge + valve wheel
    this.group.add(this.sbox(0.35, 0.35, 0.1, new THREE.MeshBasicMaterial({ color: PAL.rust }), -3.9, 1.5, -21.55));
    // STORAGE: stacked boxes
    this.group.add(this.sbox(0.9, 0.7, 0.7, this.solid(0x5c5244), 8.6, 0.35, -19.2));
    this.group.add(this.sbox(0.7, 0.5, 0.6, this.solid(0x6a5a44), 8.5, 0.95, -19.3));
    this.group.add(this.sbox(0.8, 0.6, 0.7, this.solid(0x5c5244), 6.9, 0.3, -19.4));
    // GARAGE: tool board over the bench, oil drums, rolled-up bay door
    const board = this.mat(this.tex.wood, 0x6a5a44);
    this.group.add(this.sbox(3.2, 1.2, 0.08, board, 23, 1.9, -19.9));
    const toolDark = this.solid(0x1c2024);
    for (let i = 0; i < 7; i++) {
      this.group.add(this.sbox(0.06, 0.34 + (i % 3) * 0.12, 0.04, toolDark, 21.9 + i * 0.38, 1.9 + (i % 2) * 0.28, -19.84));
    }
    for (const [dx, dz] of [[28.6, -17.6], [27.7, -18.3]] as [number, number][]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10), this.mat(this.tex.metalWorn, 0xa55235));
      drum.position.set(dx, 0.55, dz);
      this.disposables.push({ geo: drum.geometry });
      this.group.add(this.smesh(drum));
    }
    const slats = this.mat(this.tex.metalWorn, 0x8a8478);
    for (let i = 0; i < 5; i++) {
      this.group.add(this.sbox(8, 0.28, 0.18, slats, 23, 3.35 + i * 0.3, -4.1));
    }
    // reception ceiling fan (spins in update)
    this.fan = new THREE.Group();
    const bladeMat = this.solid(0x4a4440);
    for (let i = 0; i < 3; i++) {
      const blade = this.box(1.05, 0.04, 0.16, bladeMat, 0.55, 0, 0);
      blade.rotation.y = (i / 3) * Math.PI * 2;
      const holder = new THREE.Group();
      holder.rotation.y = (i / 3) * Math.PI * 2;
      holder.add(blade);
      blade.position.set(0.55, 0, 0);
      this.fan.add(holder);
    }
    this.fan.position.set(7.5, 2.85, -11.5);
    this.group.add(this.fan);
  }

  // ------------------------------------------------------------------ sign
  private buildSign(): void {
    const g = new THREE.Group();
    const pole = this.box(0.35, 6.5, 0.35, this.mat(this.tex.metalWorn, 0x5a5a60), 0, 3.25, 0);
    g.add(pole);
    // double-sided cabinet
    const cabinet = this.box(2.6, 4.4, 0.5, this.solid(0x2a2228), 0, 5.3, 0);
    g.add(cabinet);
    const signTex = (deadA: boolean, deadT: boolean, deadN: boolean): THREE.CanvasTexture => {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 512;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#181016";
      ctx.fillRect(0, 0, 256, 512);
      ctx.textAlign = "center";
      const lit = (ch: string, x: number, y: number, on: boolean, fontPx: number): void => {
        ctx.font = `bold ${fontPx}px monospace`;
        if (on) {
          ctx.shadowColor = PAL.tungsten;
          ctx.shadowBlur = 18;
          ctx.fillStyle = PAL.tungsten;
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#3a2a20";
        }
        ctx.fillText(ch, x, y);
        ctx.shadowBlur = 0;
      };
      // keep every letter inside the 256px canvas: 7 letters * 34px <= 256
      const word = (w: string, y: number, deads: boolean[], fontPx: number, gap: number): void => {
        const x0 = 128 - ((w.length - 1) * gap) / 2;
        for (let i = 0; i < w.length; i++) lit(w[i]!, x0 + i * gap, y, !deads[i], fontPx);
      };
      word("PALE", 110, [false, deadA, false, false], 64, 56);
      word("LANTERN", 210, [false, false, deadT, false, false, false, deadN], 48, 34);
      // vacancy strip
      ctx.fillStyle = "#101018";
      ctx.fillRect(48, 300, 160, 84);
      ctx.font = "bold 30px monospace";
      ctx.shadowColor = PAL.red;
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#d84a3c";
      ctx.fillText("NO", 128, 336);
      ctx.shadowColor = PAL.tungsten;
      ctx.fillStyle = deadN ? "#3a2a20" : PAL.tungsten;
      ctx.fillText("VACANCY", 128, 372);
      ctx.shadowBlur = 0;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    };
    const st = signTex(true, true, false);
    this.disposables.push({ tex: st });
    const signMat = new THREE.MeshBasicMaterial({ map: st, transparent: true });
    this.disposables.push({ mat: signMat });
    const face1 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.2), signMat);
    face1.position.set(0, 5.3, 0.27);
    const face2 = face1.clone();
    face2.position.z = -0.27;
    face2.rotation.y = Math.PI;
    g.add(face1, face2);
    this.disposables.push({ geo: face1.geometry });
    g.position.set(-13, 0, -2.5);
    g.rotation.y = 0.35;
    g.rotation.z = 0.015; // storm damage lean
    this.group.add(g);
    this.signGroup = g;
    if (!this.blackout) {
      const l = this.pointLight(0xE6AD61, 7, 10, -13, 4.8, -2.1);
      this.flickers.push({ light: l, mat: null, base: 7, style: 1, seed: 13 });
    }
  }

  // ---------------------------------------------------------- atmosphere fx
  private buildAtmosphere(): void {
    if (this.lowQuality) return;
    // dust motes drifting in the reception + garage light
    const mote = (cx: number, cy: number, cz: number, n: number, seed: number): void => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const rnd = mulberry32(seed);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = cx + (rnd() - 0.5) * 5;
        pos[i * 3 + 1] = cy + rnd() * 2.2;
        pos[i * 3 + 2] = cz + (rnd() - 0.5) * 5;
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xbfc8cc, size: 0.045, transparent: true, opacity: 0.5, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.userData.seed = seed;
      this.group.add(pts);
      this.dust.push(pts);
      this.disposables.push({ geo, mat });
    };
    mote(7.5, 0.8, -11.5, 60, 0xd057);
    mote(23, 1.0, -16, 60, 0xd058);
  }

  private buildSky(): void {
    const starGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const rnd = mulberry32(0x5151a);
    for (let i = 0; i < 420; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 0.9);
      const r = 160;
      positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) + 10, r * Math.sin(phi) * Math.sin(theta));
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd0e8, size: 0.55, sizeAttenuation: true }));
    this.group.add(stars);
    this.disposables.push({ geo: starGeo, mat: stars.material as THREE.Material });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xdfe8f5 }));
    moon.position.set(60, 70, -110);
    this.group.add(moon);
    this.disposables.push({ geo: moon.geometry, mat: moon.material as THREE.Material });
    void MAP_BOUNDS;
  }

  // ------------------------------------------------------------------ storm
  private buildStorm(): void {
    // The flash light joins the scene up-front (intensity 0) so the first
    // storm mission never pays a shader recompile mid-mission.
    this.stormLight = new THREE.HemisphereLight(0xe8f1ff, 0x10141b, 0);
    this.group.add(this.stormLight);
  }

  /** STORM CELL switch. Storm + blackout coexist on purpose: the blackout
   *  kills the lot's man-made lights, while the sky stays allowed to flash —
   *  distant lightning is the one thing out there nobody can switch off. */
  setStorm(on: boolean): void {
    if (on === this.stormOn) return;
    this.stormOn = on;
    if (on) {
      this.stormFlashAt = -1; // schedule the first flash on the next update
    } else {
      if (this.stormLight) this.stormLight.intensity = 0;
      this.stormFramesLeft = 0;
    }
  }

  // ------------------------------------------------------------------ update
  update(dt: number, t: number): void {
    // door swing
    for (const dv of this.doorViews) {
      const target = dv.group.userData.targetRot as number ?? dv.group.rotation.y;
      dv.group.rotation.y += (target - dv.group.rotation.y) * Math.min(1, 10 * dt);
    }
    this.animateHideDoors(dt);
    // flicker styles: 0 steady, 1 buzz, 2 failing, 3 pulse
    for (const f of this.flickers) {
      let k = 1;
      if (f.style === 1) {
        k = 0.94 + 0.06 * Math.sin(t * 47 + f.seed) * Math.sin(t * 13);
      } else if (f.style === 2) {
        const gate = Math.sin(t * 0.7 + f.seed) + Math.sin(t * 2.3 + f.seed * 2);
        const on = gate > -0.4 ? 1 : 0.06;
        k = on * (0.88 + 0.12 * Math.sin(t * 61 + f.seed));
      } else if (f.style === 3) {
        k = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.7 + f.seed));
      }
      f.light.intensity = f.base * k;
      if (f.mat) f.mat.color.setScalar(0.35 + 0.65 * k);
    }
    // ceiling fan
    if (this.fan) this.fan.rotation.y += dt * 1.6;
    // storm lean sway on the sign
    if (this.signGroup) {
      this.signGroup.rotation.z = 0.015 + Math.sin(t * 0.55) * 0.008 + Math.sin(t * 1.9) * 0.003;
    }
    // dust drift
    for (const pts of this.dust) {
      pts.rotation.y = t * 0.02;
      (pts.material as THREE.PointsMaterial).opacity = 0.35 + 0.2 * Math.sin(t * 0.8 + Number(pts.userData.seed));
    }
    // storm lightning: cold sky flash, 8-25 s apart, 2-4 frame spike
    if (this.stormOn && this.stormLight) {
      if (this.stormFlashAt < 0) {
        this.stormFlashAt = t + STORM_FLASH_GAP_MIN + Math.random() * (STORM_FLASH_GAP_MAX - STORM_FLASH_GAP_MIN);
      } else if (this.stormFramesLeft > 0) {
        // each spike frame re-jitters so the flash stutters like real sky light
        this.stormFramesLeft--;
        this.stormLight.intensity = this.stormFramesLeft > 0 ? STORM_FLASH_PEAK * (0.55 + Math.random() * 0.45) : 0;
      } else if (t >= this.stormFlashAt) {
        this.stormFramesLeft = 2 + Math.floor(Math.random() * 3);
        this.stormLight.intensity = STORM_FLASH_PEAK * (0.55 + Math.random() * 0.45);
        this.onFlash?.(); // the audio layer schedules the delayed thunder from here
      }
    }
  }

  /** cheap light culling: hide point lights the camera can't be lit by.
   *  The radius multiplier is quality-dependent (Low halves it). */
  cullLights(cam: THREE.Vector3): void {
    for (const m of this.managed) {
      if (m.essential) continue;
      const p = m.light.position;
      const d = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      m.light.visible = d < (m.range * this.cullScale) ** 2;
    }
  }

  /**
   * Quality tiers: low = dust motes off + flicker flattened to steady + the
   * light-cull radius halved. medium/high = full dressing; they differ only
   * in renderer pixel ratio, which the engine owns (Engine.applyQuality).
   */
  setQuality(q: "low" | "medium" | "high"): void {
    this.lowQuality = q === "low";
    this.cullScale = this.lowQuality ? CULL_SCALE_LOW : CULL_SCALE_FULL;
    for (const pts of this.dust) pts.visible = !this.lowQuality;
    for (const f of this.flickers) {
      if (this.lowQuality) {
        if (f.style0 === undefined) f.style0 = f.style;
        f.style = 0;
        f.light.intensity = f.base;
      } else if (f.style0 !== undefined) {
        f.style = f.style0; // tier raised again: bring the flicker back
      }
    }
  }

  setGateOpen(open: boolean): void {
    this.gateGroup.userData.targetX = open ? GATE.x - 8.4 : GATE.x + 0.4;
    if (this.gateGroup.userData.targetX === undefined) this.gateGroup.userData.targetX = GATE.x + 0.4;
  }

  applyGate(dt: number): void {
    const target = this.gateGroup.userData.targetX as number | undefined ?? GATE.x + 0.4;
    this.gateGroup.position.x += (target - this.gateGroup.position.x) * Math.min(1, 2.2 * dt);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.geo?.dispose();
      d.mat?.dispose();
      d.tex?.dispose();
    }
  }
}
