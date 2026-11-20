// Keyboard/mouse state -> movement input + discrete actions.
import { PLAYER } from "@last-stop/shared";

export interface FrameInput {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  jump: boolean;
  brake: boolean;
  interact: boolean;
  stabilize: boolean;
}

export type ActionKind =
  | "grabRelease"
  | "throwItem"
  | "flashlight"
  | "ping"
  | "quick0"
  | "quick1"
  | "quick2"
  | "slot0"
  | "slot1"
  | "slot2"
  | "interactTap"
  | "exitVan"
  | "horn";

export class InputManager {
  yaw = Math.PI;
  pitch = 0;
  keys = new Set<string>();
  mouseLeft = false;
  mouseRight = false;
  jumpQueued = false;
  sensitivity = 1;
  locked = false;
  onAction: (a: ActionKind) => void = () => {};
  onClear: () => void = () => {};
  /** Fired once the browser refuses pointer lock (headless, sandboxed
   *  iframe, kiosk policy): mouse look is unavailable, keys still work. */
  onLockDenied: () => void = () => {};
  lockDenied = false;
  private el: HTMLElement;
  private firstLockedMotion = false;
  private cursorX = 0;
  private cursorY = 0;
  private disposers: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    // Keyboard input works whenever the PAGE has focus (keydown only fires
    // then) — pointer lock is required for mouse look, not for keys. Requiring
    // the lock here made the game unplayable wherever the browser denies it
    // (headless e2e, sandboxed iframes, kiosks): every key died while the
    // "click to grab the wheel" overlay sat there forever. Typing in overlay
    // fields (nickname, room code) and browser modifiers still pass through.
    const editing = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      );
    };
    const kd = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || editing(e.target)) return;
      const code = e.code;
      this.keys.add(code);
      switch (code) {
        case "KeyF": this.onAction("flashlight"); break;
        case "KeyQ": this.onAction("ping"); break;
        // 1/2/3 select inventory slots; quick chat moved to Z/X/C
        case "Digit1": this.onAction("slot0"); break;
        case "Digit2": this.onAction("slot1"); break;
        case "Digit3": this.onAction("slot2"); break;
        case "KeyZ": this.onAction("quick0"); break;
        case "KeyX": this.onAction("quick1"); break;
        case "KeyC": this.onAction("quick2"); break;
        case "KeyE": this.onAction("interactTap"); break;
        case "KeyG": this.onAction("throwItem"); break;
        case "KeyH": this.onAction("horn"); break;
        case "Space": this.jumpQueued = true; e.preventDefault(); break;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mm = (e: MouseEvent) => {
      if (!this.locked) {
        this.cursorX = e.clientX;
        this.cursorY = e.clientY;
        return;
      }
      const { movementX, movementY } = e;
      if (!movementX && !movementY) return;
      if (this.firstLockedMotion) {
        this.firstLockedMotion = false;
        // Chromium can deliver a delayed reset-to-origin delta after taking
        // pointer lock. Match the delta to the last unlocked cursor position.
        const reset = Math.abs(movementX + this.cursorX) <= 2 && Math.abs(movementY + this.cursorY) <= 2;
        if (reset) return;
      }
      const s = 0.0022 * this.sensitivity;
      this.yaw -= movementX * s;
      this.pitch -= movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    const md = (e: MouseEvent) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouseLeft = true;
        this.onAction("grabRelease");
      }
      if (e.button === 2) this.mouseRight = true;
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    };
    const ctx = (e: Event) => e.preventDefault();
    const plc = () => {
      this.locked = document.pointerLockElement === this.el;
      this.firstLockedMotion = this.locked;
      if (!this.locked) this.clear();
    };
    const blur = () => this.clear();
    const visibility = () => { if (document.hidden) this.clear(); };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    this.el.addEventListener("contextmenu", ctx);
    document.addEventListener("pointerlockchange", plc);
    this.disposers.push(() => {
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      this.el.removeEventListener("contextmenu", ctx);
      document.removeEventListener("pointerlockchange", plc);
    });
  }

  clear(): void {
    this.keys.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
    this.jumpQueued = false;
    this.onClear();
  }

  requestLock(): void {
    try {
      const r = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") {
        r.catch(() => {
          if (!this.lockDenied && document.pointerLockElement !== this.el) {
            this.lockDenied = true;
            this.onLockDenied();
          }
        });
      }
    } catch {
      /* legacy browsers: lock change events carry the state */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  frame(): FrameInput {
    const k = this.keys;
    const mz = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const mx = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    // jump is a LATCH until the engine sends it: consuming it here (every
    // rendered frame) while input ships at 20 Hz silently ate most presses —
    // the local prediction jumped, the server never did, reconcile snapped
    // you back down. The engine clears jumpQueued once a packet carries it.
    return {
      mx,
      mz,
      yaw: this.yaw,
      pitch: this.pitch,
      sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
      jump: this.jumpQueued,
      brake: k.has("Space"),
      interact: k.has("KeyE"),
      stabilize: this.mouseRight,
    };
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
  }
}

export const INTERACT_HINT_RANGE = PLAYER.INTERACT_RANGE;
