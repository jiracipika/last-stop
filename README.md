# LAST STOP

**A 1–4 player online co-op horror-comedy shift.** Your crew's recovery van died outside the Pale
Lantern Motel. Haul the valuables out, find a distributor cap, fix the van, and drive out before
The Caretaker decides you're part of the inventory.

Inspired by the *feeling* of R.E.P.O., RV There Yet?, and Lethal Company — all mechanics, art,
audio, characters, and code here are original. Everything is procedural: no asset packs, no
downloads, no image generation.

---

## Quick start (local)

```bash
# from the repo root (Node 20+, pnpm 9+; corepack enable gives you pnpm)
pnpm install

# terminal 1 — the authoritative game server (port 2567)
pnpm dev:server

# terminal 2 — the web client (port 5173)
pnpm dev:web
```

## Live links

- **Production:** <https://laststopgame.vercel.app>
- **Staging:** <https://laststopstaging.vercel.app> (preview deployments; SSO protection is
  disabled on this project so previews are public)
- **Source:** <https://github.com/jiracipika/last-stop> (private)

> ⚠️ **The deployed frontend is not yet playable online.** Vercel hosts the client only — the
> authoritative game server must run on a persistent Node host (see *Hosting* below). Until that
> server exists and `VITE_GAME_SERVER_URL` is set to its `wss://` address, room creation on the
> deployed site will fail gracefully. Everything works locally with the two commands above.

Open <http://localhost:5173>. One player picks a name/color and **Start a new shift**; the others
enter the 5-letter code (or the invite link `?room=CODE`). Ready up, host starts. Solo practice
works the same way — heavy items get lighter and quota scales down.

### Tests

```bash
pnpm test          # server suite: map integrity, lobby, carrying, mission arcs, anti-cheat
pnpm typecheck     # tsc across all packages
pnpm build         # vite web build + esbuild server bundle
pnpm e2e           # Playwright: two real browsers, one room, join-by-code, full start flow
```

---

## Controls

| Input | On foot | Driving |
|---|---|---|
| WASD | move | throttle / steer |
| Mouse | look | look |
| Shift | sprint (stamina) | — |
| E | interact: doors, van doors, straps, seats; **hold** to revive teammate / install part | exit (when stopped) |
| Left mouse | grab / release carried item | — |
| Right mouse (hold) | stabilize carried item (halves impact damage) | — |
| F | flashlight | — |
| Q | ping (contextual marker at crosshair target) | — |
| G | throw carried item | — |
| 1 / 2 / 3 | quick chat: HELP CARRY / ENEMY HERE / BACK TO VAN | — |
| H | — | horn (a big, deliberate noise) |
| Space | jump | handbrake |
| Esc | pause + settings (releases mouse) | same |

Settings: mouse sensitivity, volume, quality (low/medium/high), head-bob toggle, camera-shake
toggle. Desktop-only: a notice is shown on touch layouts.

## The shift (mission loop)

1. Crew room: create/join by code, pick name + uniform color, ready up.
2. Briefing (5 s): three random modifiers are announced.
3. Scavenge (12 min base): grab valuables, haul them to the van's rear loading zone, find the
   **distributor cap** and install it at the engine (hold E, 3 s).
4. Meet the salvage quota **and** install the part → the west gate opens, phase becomes **GET OUT**.
5. Everyone boards (rear doors: shotgun seats; driver door: the wheel). Driving asks for a
   confirming second press if living teammates are still outside.
6. Drive west through the gate. Crossing the finish line wins — anyone not aboard is left behind.
7. Shared debrief: salvage vs quota, cargo damage, per-crew stats, **Loudest Employee**,
   **Most Expensive Mistake**, top hauler, rescuer of the night. One click to run it back
   (fresh seed, same room).

Failure states are explicit: **timeout** (shift ran out), **wipe** (everyone down), or winning
without the quota is impossible — the gate needs both. Downed players bleed out in 60 s unless a
teammate holds E for 5 s. Dead players spectate (button cycles teammates).

