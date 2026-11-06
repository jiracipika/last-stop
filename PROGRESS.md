# LAST STOP — progress log

One complete, replayable mission first; then expand. This file is the resume point.

## Status: first release playable end-to-end (2026-11-05) — art direction slice 1 landed (2026-11-06)

### Art slice 1 (2026-11-06): textures, lighting, landmarks — done

Audited the live game first with deterministic screenshots (9 fixed camera poses via a dev-only
`engine.frozenCam` photo mode + `e2e/shots.ts`); vision-model critique + code read agreed the
game looked like a graybox: **zero textures** (2 CanvasTextures total), **no interior lights at
all** (corridor/garage/reception were black voids), no landmark hierarchy. Full audit + backlog:
`docs/ART.md`. Before/after evidence: `screenshots/baseline/` vs `screenshots/after/`.

Landed (all client-side, `apps/web/src/game/`):

- **Procedural texture set** (`textures.ts`): 11 seeded 512 px materials (asphalt, gravel,
  plaster w/ baked teal wainscot, garage cinderblock, concrete, vinyl tile, carpet, wood,
  corrugated, worn metal, van livery) + decals (oil stains, room numbers 1–4, corridor plates,
  NO VACANCY sign, DUSTPAN RECOVERY CO. livery, light pools). All original canvas-drawn with
  `mulberry32` — no external assets, nothing to license. Manifest in `docs/ART.md`.
- **Wall tiling**: plaster/block textures tile every ~4 m (per-wall repeat clones) so detail
  survives at gameplay distance; mid-frequency weathering (0.5–1.5 m blotches) because
  grain-scale speckle is sub-pixel on screen at 8 m.
