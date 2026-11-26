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
import { setPaletteMode } from "./game/palette.js";

export interface Prefs {
  nick: string;
  color: number;
  hat: number;
  quality: "low" | "medium" | "high";
  headBob: boolean;
  shake: boolean;
  sensitivity: number;
  volume: number;
  captions: boolean;
  reduceFlash: boolean;
  colorblind: boolean;
}

const DEFAULT_PREFS: Prefs = {
  nick: "",
  color: 0,
  hat: 0,
  quality: "high", // full-fat look by default; players who saved a tier keep it
  headBob: true,
  shake: true,
  sensitivity: 1,
  volume: 0.8,
  captions: false,
  reduceFlash: false,
  colorblind: false,
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
  // true once the attract renderer is live: lets CSS trade the opaque title
  // backdrop for a translucent grade over the 3D lot
  const [attractLive, setAttractLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const net = useMemo(() => new Net(serverUrlFromEnv()), []);
  const store = useMemo(() => new HudStore(), []);

  const hud = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initialHud);

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
    try { localStorage.setItem("laststop.prefs", JSON.stringify(p)); } catch { /* session preference only */ }
  }, []);

  useEffect(() => {
    audio.setVolume(prefs.volume);
  }, [prefs.volume]);

  // Accessibility switches apply live (pause-menu toggles mid-shift included):
  // the palette remap is a module-level flag every render site resolves
  // through, and the engine reads captions/reduce-flash from its settings.
  useEffect(() => {
    setPaletteMode(prefs.colorblind);
    engineRef.current?.setSettings({
      quality: prefs.quality,
      headBob: prefs.headBob,
      shake: prefs.shake,
      sensitivity: prefs.sensitivity,
      captions: prefs.captions,
      reduceFlash: prefs.reduceFlash,
    });
  }, [prefs.colorblind, prefs.captions, prefs.reduceFlash, prefs.quality, prefs.headBob, prefs.shake, prefs.sensitivity]);

  // Engine lifecycle. The engine boots ONCE — at the title, in ATTRACT MODE —
  // and the same canvas / WebGL context / World3D instance then serves the
  // whole session (title cinematic -> lobby -> mission). Rebuilding on join
  // would re-bake the entire world on the join frame for zero benefit; the
  // engine already renders fine without room state, so the live instance is
  // reused and only the camera changes owner (Engine.setAttract).
  useEffect(() => {
    if (engineRef.current || !canvasRef.current) return;
    try {
      const engine = new Engine(canvasRef.current, net, store, {
        quality: prefs.quality,
        headBob: prefs.headBob,
        shake: prefs.shake,
        sensitivity: prefs.sensitivity,
        captions: prefs.captions,
        reduceFlash: prefs.reduceFlash,
      });
      engineRef.current = engine;
      // a thrown attract frame drops the title back to its static backdrop
      engine.onAttractFail = () => setAttractLive(false);
      engine.start(); // boots into attract mode (Engine default)
      setAttractLive(true);
    } catch (e) {
      // Attract is pure dressing: a broken menu must never block joining, so
      // this is only a console warn and the CSS backdrop stays as-is.
      console.warn("[laststop] attract mode unavailable; title keeps the static backdrop", e);
    }
    // Deliberately no teardown: this engine is a page-lifetime singleton
    // shared by title and game (canvasRef persists across screen switches),
    // so there is nothing to dispose on a screen change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, store]);

  // Game-time fallback: if the attract boot failed, retry once the player
  // actually joins — past this point a missing renderer IS fatal.
  useEffect(() => {
    if (screen !== "game" || engineRef.current || !canvasRef.current) return;
    try {
      const engine = new Engine(canvasRef.current, net, store, {
        quality: prefs.quality,
        headBob: prefs.headBob,
        shake: prefs.shake,
        sensitivity: prefs.sensitivity,
        captions: prefs.captions,
        reduceFlash: prefs.reduceFlash,
      });
      engineRef.current = engine;
      engine.setAttract(false);
      engine.start();
    } catch (e) {
      setFatal(`Could not start the 3D renderer: ${String(e)}. Try updating your browser or enabling hardware acceleration.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // pause when pointer lock is lost mid-mission
  useEffect(() => {
    const onLockChange = () => {
      const locked = document.pointerLockElement === canvasRef.current;
      const phase = net.state?.phase ?? "lobby";
      if (!locked && (phase === "scavenge" || phase === "escape" || phase === "briefing" || phase === "arrive")) {
        setPaused(true);
      }
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [net]);

  useEffect(() => {
    if (hud.phase !== "lobby" && hud.phase !== "results") return;
    setPaused(false);
    if (canvasRef.current && document.pointerLockElement === canvasRef.current) document.exitPointerLock();
  }, [hud.phase]);

  // clicks on canvas re-lock (unless overlays open)
  const onCanvasClick = useCallback(() => {
    const phase = net.state?.phase ?? "lobby";
    if (paused || phase === "lobby" || phase === "results") return;
    engineRef.current?.input.requestLock();
  }, [net, paused]);

  const enterRoom = useCallback(
    async (mode: "create" | "join", code: string) => {
      audio.unlock();
      const engine = engineRef.current;
      engine?.setAttract(false); // hand the camera over; input listeners attach
      engine?.stop(); // attract rendering halts the moment a join starts
      try {
        if (mode === "create") {
          const roomCode = await net.createRoom(prefs.nick || "Rookie", prefs.color, prefs.hat);
          store.set({ roomCode });
          store.toast(`Room ${roomCode} created — share the code`, "good");
        } else {
          await net.joinRoom(code, prefs.nick || "Rookie", prefs.color, prefs.hat);
          store.set({ roomCode: code.toUpperCase() });
        }
        setScreen("game");
        setPaused(false);
        engine?.start(); // the same loop resumes as the game loop
      } catch (e) {
        engine?.setAttract(true); // join failed: settle back into the cinematic
        throw e;
      }
    },
    [net, prefs.nick, prefs.color, prefs.hat, store],
  );

  const leaveRoom = useCallback(() => {
    net.leave();
    setScreen("title");
    setPaused(false);
    engineRef.current?.setAttract(true); // the cinematic resumes over the live lot
  }, [net]);

  const resume = useCallback(() => {
    setPaused(false);
    engineRef.current?.input.requestLock();
  }, []);

  const mobile = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && innerWidth < 1024;

  // Debug/test hook (dev builds only): lets Playwright reach the live Net and
  // Engine instances without exposing anything in production bundles.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window, {
      __laststop: {
        net,
        engine: () => engineRef.current,
        store,
      },
    });
  }, [net, store]);

  return (
    <div className={attractLive ? "app attract-live" : "app"}>
      {/* always mounted: the attract camera renders it behind the title panel,
          then the game engine keeps using the same canvas after joining */}
      <canvas ref={canvasRef} className="game-canvas" onClick={onCanvasClick} />
      {fatal ? (
        <div className="fatal">
          <h2>LAST STOP can't start here</h2>
          <p>{fatal}</p>
        </div>
      ) : mobile ? (
        // Touch-only devices cannot play: one honest screen, not a sign-in
        // form under a notice saying the form is useless.
        <div className="desktop-only">
          <div className="desktop-only-card">
            <h1 className="game-title">LAST<span>STOP</span></h1>
            <p>
              The night shift runs on a laptop or PC with a keyboard and mouse.
              {new URLSearchParams(location.search).get("code") || new URLSearchParams(location.search).get("room")
                ? " Your crew is already waiting — open the invite link there."
                : " Open this page on one and clock in."}
            </p>
            <p className="desktop-only-meta">1–4 players online · headphones recommended</p>
          </div>
        </div>
      ) : screen === "title" ? (
        <TitleScreen prefs={prefs} savePrefs={savePrefs} onEnter={enterRoom} />
      ) : (
        <>
          {hud.phase === "lobby" && <LobbyOverlay net={net} hud={hud} prefs={prefs} savePrefs={savePrefs} onLeave={leaveRoom} />}
          {hud.phase === "briefing" && <Briefing hud={hud} />}
          {(hud.phase === "scavenge" || hud.phase === "escape" || hud.phase === "arrive") && (
            <Hud
              hud={hud}
              paused={paused}
              reduceFlash={prefs.reduceFlash}
              onSpectateNext={() => engineRef.current?.cycleSpectate()}
            />
          )}
          {hud.phase === "results" && <ResultsOverlay hud={hud} net={net} />}
          {paused && hud.phase !== "lobby" && hud.phase !== "results" && (
            <PauseOverlay prefs={prefs} savePrefs={savePrefs} onResume={resume} onLeave={leaveRoom} engine={engineRef.current} />
          )}
          {!hud.locked && !paused && (hud.phase === "scavenge" || hud.phase === "escape" || hud.phase === "briefing" || hud.phase === "arrive") && (
            <button className="click-catch" onClick={onCanvasClick}>
              <span>Click to take control</span>
            </button>
          )}
        </>
      )}
      <div className="toasts">
        {hud.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// Night-shift briefing sheet: the same receipt voice as the results screen's
// shift report, printed over the live lot. Root keeps className "briefing" —
// e2e phaseOf() keys the briefing phase off it.
function Briefing({ hud }: { hud: typeof initialHud }): React.ReactElement {
  return (
    <div className="briefing">
      <div className="briefing-sheet">
        <div className="report-head">
          <span className="report-brand">DUSTPAN RECOVERY CO.</span>
          <span className="report-motto">WE TOW REGRETS</span>
        </div>
        <h1>PALE LANTERN MOTEL — SHIFT BRIEFING</h1>
        <div className="briefing-meta">FORM 2AM-A · ROOM {hud.roomCode || "-----"} · READ ONCE, THEN BURN</div>
        <div className="report-sec">TONIGHT’S SITE CONDITIONS</div>
        {hud.modifiers.length > 0 ? (
          <ul>
            {hud.modifiers.map((m) => {
              const label = MOD_LABELS[m] ?? m.toUpperCase();
              const cut = label.indexOf(" — ");
              return (
                <li key={m}>
                  <span className="cond-tag">{cut > 0 ? label.slice(0, cut) : label}</span>
                  {cut > 0 && <span className="cond-desc">{label.slice(cut + 3)}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Site conditions: quiet. Quiet is not the same as safe.</p>
        )}
        <div className="report-sec">THE NUMBERS</div>
        <p className="briefing-quota">
          Quota: <b className="quota-num">${hud.quota}</b> of salvage. Find the distributor cap. Doors bang. Keep quiet.
        </p>
        {hud.exitDriverNick && (
          <p className="briefing-quota">
            The drive-in: <b className="quota-num">{hud.exitDriverNick}</b> takes the wheel. Thread the three gates,
            park at the ring — the clock starts when the van stops. Whoever parks it drives you out.
          </p>
        )}
        <div className="report-sec">IF THE NIGHT GOES WRONG</div>
        <p className="briefing-hide">The junkers out front and the passage dumpster open if you need to disappear. (E)</p>
        <p className="briefing-hide">The van will not leave without the exit driver — downed, stabilize them; gone, carry the body home. (E)</p>
      </div>
    </div>
  );
}

const MOD_LABELS: Record<string, string> = {
  blackout: "BLACKOUT — lights are dead, bring your flashlight (F)",
  fragile: "EGGSHELL CONTRACT — fragile cargo takes double damage",
  sensitive: "LIGHT SLEEPER — The Caretaker hears everything",
  shortclock: "SHORT SHIFT — 90 seconds less tonight",
  bells: "CURSED BELLS — all cargo rattles while carried",
  wired: "AMPED UP — The Caretaker moves 20% faster (never faster than the end of a bad night)",
  fatquota: "RAISED TARGETS — corporate raised the quota 15%. Corporate gets a bonus.",
  storm: "STORM CELL — rain on the roof. The sky flashes. Nobody is coming either way.",
};

export { COLORS };
