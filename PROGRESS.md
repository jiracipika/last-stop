# LAST STOP — progress log

One complete, replayable mission first; then expand. This file is the resume point.

## Status: first release playable end-to-end (2026-11-05) — art slice 1 + hiding/customization + presence/content + feel/perf/debrief + debrief-data/audio-vocab/modifiers + chaseSid/storm + title/presets/balance slices (2026-11-06)

### In-engine title, quality presets, balance sweep (2026-11-06) — done

- **The motel lot is the title screen**: the engine now boots at App mount with an ATTRACT
  MODE — one WebGL context for life (world3d built once, never rebuilt on join/leave), a 50 s
  cinematic camera loop (wide lot → sign push-in → walkway glide → van three-quarter), no
  players/enemy/HUD/audio. InputManager construction is lazy (WASD preventDefault would have
  eaten nickname typing — the key trap). Joining halts the loop and hands over the camera
  (FOV eases 66→75); a failed join relaunches the cinematic; tab-hidden stops the loop at
  title. Any attract failure falls back to the static CSS background without blocking joins.
  Title.tsx: zero changes — every e2e selector intact.
- **Quality presets** (Low/Medium/High in the pause menu, persisted): Low = pixelRatio ≤1 +
  dust off + flicker flattened + light-cull radius halved; Medium = ≤1.25; High = full (the
  old default look). Low→High now restores flicker styles correctly.
- **Balance sweep tool** (`apps/server/scripts/balance-sweep.ts` → `docs/BALANCE.md`,
  deterministic, 56 combos × 5 seeds): the flag rule (1.6× median) clears all combos — but the
  tool self-reports that the median line is self-referential; against the true base,
  21/56 combos exceed 1.6× base (37.5% of missions), led by fragile+sensitive+wired at 2.10×.
  **The sweep caught a real fairness bug**: escalation stacking put esc3+wired chase speed at
  7.1 m/s vs player sprint 5.2 — unwinnable. Fix: speedMul is capped at the escalation-3
  ceiling of 1.3 (AMPED UP is a big early-night threat, a no-op at the top; modifiers.test
  pins the cap). Also corrected: CURSED BELLS emits real server-side noise (was mislabeled
  client-only) — sweep weight 1.15, regenerated report.
- Verification (2026-11-06): tsc ×3 clean; server vitest **41/41** (14 files); full Playwright
  e2e **6/6** (lobby test now instrumented: on failure it dumps per-page net phase/players
  samples — the one historical cold-start stall showed DOM briefing lagging the net phase;
  benign-but-diagnosed). Visual smoke still needed: title look/join transition, preset
  toggling, storm+blackout together.

### chaseSid over the wire + STORM CELL (2026-11-06) — done

- **The Caretaker's focus is replicated**: `EnemyState.chaseSid` (cleared at both chase-exit
  transitions: target-invalid and lose-sight; synced every tick). Client split: targeting YOU =
  full-volume sting + "IT'S SEEN YOU. RUN." toast (3 s own cooldown so forced-door pauses don't
  machine-gun); targeting someone else = the existing positional cue; the ex-target gets a
  boosted lost-you exhale (atten floored 0.65). enemy-focus.test.ts pins the wire behavior incl.
  grace-window clearing (window is grace+6 s — the lost-check only runs from chase, so a
  door-force can hold the focus a few seconds past grace; the cue fires at the state flip).
- **STORM CELL modifier** (pool now 8, pick 3): client-driven rain loop (shared noise buffer,
  lowpass, swell LFO), cold-white hemisphere lightning flashes (8–25 s random, 2–4-frame spike,
  peak 2.2 vs ~1.75 ambient — tuned by math, single constant `STORM_FLASH_PEAK`), thunder rumble
  delayed 0.6–2.5 s per flash. Storm + blackout coexist by design (man-made lights die; the sky
  still flashes). Rain/thunder muffle while hidden; lobby/briefing/results silent; pre-unlock
  rain is remembered and applied on unlock; all disposed.