- **Interior lighting**: fluorescent fixtures + cool point lights in reception/corridor/garage
  (corridor-east and one garage tube deliberately failing), red maintenance emergency light,
  laundry bulb, R3 bedside lamp, boiler ember, warm porch bulbs over walkway doors (R2's dead).
  Guaranteed ground pools via additive decals under lamps/porches/entry. Lights distance-culled
  per frame; low quality kills flicker + dust.
- **Landmarks**: redesigned 6.5 m PALE LANTERN pole sign (tungsten letters, dead A + T, NO
  VACANCY strip, storm lean + sway), hazard-red gate lamps, room numbers/plates on doors.
- **Room dressing** (visual-only, kept off loot spawns + doorways): beds/nightstands/TV per
  front room, reception desk + key rack + clock + ceiling fan (spins), corridor ice machine,
  maintenance pipes, boiler gauge, storage boxes, garage tool board + rust drums + rolled bay
  door slats, knocked-over cones, oil stains.
- **Van**: livery paint texture, DUSTPAN RECOVERY CO. decals ("WE TOW REGRETS"), amber beacon,
  additive headlight pools on the asphalt.
- **Grade**: ACES filmic tonemapping (exposure 1.12), asphalt-blue fog `0x0a0f16`, stronger
  moon/hemi so silhouettes separate from the sky. WebGL resources disposed on teardown
  (`World3D.dispose`/`VanView.dispose`).

Verified: typecheck clean; **29/29 vitest, 5/5 Playwright e2e** (incl. screen-direction
regression) after the changes. Vision-model re-audit of after-shots: corridor
"properly art-directed", garage "lit workshop", sign reads PALE/LANTERN with intentional dead
letters, porch/lamp pools visible. Honest residuals: exterior facade texture still reads
mostly flat beyond ~15 m (night grade + fog — by mood design, noted in docs/ART.md); SwiftShader
fps 25→20 with ACES + textures (draw calls 72→~330 idle at the wide overview pose, ~100–160 in
normal play; merging static geometry is backlog item 6); title screen still DOM-only (item 5).


### Milestones

1. **Scaffold + shared core** — done.
   pnpm monorepo (`apps/web`, `apps/server`, `packages/shared`), TS strict everywhere.
   Colyseus 0.18 core + schema v5 (builder API — decorator-free, esbuild-safe), verified against
   installed `node_modules` docs before writing code. `@colyseus/schema` smoke test committed in
   git history (encode/decode/delta/maps).
2. **Walkable world + map integrity** — done.
   Handcrafted motel/garage lot as data (walls-with-gaps, 15 doors, ~60 nav nodes, spawn points,
   props). `packages/shared/src/mapcheck.ts` + vitest assert every nav edge is wall-clear, every
   spawn outside colliders, gate lanes drivable. Found & fixed: alley car blocking a nav edge,
   boiler-tank overlaps, gate too narrow for the van's collision circles.
3. **Real multiplayer** — done.
   Server-authoritative room: fixed 30 Hz tick, 20 Hz patches, validated inputs, 4-player cap,
   5-letter room codes (`LS<CODE>`), reconnection (20 s seat hold, hands freed on drop), host
   transfer, auto-dispose. Verified with 4 concurrent Node SDK clients + 2 real browsers.
4. **Carrying** — done.
   One-hand items, two-handle heavies (second handle grabs while carried), leash slips, throws,
   fragile impact damage, noisy rattlers, van loading zone auto-store, straps, disconnect release.
   Test-verified atomic grabs and single-credit delivery.
5. **Van + mission** — done.
   Parked hub (doors/lights/straps/seats), part install (hold E), quota+part → gate → escape
   phase, arcade driving with confirmation-before-abandoning, finish → results → instant replay.
   Full WIN path passes as an automated bot playthrough (walk, grab, deliver, install, board,
   steer out).
6. **Enemy** — done.
   Caretaker FSM (patrol/investigate/chase/windup/recover/force-door), nav-graph locomotion,
   LOS+FOV vision, noise hearing with modifier scaling, door forcing slowed by nearby players,
   escalation at 5:00/9:00, hunt pulses at level 3. FSM verified world-level + full server.
7. **Modifiers + replay** — done. 3-of-5 per seed; replay verified to reset items/salvage/gate.
8. **Client polish** — good for v1.
   Procedural low-poly world (motel, garage, road, sign with canvas texture, lamps, props),
   chunky avatars with waddle animation, Caretaker with lantern telegraphs, item meshes with
   damage darkening, first-person camera with optional head-bob/shake, spectator cam, ping
   beacons, quick-chat bubbles, synthesized WebAudio SFX + chase drone + heartbeat, HUD
   (timer/quota/vitals/scanner/teammates/prompt/progress), settings, briefing + results screens,
   desktop-only notice, WebGL-failure panel.

### Verified by tests

- Server: 28/28 (`pnpm test`) — map, lobby (+ duplicate code rejection), carry, mission arcs
  (win/timeout/wipe/replay), enemy FSM, anti-cheat (teleport/tamper/flood), **reconnection**
  (token reconnect restores session/position/stats; grace expiry removes the seat; solo-grace
  keeps the run alive), **enemy over sockets** (chase → down → revive, cross-client enemy sync),
  **4-crew cooperative WIN** (two-handle heavy delivery, part install, all four board and
  escape, all four clients agree on results).
- Browsers: 4/4 Playwright (`pnpm e2e`) — two contexts, one room, join by code, start, HUD;
  keyboard-driven movement + flashlight + ping through the real client pipeline; forced socket
  drop healed by SDK auto-reconnect with the session intact.
- Build/typecheck clean; bundled server boots + `/health` responds.
- FPS probe (`e2e/tests/probe-fps.ts`): ~15–20 fps in headless Chromium **software GL**
  (SwiftShader) — a worst-case floor/regression check, not a hardware benchmark. No GPU-frame
  target is claimed from it; measure on real hardware before making one.

### Session 3 fixes (2026-11-05, "/continue" batch)

- Duplicate room codes are rejected server-side (two rooms sharing LS<CODE> made joins a coin
  flip); client's retry-with-new-code path now has a matching test.
- Solo disconnect no longer instantly wipes the mission: players inside their reconnect grace
  count as active. Found by the browser reconnect e2e (solo drop → "results" within seconds).
- Browser e2e now covers the real client input pipeline (WASD → prediction → server → replicated
  position, flashlight, ping markers) and SDK auto-reconnect healing a forced socket drop.
- Remote players, the van, and The Caretaker render through a 120 ms two-snapshot interpolation
  buffer (teleport-safe) instead of exponential smoothing; FPS floor unchanged.
- Item yaw blends when a two-handle carrier drops; spectate HUD names who you're watching;
  WebGL context loss is caught with a recovery toast.

### Session 2 fixes (2026-11-05, "queue" continuation)

- Fixed mirrored strafing in the shared local→world transform (east/west walking was inverted;
  invisible in north/south tests until the reconnect test walked west).
- Caretaker windup now pivots toward its target — previously it could wind up facing away and
  miss forever at point-blank (found by the socket enemy test, reproduced world-level).
- Grabs no longer treat the van body as an occluder (loading-zone grabs were rejected).
- Feel: your own carried item renders at your predicted hold point (no server lag), grab prompts
  show $value, "IT'S FORCING A DOOR" warning when banging nearby, second-handle pickup toast.

### Commands

```bash
pnpm install
pnpm dev:server        # ws://localhost:2567
pnpm dev:web           # http://localhost:5173
pnpm test              # server suite
pnpm e2e               # playwright (boots both servers itself)
pnpm build && pnpm typecheck
```

Deployment: frontend on Vercel (`apps/web/vercel.json`, set `VITE_GAME_SERVER_URL`); game
server via `apps/server/Dockerfile` on any persistent Node host. Evidence for not hosting the
room server on Vercel is quoted in README.md (their WebSocket + duration docs).

### Known problems / TODO (next session picks up here)

- **Test flakiness note (2026-11-05)**: the full server suite passes 21/21 across consecutive
  runs, but one run in five-ish had 2 failures — the walk-bot tests (real-time nav walking over
  30–140 s) can time out under CPU load. If that bites, raise the `walkTo` maxMs or slow the bots'
  expectations rather than retrying blindly.
- **Feel pass needed with real humans** — carrying speed curve, Caretaker chase-speed vs player
  sprint, noise radii, quota strictness. All are constants in `packages/shared/src/constants.ts`.
- **4-player over WAN untested** — local sockets + browsers only. Consider a playtest deploy
  (Fly.io free tier) and watch patch sizes.
- Frame-rate not measured on integrated GPUs; `quality` setting exists but unprofiled.
- Remote entity smoothing is a 12 Hz exponential approach, not buffered interpolation — fine at
  20 Hz patches, but a proper 100 ms replay buffer would polish fast van motion.
- Two-carrier item yaw snaps when a carrier leaves; blend it.
- Enemy can path to the gate area but never onto the escape road (nav graph has no road nodes) —
  intentional; revisit if road chases sound fun.
- No WebGL context-loss recovery.
- Doors don't block the enemy's lantern light (visual only).
- Room codes can theoretically collide; host client retries with a new code (handled).

### Deferred (extension points only, per spec)

Proximity voice chat (WebRTC would ride the room roster) · more maps/enemies · longer road-trip
segments · vehicle upgrades · cosmetics · elaborate joint-constraint carrying (Rapier or custom
springs — the item-follow system is isolated in `world.stepCarried`) · controller/mobile.
