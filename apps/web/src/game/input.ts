// Keyboard/mouse state -> movement input + discrete actions.
import { PLAYER } from "@last-stop/shared";

export interface FrameInput {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  jump: boolean;
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
  | "horn"
  | "pause";

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
  private el: HTMLElement;
  private disposers: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
        case "Escape": this.onAction("pause"); break;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mm = (e: MouseEvent) => {
      if (!this.locked) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
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
      if (!this.locked) this.keys.clear();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    this.el.addEventListener("contextmenu", ctx);
    document.addEventListener("pointerlockchange", plc);
    this.disposers.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      this.el.removeEventListener("contextmenu", ctx);
      document.removeEventListener("pointerlockchange", plc);
    });
  }

  requestLock(): void {
    void this.el.requestPointerLock()?.catch?.(() => {});
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
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
      interact: k.has("KeyE"),
      stabilize: this.mouseRight,
    };
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
  }
}

export const INTERACT_HINT_RANGE = PLAYER.INTERACT_RANGE;