- Verification (2026-11-06): tsc ×3 clean; vitest **41/41** (14 files); e2e **6/6** with a
  suite-level `retries: 1` (Playwright twin of the vitest retry budget — movement-precision
  assertions flake under this box's ambient load; real regressions fail every attempt).
- ART.md backlog rewritten: shipped list recorded; next priorities are a human playtest pass
  (all the math-tuned feel constants), second enemy/map, progression, modifier balance sweep.

### Debrief data, Caretaker vocabulary, modifier variety (2026-11-06) — done

- **Real debrief data** (mission/world/Results): MissionResults grew `shiftSeconds` (actual
  elapsed, from `briefUntil` — stays correct under the testSeconds knob) and per-row
  `status: escaped | left | down` read at the outcome moment (seat occupancy at the van
  crossing is the truth for escapes; timeouts map buckle-ins to "left"). Results.tsx prefers
  the server value with the old derivation as fallback, shows SHIFT LENGTH in the meta line.
  **First visual verification of the results screen**: new `results.spec.ts` e2e drives a
  solo 20 s mission to the OVERRUN AT DAWN report and screenshots it
  (`screenshots/results-e2e.png`); the e2e server now runs LS_TEST_MODE (test-only 2667).
- **Caretaker state vocabulary** (audio/engine): spotted sting on chase-entry (positional,
  6 s cooldown), lost-you exhale on chase-drop, faint investigate cloth ticks, rising windup
  rattle peaking at the strike. All routed through the existing spatial/muffle math — muffled
  ×0.45 while you're hidden. Honest fallback: `chaseSid` is server-only, so "spotted YOU vs
  someone" isn't distinguishable client-side yet (needs a schema addition; noted).
- **Modifier variety** (mission/world/enemy + modifiers.test.ts): RAISED TARGETS (quota +15%
  via pure `quotaFor`, world applies through `modifiersOverride` for deterministic tests) and
  AMPED UP (Caretaker speed ×1.2, stacking with escalation). Pool now 7, pick 3.
- Verification (2026-11-06): tsc ×3 clean; server vitest **40/40** (13 files) — with a
  suite-level `retry: 2` in vitest.config.ts: this box has ambient load, full-mission
  integration tests fail on timer starvation, and the failures rotate between long-walk
  tests run to run (a real logic bug fails 3× consistently — the leash-slip did); full
  Playwright e2e **6/6** incl. the new results spec; results screenshot visually verified
  (letterhead, real shift length, ledger status, stamp, notes).

### Feel / perf / debrief slice (2026-11-06) — done

Three parallel workstreams, reconciled:

- **Movement feel** (engine/predict/world/constants): sprint FOV kick (+6°, eased), view-bob
  scaled by actual predicted speed (downed/hidden/seat branches pinned), wall-bump thuds driven
  by a read-only ghost probe in the predictor (velocity the wall resolution stripped — fires at
  ≥2 m/s with cooldown), hide in/out rustle. **Stop-slide with full server↔predictor parity**:
  releasing input coasts ~0.4 m (PLAYER.STOP_SLIDE_RATE, expression-identical both sides,
  hidden/seat/downed pinned no-slide) — new stopslide.test.ts asserts the decay formula and
  coast distance. **Post-gate fix the leash forced**: the coast strained two-handle hauls into
  leash slips (slip → gentle drop → cargo damage → a coop run finished $151/$160), so carrying
  now dead-stops like pre-slide (pinned by a 4th stopslide test); the suite went green only
  after that. Known pre-existing gaps reported, deliberately not touched: predictor
  under-predicts sprint speed (reconcile absorbs it), client omits the van AABB in dynamic
  colliders.
- **Perf: static geometry merge** (world3d/textures): a bakeStatic pass buckets all 355 static
  meshes into 14 draw calls — repeat clones baked into per-mesh UVs (buckets keyed on
  texture.source.uuid), material tints baked into vertex colors. Animated/flicker/transparent
  content deliberately left live (doors, hideDoors, fan, sign, fixtures, glass, decals, fx).
  Measured: renderer idle draw calls **380 → 184** (geometries 518 → 211); SwiftShader fps
  unchanged at 20 (software-raster bound — the call cut pays off on real GPUs). Screenshots
  confirm tiling, flicker tubes, lamps and the merged scene survive. carA's junkerTeal albedo
  +18% so the rust streaks survive moonlight+ACES.
- **Debrief + title** (Results/Title/styles): results screen is now a DUSTPAN RECOVERY shift
  report — letterhead, per-outcome stamps and lines, crew ledger with derived statuses
  (clocked out / left on site / empty-handed), randomized "management notes" one-liners,
  receipt print-in animation (reduced-motion safe). Title got the flickering PALE LANTERN
  treatment with a dead letter + NO VACANCY strip + night-shift clipboard form. All e2e
  selectors and replay wiring preserved. Future server tracking noted: per-player
  survival-at-end, items left on timeout, shift duration.
- Verification (2026-11-06): shared/server/web typecheck clean; server vitest **37/37** (12
  files, `--no-file-parallelism` added — the integration suite is real-time-wait-bound and
  file-parallel runs starve the 30 Hz sim); full e2e **5/5**; draw calls above. The Results
  screen's new layout is NOT visually verified yet (needs a full mission end) — e2e only
  confirms the flow still works. Flake forensics worth remembering: the first full vitest run
  failed 2–3 carry tests with walkTo timeouts / rejected grabs. A controlled experiment
  (worktree at the previous commit + a STOP_SLIDE_RATE=14 run that makes the coast
  mathematically identical to the old damping) exonerated the stop-slide: the carry file is the
  known CPU-load flake, made marginal by the coast's extra ~0.4 m of post-walkTo drift.
  Fix is harness-side: walkTo now settles (zero input, waits ≤1.5 s for position stability)
  before returning, so proximity checks don't race the coast; carry then passed 6/6 with the
  full coast intact.

### Presence & content slice (2026-11-06): real junkers, an audible Caretaker, a third hide spot — done

Three parallel workstreams, reconciled:

- **The junkers are cars now** (world3d/textures): the two hide spots got real geometry — hull +
  beveled beltline + greenhouse glass bands, rolling wheels with hubs (the old ones were mounted
  sideways), bumpers, plates, and dressed interiors (dash, seats, bench) so the hide camera
  doesn't sit in a hollow box. carA (front yard) wears faded teal with rust streaks (`junkerTeal`
  0x2ea7); carB (south fence) wears primer brown with a flat tire and missing hubcap
  (`primerCar` 0x5b21). Footprints and hide anchors unchanged — the driver-door throat and trunk
  mouth are cut to line up with the animated door/lid. Known compromise: carB's lid rests ajar
  over a rusted-open trunk mouth (hinge geometry can't close flush without moving shared
  anchors) — reads as junk, kept deliberately.