### Cargo

- Small valuables: one hand, one carrier.
- Heavy valuables (vending machine, arcade cabinet, chest freezer, fish tank, grandfather clock…):
  two handles. Alone you crawl; with a partner you both walk nearly normal. Stray past the leash
  and it *slips* (loudly).
- Fragile cargo loses value on hard impacts (never below 10% — every seed stays completable).
  Right-mouse stabilizing halves the damage.
- Noisy cargo (service bell, wind chimes — or the CURSED BELLS modifier) rings while moving and
  pulls The Caretaker toward you.
- Cargo left unstrapped in the van takes damage from escape-route bumps. Strap rail is by the
  rear doors.

### The Caretaker

One enemy, a readable finite-state machine: **patrol** (nav-graph loops with detours) →
**investigate** (any loud noise: sprinting, drops, doors, horn, bells, headlights) → **chase**
(line of sight, ~15 m, 100° cone, never through walls/closed doors) → **windup** (0.85 s
telegraph: arms up, lantern flares red) → strike (65 dmg) → **recover**. Break line of sight and
stay quiet for ~3.5 s and it goes back to searching. Closed doors stop it — it forces them in
~2.6 s, +2 s per crew member standing near the door. *Hold the door* is a real tactic.
Escalation at 5:00 (+15% speed, +20% hearing) and 9:00 (+30%, hunt pulses toward living players).

### Modifiers (3 of 5 per seed)

BLACKOUT · EGGSHELL CONTRACT (fragile ×2) · LIGHT SLEEPER (noise ×1.4) · SHORT SHIFT (−90 s) ·
CURSED BELLS (all cargo rattles)

---

## Architecture

```
apps/web       Vite + React shell, three.js renderer, prediction/input/audio (TypeScript)
apps/server    Colyseus room, fixed 30 Hz authoritative sim, express health endpoint
packages/shared  map data, item catalog, mission config, deterministic step functions,
                Colyseus schema (shared by server + client)
e2e/           Playwright browser tests
```

- **Server-authoritative everything**: positions, items, grabs, damage, enemy AI, van, mission
  progression, results. Clients send *inputs* (clamped, flood-limited — >90 msg/s gets you
  kicked), never positions. Interactions are range- and line-of-sight-checked server-side.
- **Fixed timestep + prediction**: the server steps the shared sim at 30 Hz; the client runs the
  *same* step code locally for its own player and reconciles against `inputSeq` acks (snap past
  0.6 m error, blend below). Other entities smooth toward authoritative patches (12 Hz approach).
- **Physics**: a custom deterministic kinematic sim (shared package) — bounded velocities, capped
  forces, AABB collision, no rigid-body chaos. Rapier was considered and deliberately skipped:
  determinism + Node deployability + prediction parity matter more here than ragdoll energy
  (extension point for later, see PROGRESS.md).
- **Networking**: Colyseus 0.18 (schema v5 binary delta patches at 20 Hz) over plain `ws`.
  Private rooms by 5-letter code (`LS<CODE>` room ids), max 4 players (5th is rejected),
  reconnection with a 20 s seat-hold, carried items released safely on drop, host transfer when
  the host leaves, empty rooms auto-dispose.
- **Grab atomicity**: handles are assigned server-side in a single synchronous check — two
  clients grabbing the same handle in the same tick cannot both win (covered by tests).
- **Audio**: 100% synthesized WebAudio (oscillators + noise buffers): footsteps, glass, bells,
  engine, horn, door bangs, chase drone, heartbeat, results jingle. Unlocked on first click.

## Hosting

### Frontend → Vercel (done)

The web app is a static Vite bundle. The repo-root `vercel.json` configures the monorepo build
(`pnpm --filter @last-stop/web build` → `apps/web/dist`). The project is deployed as
`laststopgame` (production + public staging alias). To set the game server address in the
dashboard, set the env var:

