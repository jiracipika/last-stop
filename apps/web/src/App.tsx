// App shell: title screen -> room -> mission. Owns Net/HudStore/Engine
// lifecycles; React reads HUD via useSyncExternalStore.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { Net, serverUrlFromEnv } from "./net.js";
import { HudStore, initialHud } from "./game/store.js";
import { Engine } from "./game/engine.js";
import { audio } from "./game/audio.js";
import { TitleScreen } from "./ui/Title.js";
import { LobbyOverlay } from "./ui/Lobby.js";
import { Hud } from "./ui/Hud.js";
import { ResultsOverlay } from "./ui/Results.js";
import { PauseOverlay } from "./ui/Pause.js";
import { COLORS } from "@last-stop/shared";

export interface Prefs {
  nick: string;
  color: number;
  quality: "low" | "medium" | "high";
  headBob: boolean;
  shake: boolean;
  sensitivity: number;
  volume: number;
}

const DEFAULT_PREFS: Prefs = {
  nick: "",
  color: 0,
  quality: "medium",
  headBob: true,
  shake: true,
  sensitivity: 1,
  volume: 0.8,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("laststop.prefs");
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export function App(): React.ReactElement {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [screen, setScreen] = useState<"title" | "game">("title");
  const [fatal, setFatal] = useState("");
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const net = useMemo(() => new Net(serverUrlFromEnv()), []);
  const store = useMemo(() => new HudStore(), []);

  const hud = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initialHud);

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
    localStorage.setItem("laststop.prefs", JSON.stringify(p));
  }, []);

  useEffect(() => {
    audio.setVolume(prefs.volume);
  }, [prefs.volume]);

  // engine lifecycle
  useEffect(() => {
    if (screen !== "game" || !canvasRef.current) return;
    try {
      const engine = new Engine(canvasRef.current, net, store, {
        quality: prefs.quality,
        headBob: prefs.headBob,
        shake: prefs.shake,
        sensitivity: prefs.sensitivity,
      });
      engineRef.current = engine;
      engine.start();
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (e) {
      setFatal(`Could not start the 3D renderer: ${String(e)}. Try updating your browser or enabling hardware acceleration.`);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // pause when pointer lock is lost mid-mission
  useEffect(() => {
    const onLockChange = () => {
      const locked = document.pointerLockElement !== null;
      const phase = net.state?.phase ?? "lobby";
      if (!locked && (phase === "scavenge" || phase === "escape" || phase === "briefing")) {
        setPaused(true);
      }
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [net]);

  // clicks on canvas re-lock (unless overlays open)
  const onCanvasClick = useCallback(() => {
    const phase = net.state?.phase ?? "lobby";
    if (paused || phase === "lobby" || phase === "results") return;
    engineRef.current?.input.requestLock();
  }, [net, paused]);

  const enterRoom = useCallback(
    async (mode: "create" | "join", code: string) => {
      audio.unlock();
      try {
        if (mode === "create") {
          const roomCode = await net.createRoom(prefs.nick || "Rookie", prefs.color);
          store.set({ roomCode });
          store.toast(`Room ${roomCode} created — share the code`, "good");
        } else {
          await net.joinRoom(code, prefs.nick || "Rookie", prefs.color);
          store.set({ roomCode: code.toUpperCase() });
        }
        setScreen("game");
        setPaused(false);
      } catch (e) {
        store.toast(`Could not join: ${String(e)}`, "warn");
      }
    },
    [net, prefs.nick, prefs.color, store],
  );

  const leaveRoom = useCallback(() => {
    net.leave();
    setScreen("title");
    setPaused(false);
  }, [net]);

  const resume = useCallback(() => {
    setPaused(false);
    engineRef.current?.input.requestLock();
  }, []);

  const mobile = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && innerWidth < 1024;

  return (
    <div className="app">
      {screen === "game" && <canvas ref={canvasRef} className="game-canvas" onClick={onCanvasClick} />}
      {fatal ? (
        <div className="fatal">
          <h2>LAST STOP can't start here</h2>
          <p>{fatal}</p>
        </div>
      ) : screen === "title" ? (
        <TitleScreen prefs={prefs} savePrefs={savePrefs} onEnter={enterRoom} />
      ) : (
        <>
          {hud.phase === "lobby" && <LobbyOverlay net={net} hud={hud} prefs={prefs} onLeave={leaveRoom} />}
          {hud.phase === "briefing" && <Briefing hud={hud} />}
          {(hud.phase === "scavenge" || hud.phase === "escape") && (
            <Hud hud={hud} paused={paused} onSpectateNext={() => engineRef.current?.cycleSpectate()} />
          )}
          {hud.phase === "results" && <ResultsOverlay hud={hud} net={net} />}
          {paused && hud.phase !== "lobby" && hud.phase !== "results" && (
            <PauseOverlay prefs={prefs} savePrefs={savePrefs} onResume={resume} onLeave={leaveRoom} engine={engineRef.current} />
          )}
          {!hud.locked && !paused && (hud.phase === "scavenge" || hud.phase === "escape" || hud.phase === "briefing") && (
            <div className="click-catch" onClick={onCanvasClick}>
              <span>Click to grab the wheel — mouse look needs focus</span>
            </div>
          )}
        </>
      )}
      <div className="toasts">
        {hud.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
      {mobile && (
        <div className="mobile-notice">
          LAST STOP needs a desktop keyboard &amp; mouse. Come back on a laptop or PC — the night shift isn't touch-friendly.
        </div>
      )}
    </div>
  );
}

function Briefing({ hud }: { hud: typeof initialHud }): React.ReactElement {
  return (
    <div className="briefing">
      <h1>PALE LANTERN MOTEL — SHIFT BRIEFING</h1>
      <ul>
        {hud.modifiers.map((m) => (
          <li key={m}>{MOD_LABELS[m] ?? m}</li>
        ))}
      </ul>
      <p>Quota: ${hud.quota} of salvage. Find the distributor cap. Doors bang. Keep quiet.</p>
    </div>
  );
}

const MOD_LABELS: Record<string, string> = {
  blackout: "BLACKOUT — lights are dead, bring your flashlight (F)",
  fragile: "EGGSHELL CONTRACT — fragile cargo takes double damage",
  sensitive: "LIGHT SLEEPER — The Caretaker hears everything",
  shortclock: "SHORT SHIFT — 90 seconds less tonight",
  bells: "CURSED BELLS — all cargo rattles while carried",
};

export { COLORS };