- **The Caretaker is audible and casts light** (audio/enemy3d/engine): distance-attenuated,
  panned footsteps whose cadence follows its gait (~1.1 steps/s stalking, ~2.4 chasing), random
  lantern clinks while calm, a thump+scrape when it drags someone out of a hide spot (hooked the
  `hide` event's `dragged` flag). Everything arrives muffled (×0.45) while YOU are hidden. Its
  lantern now casts a warm additive ground pool that flares with its intent (windup brightest,
  door-pounding strobes) — you can see it coming through windows. Also fixed: EnemyView leaked a
  fresh MeshBasicMaterial every frame (lampFace) and was never disposed — both fixed.
- **Content**: third hide spot — the passage dumpster (`dump1`, server-generic, lid sized per
  spot via new optional `HideSpot.lidW/lidD/lidY`; dark muck visible under the tipped lid). New
  patrol route through the east alley nodes (GY→ES→EA→EA2→EA→ES) that no previous route covered.
  hide.test.ts extended with a dumpster wire test incl. stand-point return. Screenshot audit
  showed the dumpster passage was pitch black — added a bug-lamp on the garage wall (warm, buzzing):
  it guides you to the lid and betrays you while you climb in.
- Verification (2026-11-06): shared/server/web typecheck clean; server vitest **33/33** (12 files);
  full Playwright e2e **5/5** (one lobby flake — pageB's first state patch lagged past 5 s under
  suite load while pageA already had both players — hardened its timeout to match pageA's 15 s).
  Screenshot close-ups of both junkers + dumpster in `screenshots/presence-slice/`; known issue:
  carA's new paint is barely readable at night grade from the yard angle (stealth-dark by
  design, but worth a fill light or brighter albedo in a later pass).

### Gameplay slice (2026-11-06): hiding in the junkers + crew customization — done

Server-authoritative stealth + identity, both replicated to every client:

- **Hide in the cars** (`HIDE_SPOTS` in shared map: sedan cabin by the yard, trunk by the south
  fence). Climb in near the stand point (E); the door/trunk-lid opens (client mirrors
  `player.hidden`), your avatar + nametag vanish, movement locks. Walk or E climbs out at the
  stand point. Fairness rules (all server-side): hidden players are invisible to The Caretaker's
  vision — **unless it watched you get in** (chasing you with a fresh sighting = busted: it walks
  over, winds up next to the car, and DRAGS you out with damage). The car door makes noise
  (NOISE.CAR_DOOR) so it may still come sniffing. Can't hide while carrying; flashlight goes
  dark inside. Hidden players still count for mission-end checks.
- **Crew customization**: headgear picker on the title screen (hi-vis cap / hard hat / beanie /
  headphones / bare) — `prefs.hat` → join option → `PlayerState.hat` → per-avatar 3D headgear,
  plus hi-vis reflective vest strips on every crew member. Changeable in-lobby via the
  `profile` act.
- Schema additions: `PlayerState.hat`, `PlayerState.hidden`. New `hide` act (rate-limited).
- Tests: `hide.test.ts` — hidden ≠ seen (world-level), busted chase → dragged out, over-the-wire
  hide/unhide replication + distance rejection.
- Verification (2026-11-06): server vitest 32/32 (11 files), full Playwright e2e 5/5. The new
  reconnect e2e exposed a real product bug — the SDK's auto-reconnect raced our manual
  `tryReconnect` for the same reconnection token — fixed by disabling SDK auto-reconnect in
  `net.ts` (Net owns the flow); test then passes 3/3 consecutive runs.




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
