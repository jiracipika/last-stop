// Engine: three.js renderer + game view orchestration. Runs its own rAF loop;
// React only reads the HudStore. Doubles as the title-screen attract renderer:
// it boots once at the title (no room state) and the SAME canvas / WebGL
// context / World3D then serves the whole session — joining only hands the
// camera from the attract path to the gameplay path (see setAttract).
import * as THREE from "three";
import {
  AABB, DOORS, doorAabb, STATIC_COLLIDERS, ITEM_DEFS, PLAYER, VAN, VAN_START, CARRY, HIDE_SPOTS, dist2d, clamp, angleLerp,
  type RoomState, type PlayerState, QUICK_MESSAGES,
} from "@last-stop/shared";
import { World3D } from "./world3d.js";
import { VanView } from "./van3d.js";
import { EnemyView } from "./enemy3d.js";
import { AvatarView } from "./avatars.js";
import { ItemView } from "./items3d.js";
import { Predictor } from "./predict.js";
import { InputManager, type ActionKind } from "./input.js";
import { audio } from "./audio.js";
import type { Net, Ev } from "../net.js";
import type { HudStore } from "./store.js";

export interface QualitySettings {
  quality: "low" | "medium" | "high";
  headBob: boolean;
  shake: boolean;
  sensitivity: number;
}

interface Marker3D {
  mesh: THREE.Group;
  until: number;
}

interface TargetInfo {
  kind: string;
  id: string;
  label: string;
}

const clamp01 = (v: number) => clamp(v, 0, 1);

// ---- moment-to-moment feel tuning (client-only; no server parity impact) ----
const BASE_FOV = 75;
const SPRINT_FOV_KICK = 6; // degrees of FOV widen while sprinting
const FOV_EASE_RATE = 9; // exponential ease toward the sprint FOV target
const BOB_AMPLITUDE = 0.045; // meters of view-bob at full walk speed
const BUMP_MIN_IMPULSE = 2; // m/s of collision-stripped velocity that counts as a slam
const BUMP_COOLDOWN = 0.4; // seconds between wall-thud sounds

// ---- attract mode (title-screen cinematic) ---------------------------------
// A closed loop of slow dolly moves past the lot's landmarks: the PALE
// LANTERN sign, the porch bulbs, the parked van, then a crane back out to the
// wide shot. Tuned by eye — every number lives in this table. Segment easing
// is smoothstep, so velocity hits zero at every pose and the loop wraps with
// no visible seam. The camera is a pure function of wall-clock t, which makes
// stop/resume (hidden tab, cancelled join) pop-free.
const ATTRACT_FOV = 66; // narrower lens than gameplay; the FOV ease hands it back on join

interface AttractPose {
  pos: [number, number, number];
  look: [number, number, number];
  dur: number; // seconds of travel to the NEXT pose
}

const ATTRACT_PATH: AttractPose[] = [
  // wide establishing shot from the south-west fence line: motel facade,
  // sign, lamp pool — the whole lot in one frame
  { pos: [-26, 10.5, 15], look: [-6, 2.0, -6], dur: 12 },
  // slow push in on the sign's lit face (it faces the south-east)
  { pos: [-4.5, 2.8, 5.5], look: [-13, 4.6, -2.5], dur: 13 },
  // glide east along the walkway, porch bulbs and dead windows sliding past
  { pos: [9.5, 2.6, 0.5], look: [-2, 2.2, -7.8], dur: 13 },
  // swing around the van's rear three-quarter at its lot spawn
  { pos: [8.5, 2.6, 20.5], look: [2, 1.5, 13.5], dur: 12 },
];
const ATTRACT_LOOP_LEN = ATTRACT_PATH.reduce((s, p) => s + p.dur, 0); // 50 s

/** Two-snapshot interpolation buffer for remote entities (~120 ms delay). */
class SnapBuf {
  private snaps: { at: number; x: number; z: number; yaw: number }[] = [];
  private lastX = NaN;
  private lastZ = NaN;

  push(at: number, x: number, z: number, yaw: number): void {
    // hard teleport: reset history so we don't smear across the map
    if (Number.isFinite(this.lastX) && Math.hypot(x - this.lastX, z - this.lastZ) > 2.5) {
      this.snaps = [];
    }
    this.lastX = x;
    this.lastZ = z;
    const prev = this.snaps[this.snaps.length - 1];
    if (prev && Math.hypot(x - prev.x, z - prev.z) < 0.005 && Math.abs(x - prev.x) < 0.005) {
      return; // unchanged; heartbeat below keeps the buffer fresh enough
    }
    this.snaps.push({ at, x, z, yaw });
    if (this.snaps.length > 20) this.snaps.shift();
  }