```
VITE_GAME_SERVER_URL=wss://<your-game-server-host>
```

### Game server → a persistent Node host (NOT Vercel)

Vercel's own WebSocket docs (checked 2026-11-05) are unambiguous about why the authoritative
server can't live there:

> "WebSocket connections close when a Vercel Function reaches its maximum duration."
> "New WebSocket connections are not guaranteed to reach the same Vercel Function instance. …
> Store durable state, presence, counters, **rooms**, and pub/sub coordination in an external
> data store instead of relying on in-memory variables."

A 10–15 minute mission outlives the Hobby hard cap (300 s; 800 s GA / 30-min beta on Pro), rooms
must live in-process, and this project explicitly keeps high-frequency sim state **out** of
databases. So: any long-lived Node host — Docker image provided (`apps/server/Dockerfile`,
includes a `/health` endpoint and healthcheck).

```bash
# build & run locally
docker build -f apps/server/Dockerfile -t last-stop-server .
docker run -p 2567:2567 last-stop-server

# fly.io example
fly launch --dockerfile apps/server/Dockerfile --name last-stop-server
fly deploy
# then point the frontend at wss://last-stop-server.fly.dev
```

Use `wss://` in production (Fly/Railway/Render terminate TLS for you). No backend secrets reach
the frontend — the only env var the client takes is the public server URL.

---

## What's tested (actually run, not claimed)

- `pnpm test` — **28/28 passing**: map integrity (every nav edge clear of walls, spawns outside
  colliders, gate lanes drivable); lobby (create/join, 5th player rejected, ready-gating,
  mid-mission joins rejected, **duplicate room codes rejected**); carrying (simultaneous grab →
  exactly one holder, two-handle heavy with independent release, delivery credited exactly once,
  leave-while-carrying drops the item safely, out-of-range and far van interactions rejected);
  mission arcs (**full WIN: deliver → install → gate → drive → results → replay resets all
  state**, timeout loss, wipe, revive, Caretaker FSM: noise → investigate, sight → chase →
  windup → downed); anti-cheat (no teleporting via input, no score tampering via messages, flood
  → disconnect); **reconnection** (drop → token reconnect restores session/position/stats; 20 s
  grace expiry removes the seat and invalidates the token; **a solo player's brief disconnect
  does not wipe the mission during grace**); **enemy over real sockets** (chase → down →
  teammate revive, replicated to both clients); **4-crew cooperative WIN** (two bots carry a
  heavy on two handles, a third installs the part, all four board and drive out, and all four
  clients report the same results).
- `pnpm e2e` — **4/4 passing** (headless Chromium): two real browser contexts join one room by
  code, ready, start, both reach the mission HUD with cross-referenced teammate panels; bogus
  join code fails with feedback; **real keyboard input drives the player through prediction +
  server** (WASD movement, flashlight toggle, ping markers in replicated state); **a forced
  socket drop heals through the SDK's auto-reconnect** with the same session and working
  movement afterwards. Screenshot probes confirmed a lit, populated 3D scene (analysis in
  `shots/`). An FPS probe (`e2e/tests/probe-fps.ts`) samples ~15–20 fps under SwiftShader
  software rendering — a regression floor, not a hardware claim.
- `pnpm build` + `pnpm typecheck` — clean across all three packages; the bundled server
  (`dist/index.mjs`) boots and serves `/health`.

Not yet verified (honest list): sustained 4-player sessions over a real network (the netcode is
tested via 4 local sockets + 2 real browsers, not WAN latency), frame-rate on integrated GPUs
(the quality toggle exists; measure on your hardware), and the million little feel-tuning passes
only humans can do.

## Known limitations / next steps

See `PROGRESS.md` for the running list — headline items: proximity voice chat, more maps,
controller support, and a WebGL-landing page for sharing rooms.

## License

All original work. © 2026 — do what you like privately; ask before anything commercial.
