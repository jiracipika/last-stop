// Colyseus client wrapper: create/join by code, reconnection, input,
// event fan-out. UI never touches the SDK directly.
import { Client, MatchMakeError, type Room } from "@colyseus/sdk";
import { RoomState } from "@last-stop/shared";

export type Ev = { t: string; [k: string]: unknown };

export type ConnStatus = "idle" | "connecting" | "connected" | "error" | "reconnecting";

/** The page's Net instance (App builds one; set once a room actually joins).
 *  The HUD reads live room state through this instead of importing the
 *  engine or its predictor. */
export let activeNet: Net | null = null;

export class Net {
  client: Client;
  room: Room<RoomState> | null = null;
  status: ConnStatus = "idle";
  statusDetail = "";
  /** Last round-trip in ms; -1 = unknown (no pong yet, or disconnected). */
  rttMs = -1;
  evListeners = new Set<(e: Ev) => void>();
  statusListeners = new Set<() => void>();
  private pingTimer: number | null = null;
  private pingSentAt = 0;
  private reconnectionToken = "";
  private connectionGeneration = 0;

  constructor(url: string) {
    this.client = new Client(url, {
      fetchFn: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12_000) }),
    });
  }

  private setStatus(s: ConnStatus, detail = ""): void {
    this.status = s;
    this.statusDetail = detail;
    this.statusListeners.forEach((fn) => fn());
  }

  onEvent(fn: (e: Ev) => void): () => void {
    this.evListeners.add(fn);
    return () => this.evListeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emit(e: Ev): void {
    this.evListeners.forEach((fn) => fn(e));
  }

  get state(): RoomState | null {
    const state = this.room?.state;
    // The SDK resolves joining before its first full state can arrive. Rendering
    // that empty schema can throw on van/enemy and permanently stop the frame loop.
    return state?.van && state.enemy && state.players?.has(this.sid) ? state : null;
  }

  get sid(): string {
    return this.room?.sessionId ?? "";
  }

  static code(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const buf = new Uint8Array(5);
    crypto.getRandomValues(buf);
    let code = "";
    for (let i = 0; i < 5; i++) code += alphabet[buf[i]! % alphabet.length];
    return code;
  }

  async createRoom(nick: string, color: number, hat = 0): Promise<string> {
    this.setStatus("connecting");
    // retry with a fresh code on a collision
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = Net.code();
      try {
        this.room = (await this.client.create("game", { nick, color, hat, code }, RoomState)) as unknown as Room<RoomState>;
        this.afterConnect();
        return code;
      } catch (e) {
        const msg = String(e);
        if (attempt < 2 && /room code .* already exists/i.test(msg)) continue;
        this.setStatus("error", msg);
        throw e;
      }
    }
    throw new Error("could not create room");
  }

  async joinRoom(code: string, nick: string, color: number, hat = 0): Promise<void> {
    this.setStatus("connecting");
    try {
      this.room = (await this.client.joinById(`LS${code.toUpperCase()}`, { nick, color, hat }, RoomState)) as unknown as Room<RoomState>;
      this.afterConnect();
    } catch (e) {
      this.setStatus("error", String(e));
      throw e;
    }
  }

  private afterConnect(): void {
    const room = this.room!;
    this.reconnectionToken = room.reconnectionToken ?? "";
    // We own reconnection (tryReconnect below). If the SDK's built-in
    // auto-reconnect also fires, the two flows race to consume the
    // reconnection token and this.room can end up pointing at a fresh room
    // whose state hasn't synced yet — visible as a brief empty players map.
    try {
      room.reconnection.enabled = false;
    } catch {
      /* older SDK: no toggle, our flow still works */
    }
    this.setStatus("connected");
    activeNet = this;
    room.onMessage("ev", (msg: unknown) => {
      if (this.room !== room) return;
      const e = msg as Ev;
      // Latency probe echo: the room answers "ping" with ev { t: "pong",
      // c: <the number we sent> }. Only an exact match counts, so a stale
      // pong can never pass for a fresh one.
      if (e.t === "pong" && typeof e.c === "number" && this.pingSentAt > 0 && e.c === this.pingSentAt) {
        this.rttMs = Math.round(performance.now() - this.pingSentAt);
        this.pingSentAt = 0;
      }
      this.emit(e);
    });
    room.onError((code, message) => {
      this.emit({ t: "roomError", code, msg: message });
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      if (this.pingTimer !== null) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.rttMs = -1; // unknown until the next probe lands
      this.pingSentAt = 0;
      if (code === 1000 || code === 1001) {
        this.setStatus("idle");
        return;
      }
      this.tryReconnect();
    });
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), 5000) as unknown as number;
  }

  /** One latency probe; the echo updates rttMs in the ev handler above. */
  private sendPing(): void {
    if (!this.room || this.status !== "connected") return;
    this.pingSentAt = performance.now();
    this.room.send("ping", this.pingSentAt);
  }

  private async tryReconnect(): Promise<void> {
    const generation = this.connectionGeneration;
    const token = this.reconnectionToken;
    this.setStatus("reconnecting");
    if (!token) {
      this.setStatus("error", "connection lost");
      return;
    }
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500 + i * 1000));
      if (generation !== this.connectionGeneration) return;
      try {
        const room = await this.client.reconnect(token, RoomState) as unknown as Room<RoomState>;
        if (generation !== this.connectionGeneration) {
          void room.leave(true);
          return;
        }
        this.room = room;
        this.afterConnect();
        return;
      } catch {
        if (generation !== this.connectionGeneration) return;
      }
    }
    this.setStatus("error", "reconnection failed");
  }

  /** Send one input snapshot immediately. There is deliberately NO queue
   *  here anymore: the old 50 ms interval pump overwrote snapshots written
   *  between fires (dropping inputs and their seqs — lost jumps). The engine
   *  calls this on its own 20 Hz cadence. */
  sendInput(input: Record<string, unknown>): void {
    if (this.status === "connected") this.room?.send("in", input);
  }

  act(k: string, extra: Record<string, unknown> = {}): void {
    if (this.status === "connected") this.room?.send("act", { k, ...extra });
  }

  leave(): void {
    this.connectionGeneration++;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.rttMs = -1;
    this.pingSentAt = 0;
    this.reconnectionToken = "";
    const room = this.room;
    this.room = null;
    if (activeNet === this) activeNet = null;
    void room?.leave(true);
    this.setStatus("idle");
  }
}

export function serverUrlFromEnv(): string {
  const fromEnv = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return "ws://localhost:2567";
  if (/^laststop(game|staging|beta)(?:-[a-z0-9-]+)?\.vercel\.app$/.test(location.hostname)) {
    return "wss://rs-server.tail617f4d.ts.net";
  }
  return location.origin;
}

export function matchmakingMessage(error: unknown, mode: "create" | "join"): string {
  const message = error instanceof Error ? error.message : "";
  const code = error instanceof MatchMakeError ? error.code : undefined;
  if (mode === "join" && /room .* is locked|room is full|seat reservation failed/i.test(message)) {
    return "That crew room is full or closed. Ask the host for a fresh invite.";
  }
  if (mode === "join" && /room .* (?:not found|has been disposed)/i.test(message)) {
    return "Room not found. Check the code or ask the host for a new one.";
  }
  if (/server is at capacity/i.test(message)) {
    return "All crew rooms are in use. Try again in a few minutes.";
  }
  if (!code || code < 400 || code >= 500 || code === 404) {
    return "Could not connect to the game server. Try again in a moment.";
  }
  return mode === "create" ? "Could not start a new shift. Try again." : "Could not join that crew room. Try again.";
}