  sample(renderAt: number): { x: number; z: number; yaw: number } | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    if (n === 1) return this.snaps[0]!;
    for (let i = n - 1; i > 0; i--) {
      const b = this.snaps[i]!;
      const a = this.snaps[i - 1]!;
      if (a.at <= renderAt && renderAt <= b.at) {
        const span = b.at - a.at || 1;
        const t = (renderAt - a.at) / span;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: angleLerp(a.yaw, b.yaw, t) };
      }
    }
    return this.snaps[n - 1]!; // render time ahead of the newest snapshot
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world3d: World3D;
  vanView: VanView;
  enemyView = new EnemyView();
  avatars = new Map<string, AvatarView>();
  itemViews = new Map<string, ItemView>();
  markers3d: Marker3D[] = [];
  predictor: Predictor;
  store: HudStore;
  net: Net;
  settings: QualitySettings;
  /** True while the title cinematic owns the camera (no room joined). */
  private attractMode = true;
  /** Wired by App: drops the title back to its static backdrop if the
   *  attract loop ever throws, so a broken menu never blocks joining. */
  onAttractFail: (() => void) | null = null;
  private inputInstance: InputManager | null = null;
  /**
   * Input listeners attach on first need, not at construction: at the title
   * they would swallow WASD/Space keystrokes (the manager preventDefaults
   * movement keys on window) while the player types in the sign-in sheet.
   */
  get input(): InputManager {
    if (!this.inputInstance) {
      this.inputInstance = new InputManager(this.renderer.domElement);
      this.inputInstance.sensitivity = this.settings.sensitivity;
      this.inputInstance.onAction = (a) => this.onAction(a);
    }
    return this.inputInstance;
  }

  private raf = 0;
  private lastFrame = 0;
  private running = false;
  private ownSeq = 0;
  private target: TargetInfo | null = null;
  private shakeAmount = 0;
  private bobPhase = 0;
  private lastEnemyAi = 0;
  private lastEnemyChaseSid = ""; // previous frame's chase target, for the lost-you cue
  private lastEnemyX = 0;
  private lastEnemyZ = 0;
  private estepDist = 0;
  private clinkTimer = 3;
  private spottedCd = 0; // chase-entry sting cooldown (someone else's chase)
  private youSpottedCd = 0; // targeted-you sting cooldown (short: re-sightings re-warn)
  private lostCd = 0; // lost-the-trail cooldown
  private itickTimer = 1.8; // investigate cloth-tick cadence
  private spectateIdx = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private bangToastCd = 0;
  private remoteBufs = new Map<string, SnapBuf>();
  private vanBuf = new SnapBuf();
  private enemyBuf = new SnapBuf();
  private lastPatchAt = 0;
  private watchedRoom: unknown = null; // room instance the patch stamp is wired to
  private hudTimer = 0;
  private lastPhase = "lobby";
  private stormOn = false;
  private wasSeated = 0;
  private disposers: (() => void)[] = [];
  /** Dev photo mode: when set, the camera holds this pose (world -> lookAt). */
  frozenCam: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null = null;

  constructor(canvas: HTMLCanvasElement, net: Net, store: HudStore, settings: QualitySettings) {
    this.store = store;
    this.net = net;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== "low", powerPreference: "high-performance" });
    this.renderer.setClearColor(0x0a0f16);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 240);
    this.scene.fog = new THREE.FogExp2(0x0a0f16, 0.021);

    this.scene.add(new THREE.AmbientLight(0x22304a, 0.75));
    const moon = new THREE.DirectionalLight(0x8fa8d0, 0.5);
    moon.position.set(40, 60, -50);
    this.scene.add(moon);
    const hemi = new THREE.HemisphereLight(0x2a3648, 0x14161a, 0.5);
    this.scene.add(hemi);

    const mods: string[] = net.state ? [...net.state.modifiers] : [];
    const blackout = mods.includes("blackout");
    this.world3d = new World3D(blackout);
    this.scene.add(this.world3d.group);
    this.vanView = new VanView(this.world3d.textureKit);
    this.scene.add(this.vanView.group);
    this.scene.add(this.enemyView.group);

    this.predictor = new Predictor(() => this.dynamicColliders());
    // InputManager is created lazily by the `input` getter: at the title its
    // window listeners would eat the nickname field's keystrokes.

    net.onEvent((e) => this.handleEvent(e));
    // net.room?.onStateChange is NOT subscribed here: at boot (attract mode)
    // no room exists yet — the subscription is attached lazily in frame().
    net.onStatus(() => {
      store.set({ connStatus: net.status, connDetail: net.statusDetail });
    });

    this.applyQuality();
    this.resize();
    const onResize = () => this.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));

    // Attract power-saving: a hidden tab must not keep rendering the menu
    // cinematic. The game loop is deliberately left alone — rAF is already
    // suspended by the browser for hidden tabs and mid-mission sim state
    // would only stutter on an explicit stop/start.
    const onVisibility = () => {
      if (document.hidden) {
        if (this.attractMode) this.stop();
      } else if (this.attractMode) {
        this.start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));

    // WebGL context loss: keep the page alive and recover when it returns
    const onCtxLost = (e: Event) => {
      e.preventDefault();
      store.toast("Graphics context lost — recovering…", "warn");
    };
    const onCtxRestored = () => {
      store.toast("Graphics recovered", "good");
      this.resize();
    };
    canvas.addEventListener("webglcontextlost", onCtxLost);
    canvas.addEventListener("webglcontextrestored", onCtxRestored);
    this.disposers.push(() => {
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
    });
  }

  private dynamicColliders(): AABB[] {
    // static walls + closed doors (mirrors server player colliders)
    const closed: AABB[] = [];
    const st = this.net.state;
    if (st) {
      for (const ds of st.doors.values()) {
        if (!ds.open) {
          const def = DOORS.find((d) => d.id === ds.id);
          if (def) closed.push(doorAabb(def));
        }
      }
    }
    return STATIC_COLLIDERS.concat(closed);
  }

  applyQuality(): void {
    // Tier definitions — renderer knobs here, world knobs in World3D.setQuality:
    //   low    — pixelRatio <= 1 (0.75x DPR), antialias off (construction-time),
    //            denser fog, dust motes off, flicker flattened to steady,
    //            light-cull radius halved (fewer lit pixels per frame)
    //   medium — pixelRatio <= 1.25, everything else on
    //   high   — full devicePixelRatio, everything on (previous default look)
    // Antialias is fixed when the GL context is created: flipping it live
    // would need a new context, so only the pixel ratio responds mid-session.
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === "low" ? Math.min(1, dpr * 0.75) : q === "medium" ? Math.min(1.25, dpr) : dpr);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = q === "low" ? 0.03 : 0.021;
    this.world3d.setQuality(q);
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /**
   * Title <-> game handoff. ON: the attract camera owns the view and input
   * listeners are torn down again (typing in the sign-in sheet must never be
   * hijacked). OFF: the loop keeps running — the game camera takes over the
   * moment room state lands; App explicitly stops/starts the loop around the
   * join window itself.
   */
  setAttract(on: boolean): void {
    if (on === this.attractMode) return;
    this.attractMode = on;
    if (on) {
      if (this.inputInstance) {
        this.input.exitLock();
        this.inputInstance.dispose();
        this.inputInstance = null;
      }
      if (!document.hidden) this.start();
    }
  }

  dispose(): void {
    this.stop();
    this.inputInstance?.dispose();
    this.inputInstance = null;
    this.disposers.forEach((d) => d());
    audio.setRain(false); // ambient loops outlive the engine; drop the storm with it
    this.world3d.setStorm(false);
    this.world3d.dispose();
    this.vanView.dispose();
    this.enemyView.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ actions
  private onAction(a: ActionKind): void {
    const st = this.net.state;
    if (!st) return;
    const me = st.players.get(this.net.sid);
    if (a === "pause") return; // handled by React
    if (!me) return;

    switch (a) {
      case "grabRelease":
        if (me.carrying) {
          this.net.act("release", { thrown: this.input.keys.has("ShiftLeft") });
        } else if (this.target?.kind === "item") {
          this.net.act("grab", { id: this.target.id });
        }
        break;
      case "throwItem":
        if (me.carrying) this.net.act("release", { thrown: true });
        break;
      case "flashlight":
        this.net.act("flashlight");
        audio.click();
        break;
      case "ping": {
        // ping a few meters ahead along the view, or exactly at the targeted object
        const aimed = this.target?.kind === "item" || this.target?.kind === "door" || this.target?.kind === "revive";
        const d = 6;
        const px = aimed ? this.lastTargetPos.x : this.camera.position.x + Math.sin(this.input.yaw) * d;
        const pz = aimed ? this.lastTargetPos.z : this.camera.position.z + Math.cos(this.input.yaw) * d;
        let kind = "ping";
        if (this.target?.kind === "item") kind = "item";
        this.net.act("ping3d", { x: px, z: pz, kind });
        break;
      }
      case "quick0":
      case "quick1":
      case "quick2": {
        const idx = Number(a.slice(-1));
        const msg = QUICK_MESSAGES[idx];
        if (msg) this.net.act("quick", { i: idx });
        break;
      }
      case "interactTap": {
        const t = this.target;
        if (me.seat > 0) {
          this.net.act("exitVan");
        } else if (t) {
          if (t.kind === "door") this.net.act("door", { id: t.id });
          else if (t.kind === "vanDoors") this.net.act("vanDoors");
          else if (t.kind === "vanLights") this.net.act("vanLights");
          else if (t.kind === "straps") this.net.act("straps");
          else if (t.kind === "seatDriver") this.net.act("enterVan", { driver: true });
          else if (t.kind === "seat") this.net.act("enterVan", { driver: false });
          else if (t.kind === "hide") this.net.act("hide", { spot: t.id });
          else if (t.kind === "hidden") this.net.act("hide", { out: true });
          // revive/install are hold-interactions via input.interact
        }
        break;
      }
      case "horn":
        this.net.act("horn");
        break;
      case "exitVan":
        this.net.act("exitVan");
        break;
    }
  }

  private lastTargetPos = { x: 0, z: 0 };

  // ------------------------------------------------------------------ events
  handleEvent(e: Ev): void {
    const st = this.net.state;
    const cam = { x: this.camera.position.x, z: this.camera.position.z, yaw: this.input.yaw };
    switch (e.t) {
      case "grab":
        if (e.by === this.net.sid) {
          audio.grab();
          const grabbed = st?.items.get(String(e.item));
          // picked up the second handle of a heavy? tell them they're teamed up
          if (grabbed?.h1 === this.net.sid) {
            this.store.toast("You've got the other end — walk together", "good");
          }
        }
        break;
      case "drop":
        audio.playEventAt("drop", Number(e.x ?? this.camera.position.x), Number(e.z ?? this.camera.position.z), cam);
        break;
      case "stored":
        audio.stored();
        if (Number(e.value) > 0) this.store.toast(`+$${e.value} secured`, "good");
        break;
      case "damage":
        audio.glass();
        if (Number(e.lost) > 0) this.store.toast(`-${Math.round(Number(e.lost))} ${e.cause === "bump" ? "(cargo banged up)" : "(broke something)"}`, "warn");
        break;
      case "door":
        audio.playEventAt("door", Number(e.x ?? 0), Number(e.z ?? 0), cam);
        break;
      case "vanDoors":
        audio.vanDoor();
        break;
      case "vanLights":
        audio.click();
        break;
      case "straps":
        audio.click();
        this.store.toast(e.on ? "Cargo strapped down" : "Straps released", "info");
        break;
      case "bang": {
        audio.playEventAt("bang", Number(e.x ?? 0), Number(e.z ?? 0), cam);
        this.shake(0.25);
        const bx = Number(e.x ?? 0);
        const bz = Number(e.z ?? 0);
        const near = dist2d(this.predictor.body.x, this.predictor.body.z, bx, bz);
        if (near < 7 && this.bangToastCd <= 0) {
          this.bangToastCd = 4;
          this.store.toast("IT'S FORCING A DOOR — hold it or run!", "warn");
        }
        break;
      }
      case "hurt":
        if (e.sid === this.net.sid) {
          audio.hurt();
          this.store.set({ damageFlash: 1 });
          this.shake(0.5);
        }
        break;
      case "strike":
        this.shake(0.8);
        audio.bump(9);
        break;
      case "down":
        audio.down();
        if (e.sid === this.net.sid) this.store.toast("You are DOWN — a teammate can help you up", "warn");
        else this.store.toast("Teammate down!", "warn");
        break;
      case "die":
        if (e.sid === this.net.sid) this.store.toast("You did not make it. Spectating…", "warn");
        break;
      case "revive":
        audio.revive();
        this.store.toast("Teammate back on their feet", "good");
        break;
      case "install":
        audio.quotaDing();
        this.store.toast("Distributor installed — van can run again", "good");
        break;
      case "gate":
        audio.gate();
        this.store.toast("EXIT GATE OPEN — get everyone to the van", "good");
        break;
      case "escalate":
        audio.escalate();
        this.store.toast("Something out there is getting bolder…", "warn");
        break;
      case "bump":
        audio.bump(Number(e.v ?? 5));
        this.shake(clamp01(Number(e.v ?? 5) / 14));
        break;
      case "horn":
        audio.horn();
        break;
      case "leaveWarn":
        this.store.set({ leaveWarn: Number(e.outside ?? 0) });
        this.store.toast(`${e.outside} teammate(s) still out there! Press W again to leave them.`, "warn");
        break;
      case "toast":
        this.store.toast(String(e.msg ?? ""), "info");
        break;
      case "ping3d":
        this.spawnMarker(Number(e.x), Number(e.z), String(e.kind));
        break;
      case "quick":
        this.store.toast(`${st?.players.get(String(e.sid))?.nick ?? "?"}: ${e.msg}`, "info");
        if (e.sid !== this.net.sid) this.spawnBubble(String(e.sid), String(e.msg));
        break;
      case "slip":
        if (e.by === this.net.sid) this.store.toast("It slipped! Watch the leash", "warn");
        break;
      case "seat":
        break;
      case "hide": {
        const dragged = !e.on && e.dragged === true;
        if (e.sid === this.net.sid) {
          if (dragged) this.store.toast("It DRAGGED you out of there!", "warn");
          else {
            // lid clunk plus a body-of-cloth rustle, both ways in/out
            audio.vanDoor();
            audio.rustle();
          }
          if (e.on) this.store.toast("Tucked in. Stay quiet and it'll pass you by", "info");
        }
        if (dragged) {
          // busted: the Caretaker hauled them out of the junker — thump + scrape from the car
          const p = st?.players.get(String(e.sid));
          if (p) audio.playEventAt("drag", p.x, p.z, cam);
        }
        break;
      }
      case "prog":
        if (e.sid === this.net.sid) {
          this.store.set({ progress: clamp01(Number(e.v)), progressKind: String(e.k) });
        }
        break;
      case "results":
        audio.resultsJingle(e.outcome === "escaped");
        break;
      case "roomError":
        this.store.toast(`Room error: ${e.msg ?? ""}`, "warn");
        break;
      default:
        break;
    }
    void cam;
  }

  private spawnMarker(x: number, z: number, kind: string): void {
    const g = new THREE.Group();
    const color = kind === "danger" ? 0xff5044 : kind === "item" ? 0xffd268 : 0x7fd4ff;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 3, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    beam.position.y = 1.5;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 22),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(beam, ring);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.markers3d.push({ mesh: g, until: performance.now() + 6000 });
    if (this.markers3d.length > 10) {
      const old = this.markers3d.shift()!;
      this.scene.remove(old.mesh);
    }
  }

  private bubbleSprites = new Map<string, { sprite: THREE.Sprite; until: number }>();

  private spawnBubble(sid: string, text: string): void {
    const st = this.net.state;
    const p = st?.players.get(sid);
    const av = this.avatars.get(sid);
    if (!p || !av) return;
    const existing = this.bubbleSprites.get(sid);
    if (existing) this.scene.remove(existing.sprite);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(10,14,20,0.8)";
    ctx.fillRect(0, 8, 256, 44);
    ctx.strokeStyle = "#7fd4ff";
    ctx.strokeRect(0, 8, 256, 44);
    ctx.font = "bold 26px monospace";
    ctx.fillStyle = "#cfe8ff";
    ctx.textAlign = "center";
    ctx.fillText(text, 128, 40);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.set(0, 2.7, 0);
    av.group.add(sprite);
    this.bubbleSprites.set(sid, { sprite, until: performance.now() + 3000 });
  }

  shake(amount: number): void {
    if (this.settings.shake) this.shakeAmount = Math.min(1, this.shakeAmount + amount);
  }

  // ------------------------------------------------------------------ targeting
  private scanTarget(st: RoomState, me: PlayerState): void {
    const fwd = { x: Math.sin(this.input.yaw), z: Math.cos(this.input.yaw) };
    const px = this.predictor.body.x;
    const pz = this.predictor.body.z;
    let best: (TargetInfo & { score: number; pos: { x: number; z: number } }) | null = null;
    const consider = (t: TargetInfo, x: number, z: number, range: number, weight = 1) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const dot = d < 0.01 ? 1 : (dx * fwd.x + dz * fwd.z) / d;
      if (dot < 0.55 && d > 1.2) return;
      const score = dot * weight * 2 - d * 0.08;
      if (!best || score > best.score) best = { ...t, score, pos: { x, z } };
    };

    if (me.seat > 0) {
      this.target = null;
      return;
    }

    if (me.hidden) {
      this.target = { kind: "hidden", id: "self", label: "Hidden — move or press E to climb out" };
      return;
    }

    for (const [id, it] of st.items) {
      if (it.state === 2 || it.state === 3) continue;
      const def = ITEM_DEFS[it.defId];
      if (!def) continue;
      const mine = me.carrying === id;
      if (it.state === 1 && !mine) {
        const handleFree = def.twoHandle && !it.h1;
        if (!handleFree) continue;
        if (me.carrying) continue;
        consider({ kind: "item", id, label: `Take second handle — ${def.name}` }, it.x, it.z, PLAYER.GRAB_RANGE + def.radius);
        continue;
      }
      if (it.state === 0) {
        consider({ kind: "item", id, label: `Grab ${def.name} ($${it.value})` }, it.x, it.z, PLAYER.GRAB_RANGE + def.radius);
      }
    }

    // junker hiding spots
    if (!me.carrying) {
      for (const s of HIDE_SPOTS) {
        consider(
          { kind: "hide", id: s.id, label: s.kind === "trunk" ? "Fold yourself into the trunk" : "Hide in the sedan" },
          s.standX, s.standZ, PLAYER.INTERACT_RANGE + 0.8, 0.8,
        );
      }
    }

    // doors
    for (const ds of st.doors.values()) {
      const def = DOORS.find((d) => d.id === ds.id);
      if (!def) continue;
      const a = doorAabb(def);
      const cx = (a.x0 + a.x1) / 2;
      const cz = (a.z0 + a.z1) / 2;
      consider({ kind: "door", id: def.id, label: ds.open ? "Close door" : "Open door" }, cx, cz, PLAYER.INTERACT_RANGE + 0.4, 0.9);
    }

    // van interactions
    const van = st.van;
    const vcos = Math.cos(van.yaw);
    const vsin = Math.sin(van.yaw);
    const toWorld = (lx: number, lz: number) => ({ x: van.x + lx * vcos + lz * vsin, z: van.z - lx * vsin + lz * vcos });
    const rear = toWorld(VAN.DOOR_POINT.x, VAN.DOOR_POINT.z);
    const strap = toWorld(VAN.STRAP_POINT.x, VAN.STRAP_POINT.z);
    const enginePt = toWorld(VAN.ENGINE_POINT.x, VAN.ENGINE_POINT.z);
    const driverDoor = toWorld(-VAN.HALF_W - 0.3, 1.6);
    consider({ kind: "vanDoors", id: "van", label: van.doorsOpen ? "Close van doors" : "Open van doors" }, rear.x, rear.z, PLAYER.INTERACT_RANGE + 0.8, 1.1);
    consider({ kind: "vanLights", id: "van", label: van.lightsOn ? "Kill headlights" : "Headlights on" }, driverDoor.x, driverDoor.z, PLAYER.INTERACT_RANGE + 0.6, 0.8);
    if (van.cargo.length > 0) {
      consider({ kind: "straps", id: "van", label: van.strapped ? "Release cargo straps" : "Strap down cargo" }, strap.x, strap.z, PLAYER.INTERACT_RANGE + 0.8, 1.1);
    }
    if (!me.carrying) {
      consider({ kind: "seatDriver", id: "van", label: van.driver ? "Driver seat taken" : "Take the wheel" }, driverDoor.x, driverDoor.z, PLAYER.INTERACT_RANGE + 0.6, 1.0);
      consider({ kind: "seat", id: "van", label: "Ride shotgun" }, rear.x, rear.z, PLAYER.INTERACT_RANGE + 0.8, 0.7);
    }

    // install prompt when carrying the part near the engine
    if (me.carrying) {
      const carried = st.items.get(me.carrying);
      if (carried?.defId === "distributor" && !van.partInstalled) {
        const d = dist2d(px, pz, enginePt.x, enginePt.z);
        if (d < PLAYER.INTERACT_RANGE + 1.2) {
          this.target = { kind: "install", id: me.carrying, label: "Hold E — install distributor" };
          this.lastTargetPos = enginePt;
          return;
        }
      }
    }

    // revive prompt
    for (const [sid2, p] of st.players) {
      if (p.downed && !p.dead && sid2 !== this.net.sid) {
        consider({ kind: "revive", id: sid2, label: `Hold E — pick up ${p.nick}` }, p.x, p.z, PLAYER.INTERACT_RANGE, 1.4);
      }
    }

    if (best) {
      const b = best as { kind: string; id: string; label: string; pos: { x: number; z: number } };
      this.target = { kind: b.kind, id: b.id, label: b.label };
      this.lastTargetPos = b.pos;
    } else {
      this.target = null;
    }
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number): void {
    try {
      this.frameInner(now);
    } catch (e) {
      // Failure isolation is attract-only: a thrown frame mid-game keeps
      // today's loud-crash behavior so bugs stay visible.
      if (!this.attractMode || this.net.state) throw e;
      console.warn("[laststop] attract render failed; title falls back to the static backdrop", e);
      this.onAttractFail?.();
      this.stop();
    }
  }

  private frameInner(now: number): void {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000) || 0.016;
    this.lastFrame = now;
    const t = now / 1000;
    const st = this.net.state;

    this.fpsAcc += dt;
    this.fpsN++;
    if (this.bangToastCd > 0) this.bangToastCd -= dt;
    this.store.pruneToasts();

    if (st) {
      // The engine boots before any room exists (attract mode), so the
      // patch-timestamp subscription the interpolation buffers rely on is
      // attached the first time a room appears — and re-attached if a
      // reconnect swaps in a fresh room instance.
      if (this.net.room && this.watchedRoom !== this.net.room) {
        this.watchedRoom = this.net.room;
        this.net.room.onStateChange(() => {
          this.lastPatchAt = performance.now();
        });
      }
      const me = st.players.get(this.net.sid);
      if (me) {
        this.stepSelf(dt, st, me);
        this.scanTarget(st, me);
      }
      this.syncEntities(dt, st, t, now);
      this.world3d.update(dt, t);
      this.world3d.applyGate(dt);
      this.world3d.cullLights(this.camera.position);
      this.updateEnemyAudio(st, dt);
    } else {
      // No room yet (attract mode + the join window): the lot runs its
      // ambient life — flicker, fan, sign sway — with no storm, no players
      // and no Caretaker. The van sits at its lot spawn, engine cold.
      this.vanView.update(VAN_START.x, VAN_START.z, VAN_START.yaw, 0, false, false, t);
      this.enemyView.group.visible = false;
      this.world3d.update(dt, t);
      this.world3d.cullLights(this.camera.position);
    }

    this.updateCamera(dt, t, st);
    this.updateMarkers(dt);

    // decay UI flashes
    if (this.store.state.damageFlash > 0) {
      this.store.set({ damageFlash: Math.max(0, this.store.state.damageFlash - dt * 1.6) });
    }
    if (this.shakeAmount > 0) this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.4);

    this.renderer.render(this.scene, this.camera);

    // HUD push at ~12 Hz
    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && st) {
      this.hudTimer = 0.08;
      this.pushHud(st);
    }
  }

  private stepSelf(dt: number, st: RoomState, me: PlayerState): void {
    const fi = this.input.frame();
    const drivable = st.phase === "escape" && me.seat === 1;
    if (me.seat > 0 || me.downed || me.dead || me.hidden) {
      // no local walking sim; follow authoritative position
      this.predictor.reset(me.x, me.z, me.yaw);
      this.input.jumpQueued = false;
    } else {
      const speed = this.predictor.speedFor(st, this.net.sid);
      const seq = this.predictor.nextSeq();
      this.predictor.carrying = me.carrying; // gates the stop-slide (server parity)
      this.predictor.step(dt, fi, speed);
      this.predictor.reconcile(me.x, me.z, me.inputSeq);
      void seq;
      // hard contact with a wall/prop: the predictor reports how much velocity
      // the collision resolve stripped this tick — slam it as a soft thud
      this.bumpCd -= dt;
      if (this.predictor.bumpImpulse >= BUMP_MIN_IMPULSE && this.bumpCd <= 0) {
        this.bumpCd = BUMP_COOLDOWN;
        audio.bump(this.predictor.bumpImpulse);
      }
      // footsteps locally
      const v = Math.hypot(this.predictor.body.vx, this.predictor.body.vz);
      this.bobPhase += dt * (v * (me.sprinting ? 3.4 : 2.6));
      if (v > 1.4) {
        this.stepAcc += dt * v;
        if (this.stepAcc > (me.sprinting ? 2.4 : 1.8)) {
          this.stepAcc = 0;
          audio.footstep(me.sprinting);
        }
      }
    }
    // send input at 20 Hz
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      this.net.sendInput({
        mx: fi.mx,
        mz: drivable ? fi.mz : fi.mz,
        yaw: fi.yaw,
        pitch: fi.pitch,
        sprint: fi.sprint,
        jump: fi.jump,
        interact: fi.interact,
        stabilize: fi.stabilize,
        seq: ++this.ownSeq,
      });
    }
    void drivable;
  }

  private stepAcc = 0;
  private sendAcc = 0;
  private bumpCd = 0;

  private syncEntities(dt: number, st: RoomState, t: number, nowMs: number): void {
    const k = Math.min(1, 12 * dt); // smoothing toward authoritative state
    const renderAt = nowMs - 120; // interpolation delay for remote entities
    // players
    const seen = new Set<string>();
    for (const [sid, p] of st.players) {
      seen.add(sid);
      let av = this.avatars.get(sid);
      if (!av) {
        av = new AvatarView(sid, p.color, p.nick, p.hat);
        this.avatars.set(sid, av);
        this.scene.add(av.group);
      }
      if (sid === this.net.sid) {
        // own avatar follows prediction; hidden in first person (body visible edges)
        const px = this.predictor.body.x;
        const pz = this.predictor.body.z;
        av.group.position.set(px, p.y, pz);
        av.group.rotation.y = p.yaw;
        av.group.visible = !p.dead && p.seat === 0;
        if (p.seat > 0 || p.downed) av.group.visible = true;
        av.update(0.0001, { ...p, x: px, z: pz } as PlayerState, t);
      } else {
        // buffered interpolation: render the remote player ~120 ms in the past
        let buf = this.remoteBufs.get(sid);
        if (!buf) {
          buf = new SnapBuf();
          this.remoteBufs.set(sid, buf);
        }
        buf.push(this.lastPatchAt || nowMs, p.x, p.z, p.yaw);
        const s = buf.sample(renderAt) ?? { x: p.x, z: p.z, yaw: p.yaw };
        av.update(dt, { ...p, x: s.x, z: s.z, yaw: s.yaw } as PlayerState, t);
      }
    }
    for (const [sid, av] of this.avatars) {
      if (!seen.has(sid)) {
        this.scene.remove(av.group);
        this.avatars.delete(sid);
        this.remoteBufs.delete(sid);
      }
    }
    // items
    const me = st.players.get(this.net.sid);
    const seenItems = new Set<string>();
    for (const [id, it] of st.items) {
      seenItems.add(id);
      let view = this.itemViews.get(id);
      if (!view) {
        view = new ItemView(id, it.defId);
        this.itemViews.set(id, view);
        this.scene.add(view.group);
      }
      const highlighted = this.target?.kind === "item" && this.target.id === id;
      let showX: number;
      let showZ: number;
      let showY: number;
      if (it.state === 2) {
        view.group.visible = false;
        continue;
      }
      if (me && me.carrying === id) {
        // render the item I'm carrying at MY predicted hold point (no lag)
        const fx = Math.sin(this.input.yaw);
        const fz = Math.cos(this.input.yaw);
        showX = this.predictor.body.x + fx * CARRY.HOLD_DIST;
        showZ = this.predictor.body.z + fz * CARRY.HOLD_DIST;
        showY = CARRY.HOLD_Y;
      } else {
        showX = view.group.position.x + (it.x - view.group.position.x) * k;
        showZ = view.group.position.z + (it.z - view.group.position.z) * k;
        showY = it.y;
      }
      view.update({ ...it, x: showX, y: showY, z: showZ } as typeof it, highlighted, t);
    }
    for (const [id, view] of this.itemViews) {
      if (!seenItems.has(id)) {
        this.scene.remove(view.group);
        this.itemViews.delete(id);
      }
    }
    // van + enemy
    const v = st.van;
    this.vanBuf.push(this.lastPatchAt || nowMs, v.x, v.z, v.yaw);
    const vs = this.vanBuf.sample(renderAt) ?? { x: v.x, z: v.z, yaw: v.yaw };
    this.vanView.update(vs.x, vs.z, vs.yaw, v.speed, v.doorsOpen, v.lightsOn, t);
    this.vanView.syncCargo(v.cargo.length, v.strapped, t);
    const e = st.enemy;
    this.enemyView.group.visible = st.phase === "scavenge" || st.phase === "escape";
    this.enemyBuf.push(this.lastPatchAt || nowMs, e.x, e.z, e.yaw);
    const es = this.enemyBuf.sample(renderAt) ?? { x: e.x, z: e.z, yaw: e.yaw };
    this.enemyView.update(dt, { ...e, x: es.x, z: es.z, yaw: es.yaw }, t);
    // junker hide doors mirror who's tucked in
    for (const s of HIDE_SPOTS) {
      let occupied = false;
      for (const p of st.players.values()) {
        if (p.hidden && Math.hypot(p.x - s.x, p.z - s.z) < 1) occupied = true;
      }
      this.world3d.setHideOpen(s.id, occupied);
    }
    // gate
    this.world3d.setGateOpen(st.gateOpen);
    // doors
    for (const dv of this.world3d.doorViews) {
      const ds = st.doors.get(dv.def.id);
      if (ds && ds.open !== dv.open) {
        this.world3d.setDoor(this.world3d.doorViews.indexOf(dv), ds.open);
      }
    }
  }

  private updateEnemyAudio(st: RoomState, dt: number): void {
    const e = st.enemy;
    const me = st.players.get(this.net.sid);
    if (!me) return;
    const d = dist2d(this.predictor.body.x, this.predictor.body.z, e.x, e.z);
    const chasing = e.ai === 2 || e.ai === 3;
    // Caretaker sounds, positioned through playEventAt
    const cam = { x: this.camera.position.x, z: this.camera.position.z, yaw: this.input.yaw };
    const ex = this.enemyView.group.position.x; // interpolated render position
    const ez = this.enemyView.group.position.z;
    if (this.spottedCd > 0) this.spottedCd -= dt;
    if (this.youSpottedCd > 0) this.youSpottedCd -= dt;
    if (this.lostCd > 0) this.lostCd -= dt;
    if (st.phase === "scavenge" || st.phase === "escape") {
      // State-vocabulary transition cues, split by victim now that chaseSid is
      // on the wire: locked onto ME = full-volume sting + toast (it is coming
      // for me specifically); locked onto someone else = the softer positional
      // cue as before. The targeted-you sting keeps its own short cooldown so
      // forced-door chase pauses do not machine-gun the toast, while a genuine
      // lose-then-re-find (>= LOSE_SIGHT_GRACE apart) still re-warns.
      if (e.ai === 2 && this.lastEnemyAi !== 2) {
        if (e.chaseSid === this.net.sid && this.youSpottedCd <= 0) {
          this.youSpottedCd = 3;
          audio.sting();
          this.store.toast("IT'S SEEN YOU. RUN.", "warn");
        } else if (e.chaseSid !== this.net.sid && this.spottedCd <= 0) {
          this.spottedCd = 6;
          audio.playEventAt("spotted", ex, ez, cam);
        }
      }
      // Lost the trail: the exhale lands differently on its ex-target —
      // floored attenuation ("lostYou") reads as personal without ever
      // approaching the sting's volume. The strike path (2/3 -> recover)
      // stays cue-less on purpose: the windup/strike cues already dominate it.
      if ((this.lastEnemyAi === 2 || this.lastEnemyAi === 3) && (e.ai === 0 || e.ai === 1) && this.lostCd <= 0) {
        this.lostCd = 8;
        if (this.lastEnemyChaseSid === this.net.sid) {
          audio.playEventAt("lostYou", ex, ez, cam);
        } else {
          audio.playEventAt("lost", ex, ez, cam);
        }
      }
      if (e.ai === 3 && this.lastEnemyAi !== 3) {
        audio.playEventAt("windup", ex, ez, cam);
      }
      // investigating: faint dry cloth ticks so searching has its own texture
      if (e.ai === 1) {
        this.itickTimer -= dt;
        if (this.itickTimer <= 0) {
          this.itickTimer = 1.5 + Math.random() * 0.5;
          audio.playEventAt("itick", ex, ez, cam);
        }
      } else {
        this.itickTimer = 1.8; // stop instantly on any state change
      }
    }
    this.lastEnemyAi = e.ai;
    this.lastEnemyChaseSid = e.chaseSid;
    const intensity = chasing ? clamp01(1.4 - d / 22) : e.ai === 1 ? clamp01(0.6 - d / 30) : 0;
    audio.setChaseIntensity(intensity);
    audio.heartbeat(dt, intensity);
    if (me.seat === 1) audio.engine(st.van.speed, st.phase === "escape");
    else audio.engine(0, false);

    // tucked in a junker? everything the Caretaker does arrives muffled
    audio.setHidden(me.hidden);

    const moved = Math.hypot(ex - this.lastEnemyX, ez - this.lastEnemyZ);
    this.lastEnemyX = ex;
    this.lastEnemyZ = ez;
    if (st.phase === "scavenge" || st.phase === "escape") {
      // distance-per-stride cadence: the slower it moves, the heavier the steps
      if (moved < 1.5) this.estepDist += moved; // skip teleport frames
      if (this.estepDist >= 1.9) {
        this.estepDist = 0;
        audio.playEventAt("estep", ex, ez, cam);
      }
      // loose metal on the swinging lantern, only while it is calm
      if (e.ai === 0 || e.ai === 1) {
        this.clinkTimer -= dt;
        if (this.clinkTimer <= 0) {
          this.clinkTimer = 2.5 + Math.random() * 4;
          audio.playEventAt("clink", ex, ez, cam);
        }
      } else {
        this.clinkTimer = 3 + Math.random() * 3;
      }
    }
  }

  private updateCamera(dt: number, t: number, st: RoomState | null): void {
    if (this.frozenCam) {
      const f = this.frozenCam;
      this.camera.position.set(f.x, f.y, f.z);
      this.camera.lookAt(f.tx, f.ty, f.tz);
      return;
    }
    const attract = this.attractMode && !st;
    const me = st?.players.get(this.net.sid);
    // Sprint FOV kick: ease toward a slightly wider view while sprinting, ease
    // back to base otherwise. Sits after the frozenCam return (photo mode is
    // never touched) and ahead of the early-return branches so the FOV always
    // settles even in the menu / spectate paths. The sprint flag is the
    // server's authority (stamina/weight gates already applied there). Attract
    // rests on a narrower cinematic lens; the same ease hands it back on join,
    // which reads as a subtle push-in when the shift starts.
    const sprinting = !!me && me.sprinting && !me.downed && !me.dead && me.seat === 0 && !me.hidden;
    const targetFov = attract ? ATTRACT_FOV : BASE_FOV + (sprinting ? SPRINT_FOV_KICK : 0);
    const nextFov = this.camera.fov + (targetFov - this.camera.fov) * (1 - Math.exp(-FOV_EASE_RATE * dt));
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    if (attract) {
      this.attractCamera(t);
      return;
    }

    if (!st || st.phase === "lobby" || st.phase === "briefing" || st.phase === "results" || !me) {
      // menu orbit over the lot (in-room lobby / briefing / results)
      const r = 26;
      const a = t * 0.08;
      this.camera.position.set(Math.sin(a) * r, 12 + Math.sin(t * 0.2) * 1.5, 10 + Math.cos(a) * r);
      this.camera.lookAt(0, 1, -4);
      return;
    }

    // Input reads live below the attract/lobby returns: at the title no
    // InputManager exists at all (see the input getter).
    let cx = this.predictor.body.x;
    let cz = this.predictor.body.z;
    let cy: number = PLAYER.EYE;
    let yaw = this.input.yaw;
    let pitch = this.input.pitch;

    if (me.dead) {
      // spectate: follow a living teammate
      const living = [...st.players.entries()].filter(([sid2, p]) => !p.dead && sid2 !== this.net.sid).map(([, p]) => p);
      let spectating = "";
      if (living.length) {
        this.spectateIdx %= living.length;
        const p = living[this.spectateIdx]!;
        spectating = p.nick;
        cx = p.x;
        cz = p.z;
        cy = PLAYER.EYE + 1.2;
      } else {
        cy = 18;
      }
      if (spectating !== this.store.state.spectating) this.store.set({ spectating });
      this.camera.position.set(cx, cy, cz);
      this.camera.rotation.set(0, 0, 0);
      this.camera.lookAt(cx + Math.sin(yaw) * 3, cy - 0.5, cz + Math.cos(yaw) * 3);
      return;
    }

    if (me.seat > 0) {
      // seated: camera rides the van
      const seat = VAN.SEATS[me.seat - 1]!;
      const v = st.van;
      const c = Math.cos(v.yaw);
      const s = Math.sin(v.yaw);
      cx = v.x + seat.x * c + seat.z * s;
      cz = v.z - seat.x * s + seat.z * c;
      cy = 1.42;
    } else {
      cy = PLAYER.EYE + this.predictor.body.y;
      if (this.settings.headBob && !me.downed) {
        // bob amplitude tracks the predicted speed so it fades in as you get
        // moving and dies out at rest (the seat/hidden overrides below still
        // win, and bobPhase itself only advances while walking)
        const v = Math.hypot(this.predictor.body.vx, this.predictor.body.vz);
        cy += Math.sin(this.bobPhase) * BOB_AMPLITUDE * clamp01(v / PLAYER.WALK);
      }
      if (me.downed) cy = 0.5;
      if (me.hidden) cy = 1.05; // hunched behind the windshield
    }

    this.camera.position.set(cx, cy, cz);
    // three.js cameras look along local -Z at yaw 0, but the game's forward
    // convention is (sin yaw, cos yaw) — offset by PI so the camera looks
    // where the character actually moves (W = toward what you see)
    this.camera.rotation.set(pitch, yaw + Math.PI, 0, "YXZ");

    // shake
    if (this.shakeAmount > 0.01 && this.settings.shake) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount * 0.2;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.2;
      this.camera.rotation.z += (Math.random() - 0.5) * this.shakeAmount * 0.03;
    }
  }

  /** Title cinematic: ease along ATTRACT_PATH. A pure function of wall-clock
   *  t, so stopping/respawning the loop (hidden tab, cancelled join) never
   *  makes the camera pop. */
  private attractCamera(t: number): void {
    let u = ((t % ATTRACT_LOOP_LEN) + ATTRACT_LOOP_LEN) % ATTRACT_LOOP_LEN;
    let i = 0;
    while (u >= ATTRACT_PATH[i]!.dur) {
      u -= ATTRACT_PATH[i]!.dur;
      i = (i + 1) % ATTRACT_PATH.length;
    }
    const a = ATTRACT_PATH[i]!;
    const b = ATTRACT_PATH[(i + 1) % ATTRACT_PATH.length]!;
    const s = u / a.dur;
    const e = s * s * (3 - 2 * s); // smoothstep: rests at every landmark
    const mix = (p: readonly [number, number, number], q: readonly [number, number, number], k: 0 | 1 | 2) =>
      p[k] + (q[k] - p[k]) * e;
    this.camera.position.set(mix(a.pos, b.pos, 0), mix(a.pos, b.pos, 1), mix(a.pos, b.pos, 2));
    this.camera.lookAt(mix(a.look, b.look, 0), mix(a.look, b.look, 1), mix(a.look, b.look, 2));
  }

  private updateMarkers(dt: number): void {
    const now = performance.now();
    for (let i = this.markers3d.length - 1; i >= 0; i--) {
      const m = this.markers3d[i]!;
      if (now > m.until) {
        this.scene.remove(m.mesh);
        this.markers3d.splice(i, 1);
      } else {
        const ring = m.mesh.children[1] as THREE.Mesh;
        const s = 1 + 0.3 * Math.sin(now / 120);
        ring.scale.setScalar(s);
      }
    }
    for (const [sid, b] of this.bubbleSprites) {
      if (now > b.until) {
        b.sprite.parent?.remove(b.sprite);
        this.bubbleSprites.delete(sid);
      }
    }
    void dt;
  }

  cycleSpectate(): void {
    this.spectateIdx++;
  }

  private pushHud(st: RoomState): void {
    const me = st.players.get(this.net.sid);
    if (!me) return;
    const carried = me.carrying ? st.items.get(me.carrying) : undefined;
    const def = carried ? ITEM_DEFS[carried.defId] : undefined;
    const timer = Math.max(0, st.endsAt - st.now);
    const teammates = [...st.players.entries()]
      .filter(([sid2]) => sid2 !== this.net.sid)
      .map(([sid2, p]) => ({
        sid: sid2,
        nick: p.nick,
        color: p.color,
        hp: p.hp,
        downed: p.downed,
        dead: p.dead,
        seat: p.seat,
        connected: p.connected,
        dist: Math.round(dist2d(me.x, me.z, p.x, p.z)),
      }));
    this.store.set({
      phase: st.phase,
      outcome: st.outcome,
      resultsJson: st.resultsJson,
      timer,
      quota: st.quota,
      salvage: st.salvage,
      hp: me.hp,
      stamina: me.stamina,
      downed: me.downed,
      dead: me.dead,
      bleedLeft: me.bleedAt ? Math.max(0, me.bleedAt - st.now) : 0,
      carrying: me.carrying,
      carryingName: def?.name ?? "",
      carryingWeight: def?.weight ?? 0,
      twoHandle: def?.twoHandle ?? false,
      prompt: this.target?.label ?? "",
      teammates,
      ping: this.net.ping,
      modifiers: [...st.modifiers],
      escalation: st.escalation,
      gateOpen: st.gateOpen,
      partInstalled: st.van.partInstalled,
      vanDoorsOpen: st.van.doorsOpen,
      strapped: st.van.strapped,
      enemyAi: st.enemy.ai,
      enemyDist: Math.round(dist2d(me.x, me.z, st.enemy.x, st.enemy.z)),
      seat: me.seat,
      driving: me.seat === 1,
      vanSpeed: Math.abs(st.van.speed),
      locked: this.input.locked,
      fps: this.fpsN > 0 ? Math.round(this.fpsN / Math.max(0.001, this.fpsAcc)) : 0,
      leaveWarn: this.store.state.leaveWarn,
    });
    if (this.fpsN > 5) {
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    // phase change side effects
    if (st.phase !== this.lastPhase) {
      if (st.phase === "scavenge") this.store.toast("Shift started. Find valuables, find the distributor, don't die.", "info");
      if (st.phase === "escape") this.store.toast("Everyone in the van! DRIVE.", "good");
      this.lastPhase = st.phase;
    }
    // STORM CELL: atmosphere exists only mid-mission — rain and lightning are
    // silent in the lobby and die at results. Modifiers only change at mission
    // start, so the phase gate is enough; read fresh every push anyway so a
    // reconnect into a running storm wires up too.
    const stormOn = (st.phase === "scavenge" || st.phase === "escape") && [...st.modifiers].includes("storm");
    if (stormOn !== this.stormOn) {
      this.stormOn = stormOn;
      this.world3d.setStorm(stormOn);
      audio.setRain(stormOn);
      this.world3d.onFlash = stormOn ? () => audio.thunder() : null;
    }
    if (me.seat !== this.wasSeated) {
      this.wasSeated = me.seat;
      audio.engineLoop();
    }
    if (this.store.state.leaveWarn > 0 && st.phase !== "escape") {
      this.store.set({ leaveWarn: 0 });
    }
  }
}
