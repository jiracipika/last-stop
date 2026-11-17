// Tiny external store bridging the engine/net world into React HUD updates.
export interface Toast {
  id: number;
  msg: string;
  kind: "info" | "warn" | "good";
  at: number;
}

export interface HudState {
  phase: string;
  outcome: string;
  resultsJson: string;
  timer: number; // seconds left (mission), 0 = n/a
  quota: number;
  salvage: number;
  hp: number;
  stamina: number;
  downed: boolean;
  dead: boolean;
  bleedLeft: number;
  carrying: string;
  carryingName: string;
  carryingWeight: number;
  twoHandle: boolean;
  /** body inventory: 3 slots of stowed small loot ({ id: "" } = empty) */
  slots: { id: string; name: string; value: number }[];
  slotSel: number;
  caffeinated: boolean;
  budget: number;
  hasFlashlight: boolean;
  prompt: string;
  progress: number; // 0..1 hold-interact bar
  progressKind: string;
  teammates: { sid: string; nick: string; color: number; hp: number; downed: boolean; dead: boolean; dist: number; seat: number; connected: boolean }[];
  ping: number;
  connStatus: string;
  connDetail: string;
  modifiers: string[];
  escalation: number;
  gateOpen: boolean;
  partInstalled: boolean;
  vanDoorsOpen: boolean;
  strapped: boolean;
  enemyAi: number;
  enemyDist: number;
  seat: number;
  driving: boolean;
  vanSpeed: number;
  cartSpeed: number;
  cartTaken: boolean;
  toasts: Toast[];
  damageFlash: number;
  /** Signed SCREEN angle to the last damage source (rad, wrapped to
   *  (-PI, PI]): positive = source to the right = clockwise CSS rotation.
   *  -(atan2(dx, dz) - yaw); null = no recent source. */
  dmgDir: number | null;
  leaveWarn: number; // count of teammates left behind, 0 = none
  spectating: string;
  fps: number;
  locked: boolean;
  roomCode: string;
  /** accessibility caption: last critical audio cue, shown while fresh */
  caption: { text: string; at: number } | null;
  /** floating "+$X" labels (screen-space px, projected by the engine) */
  floaters: { id: number; text: string; x: number; y: number }[];
}

export const initialHud: HudState = {
  phase: "lobby",
  outcome: "",
  resultsJson: "",
  timer: 0,
  quota: 0,
  salvage: 0,
  hp: 100,
  stamina: 100,
  downed: false,
  dead: false,
  bleedLeft: 0,
  carrying: "",
  carryingName: "",
  carryingWeight: 0,
  twoHandle: false,
  slots: [],
  slotSel: 0,
  caffeinated: false,
  budget: 10,
  hasFlashlight: false,
  prompt: "",
  progress: 0,
  progressKind: "",
  teammates: [],
  ping: 0,
  connStatus: "idle",
  connDetail: "",
  modifiers: [],
  escalation: 1,
  gateOpen: false,
  partInstalled: false,
  vanDoorsOpen: false,
  strapped: false,
  enemyAi: 0,
  enemyDist: 999,
  seat: 0,
  driving: false,
  vanSpeed: 0,
  cartSpeed: 0,
  cartTaken: false,
  toasts: [],
  damageFlash: 0,
  dmgDir: null,
  leaveWarn: 0,
  spectating: "",
  fps: 60,
  locked: false,
  roomCode: "",
  caption: null,
  floaters: [],
};

export class HudStore {
  state: HudState = { ...initialHud };
  private listeners = new Set<() => void>();
  private toastId = 1;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HudState => this.state;

  set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  toast(msg: string, kind: Toast["kind"] = "info"): void {
    const t: Toast = { id: this.toastId++, msg, kind, at: performance.now() };
    this.set({ toasts: [...this.state.toasts, t].slice(-5) });
  }

  /** Accessibility caption slot — one line, replaced per cue, HUD fades it. */
  caption(text: string): void {
    this.set({ caption: { text, at: performance.now() } });
  }

  /** Engine-owned floater list; the engine only calls this on real changes. */
  setFloaters(list: { id: number; text: string; x: number; y: number }[]): void {
    this.set({ floaters: list });
  }

  pruneToasts(): void {
    const now = performance.now();
    if (this.state.toasts.some((t) => now - t.at > 4200)) {
      this.set({ toasts: this.state.toasts.filter((t) => now - t.at <= 4200) });
    }
  }
}
