# LAST STOP — progress log

One complete, replayable mission first; then expand. This file is the resume point.

## Status: first release playable end-to-end (2026-11-05) — art slice 1 + hiding/customization + presence/content + feel/perf/debrief + debrief-data/audio-vocab/modifiers + chaseSid/storm + title/presets/balance + co-op-presence/loot + balance-cap/perf/personnel + briefing/polish + netcode-smoothing/hide-visibility + pull-away/QoL + late-crew + playability + remote-entity-interp slices (2026-11-06/09)

### Remote-entity interpolation hardening — the rubber-band fix (2026-11-09) — done

Playtest report: "enemies moving around still rubber banding". Systematic-debugging pass
(skill-driven; red test before the fix) traced it to the client's snapshot buffer, not the
server sim (Caretaker moves via per-tick moveToward at 30 Hz — smooth):

- **Root cause (verified by code read + reproduction)**: SnapBuf.sample had no answer for
  render time running AHEAD of the newest snapshot. When a patch arrived late (jitter >
  the 120 ms interp delay), sample returned the stale raw position — the entity FROZE —
  then fast-forwarded along the straddle when the late patch landed: freeze + rubber band,
  exactly the reported symptom. The old push-dedupe (moved < 5 mm → skip) also let
  timestamps go stale around pauses.
- **Fix (per the standard entity-interpolation contract — the html5-canvas-game netcode
  reference prescribes exactly this)**: SnapBuf moved to packages/shared/src/interp.ts;
  sample() now EXTRAPOLATES along the final segment bounded to EXTRAP_MAX_MS = 120
  (= the interp delay, so re-entry through a late patch is linearly continuous for stalls
  up to 240 ms); pushes are one-per-patch with dense timestamps (unchanged values still
  push; same-patch repeat pushes update in place so the 60 fps loop can't flood it);
  history clamps at both ends; teleport reset (>2.5 m) unchanged.
- **Carried-item swim fixed too**: an item held by a REMOTE crewmate used to track the
  server position (0 ms behind) while its carrier rendered 120 ms in the past — the cargo
  visibly swam around the carrier. Carried items now render at the carrier's interpolated
  hold point (mirror of the local-player branch).
- Consumers: enemy, remote players, the van (pull-away benefits), and the spectate camera —
  all shared the same buffer, so one fix covers them.
- Tests: interp.test.ts ×8, including a verbatim copy of the PRE-FIX algorithm as a legacy
  fixture that reproduces the freeze (regression proof), jitter-gap ride (kept moving,
  no fast-forward, no backward step), bounded dead-feed extrapolation, stationary
  timestamp freshness, teleport reset, yaw wrap. Harness lessons learned mid-flight: the
  dead-feed probe must skip the history seam (render time reaches the feed-stop one delay
  after it); thresholds were not tuned blind.
- Gate: tsc ×3 clean; vitest 19 files **67/67 zero flakes**; e2e **9/9 exit 0** (latejoin
  used its retry — the known two-browser-under-SwiftShader family); CJK clean; refreshed
  escape/latejoin screenshots vision-checked. Also: per-session Mimosa hook-state files
  that had leaked into git untracked + ignored (repo hygiene).
- Honest limit: smoothness itself is proven mathematically (continuity through ≤240 ms
  stalls), not by a browser-frame probe — e2e can't measure feel under SwiftShader. The
  ears/eyes check on real internet jitter is still the user's playtest.

### Playability pass + compass mirror fix (2026-11-08) — done

Skills-driven pass (ui-ux-pro-max guidance + code audit) plus a real bug it flushed out:

- **Compass was mirrored** (found by the damage-direction work): the shared bearing
  `atan2(dx, dz) - yaw` is NOT the screen angle in a right-handed three.js camera —
  screen-right is world -X at yaw 0, so signed screen angle = **-bearing**. The
  iteration-12 escape compass pointed the wrong way (its e2e only asserted visibility).
  Fixed at both computation sites (Hud compass + new dmgDir), convention documented in
  store.ts, and a numeric direction regression now runs in escape.spec (rendered rotation
  must match the derived angle within 0.05 rad).
- **Directional damage indicator**: hurt events carry optional sx/sz (Caretaker melee
  stamps its position; van bumps never damaged players — documented); the HUD renders a
  warning-red wedge around the crosshair pointing at the source, fading with the damage
  flash. dmgdir.test.ts pins the enemy stamp.
- **Downed banner**: "DOWNED - your crew can stabilize you" + nearest-crew name/distance
  when downed (state-driven, reduced-motion aware).
- **First-shift controls card**: compact auto-fading card (10 s, once per browser via
  localStorage) on first scavenge entry; CONTROLS reference added to the pause menu;
  interact prompts now carry [E] / [HOLD E] key hints.
- **GitHub passes**: backlog filed as issues #1-#8; first release tag v0.6.0.
- Gate: tsc x3 clean; vitest 59/59 (18 files, zero flakes); e2e 9/9 (zero flakes,
  direction assertion included); CJK scans clean; screenshot vision-checked (chevron now
  points true).

### Late crew: mid-shift joins + invite links (2026-11-07) — done

Friends no longer bounce off an active shift:

- **Late join**: GameRoom.onJoin now accepts briefing/scavenge/escape (and the pull-away
  window) instead of throwing "Mission in progress". Late crew spawn at the van —
  `placeAtVan` = vanPoint(0, MISSION.LATE_SPAWN_LOCAL_Z = 3.2), which is past the FRONT
  bumper (local +z is forward: ENGINE_POINT +2.55 vs DOOR_POINT -2.45), landing in the open
  lot clear of hull (VAN.HALF_L 2.4) and props. Toast on the ev channel: "<nick> clocked in
  late - get to work." No Caretaker spawn protection (documented; the lot is open ground).
  Full-room rejection unchanged — note Colyseus locks the room at matchmake level at
  maxClients, so the wire error is "room is locked", not the room's own "Room is full".
- **Invite links**: the title now pre-fills the join code from `?code=` (uppercase, strip
  non-alphanumerics, truncate to 5; legacy `?room=` still honored) and focuses the field;
  the lobby's copy button shares `origin/?code=<code>` with brief "Copied" feedback.
- **Host audit**: migration on leave already promotes correctly (schema flag + RPlayer flag,
  toast); no fix needed, pinned by existing lobby coverage.
- Tests: latejoin.test.ts ×4 (mid-escape join position/toast/movement, late grab works,
  results-phase join still fine, full-room rejection); lobby.test's mid-mission case
  inverted to pin the new allowance; latejoin.spec.ts e2e (two browsers, friend joins
  mid-escape, HUD + Host teammate visible on the committed screenshot) + invite pre-fill.
- Gate: tsc ×3 clean; vitest 58/58 (full-run 57/58 with one carry.test walkTo timeout =
  the ambient-load starvation family, file re-verified 6/6 standalone); e2e 9/9 (latejoin
  mid-shift flaky, passed on retry #2 — two browser contexts under SwiftShader);
  vision-checked screenshots.

### Motor-pool pull-away + crew QoL (2026-11-07) — done

Recon showed reconnect (grace window, tests) and "Run it back" already shipped; this iteration
fills the remaining autonomous gaps:

- **Success end-beat**: crossing the finish line used to cut straight to the debrief. Now the
  outcome lands immediately (`outcome = "escaped"`) while the world holds still for
  MISSION.PULL_S = 2.6 s: the van eases out along its facing (smoothstepped `van.pullT` 0→1,
  speed ease-in to PULL_SPEED 3.5), seated riders keep following their seats so the crew rides
  out (orchestrator fix — the first cut left them standing in the lot), and results land when
  the pull completes. Failure outcomes keep the immediate results. Mission-step/checkMissionEnd
  frozen during the pull; FINISH_X can't re-trigger.
- **Escape-phase compass**: HUD chevron + "VAN - Nm" pointing the way you must turn (relative
  bearing vs camera yaw, wrapped), escape only, hidden within 4 m and for the dead.
- **Latency chip**: net probes round-trip via the existing ping/pong ev channel (bare-number
  echo — objects coerce to 0), every 5 s, `rttMs` sentinel -1; chip amber ≥120 ms, red >300.
  The old 2 s ping loop leaked one wrapper per unanswered ping — deleted.
- **Engine-start rumble**: `van.pullT` crossing 0 fires a one-shot low sawtooth rev + gravel
  noise, swelled over ~2.3 s, positioned through the standard spatial path, latched once per
  mission.
- **`testAt: "escape"` knob** (LS_TEST_MODE=1): startMission jumps straight to escape with
  partInstalled/gateOpen true — probes and e2e no longer need to play the whole shift to test
  the endgame. Replay guard audited: already phase-gated + rate-limited, unchanged.
- New server tests: endbeat.test.ts (success pull observed mid-beat, failure keeps pullT 0,
  knob lands in escape); new e2e: escape.spec.ts (knob-driven escape HUD shot, compass +
  latency chip verified on screen). One test-side bug found by the gate: the pull test kept
  re-sampling vanXAtPull while pullT rose, chasing the van until the travel assertion compared
  the end against itself — capture-once fixed. Verification: tsc ×3 clean; vitest 54/54;
  e2e 7/7 (1 known ambient-load flake passed on retry); escape HUD screenshot vision-checked
  (chip amber at 278 ms, compass "VAN - 5 m" pointing true).

### Netcode smoothing + hide-spot visibility (2026-11-06/07) — done

Playtest feedback ("stuttery/rubber-bandy", "car doors don't open properly") drove two passes:

- **Rubber-band killed at the root**: the client predictor only ever estimated WALK speed while
  the server sprinted at 5.2 — every sprint accumulated reconcile error past the snap
  threshold and yanked the camera. `speedFor` now mirrors the server's effectiveSpeed exactly
  (sprint gate, stamina, carry caps, low-hp). Reconcile no longer hard-snaps: the sim body
  corrects partially and the remainder is a clamped, decaying render offset (teleports still
  cut). Client colliders gained the van hull (server stopped you where the client walked in).
- **Patches 20 → 30 Hz** (match the tick; bytes are tiny). Note: raising the TICK was not the
  lever — prediction parity + patch cadence were.
- **Hide spots read now**: Playwright-driven hide runs (client-side walk bot + wire acts)
  showed the door/lid animations were mechanically perfect but INVISIBLE — pitch-black
  cabin/trunk interiors and a closed door sagging 11.5° (the old box-car's tilt kept for the
  rebuilt body). Fixes: dome lights that fade in with the door (warm in carA's cabin, cold in
  carB's trunk), carA doorYaw 0.2 → 0.03 (flush in the real throat). Verified in screenshots:
  first-person hide views now show a lit interior, the open door reads from outside.
- **Probe-infrastructure gotcha worth remembering**: manually booted vite needs
  `VITE_GAME_SERVER_URL=ws://127.0.0.1:2667` or the page connects to the PRODUCTION server on
  2567 (real Caretaker, room cap shared with players) — two probe sessions were corrupted by
  exactly this before it was caught.
- Verification: tsc ×3 clean; vitest + e2e below.

### Briefing sheet, drop enrichment, security audit (2026-11-06/07) — done

- **Briefing screen authored**: night-shift sheet in the receipt voice (DUSTPAN letterhead,
  FORM 2AM-A, "TONIGHT'S SITE CONDITIONS" chips, "THE NUMBERS", and a new "IF THE NIGHT GOES
  WRONG" line pointing the crew at the junkers + dumpster). MOD_LABELS caught up with the new
  modifiers — wired/fatquota/storm rendered as raw ids before. Root className "briefing"
  preserved (e2e phaseOf reads it).
- **Drop event enriched**: server stamps drops with x/z/heavy; the client's camera-position
  fallback and def-table resolution deleted. Additive payload only.
- **Security audit**: Mimosa full-repo scan — 0 findings, dependency risk 0, sealed
  (scan-2026-11-07T01-21-19…, sha256:57d4ef8b…).
- Verification: tsc ×3 clean; vitest + e2e below.

### Severity cap, spawn-in fix, benchmarks, personnel file (2026-11-06) — done

- **Severity-capped modifier draw**: `comboSeverity()` now lives in shared (single source of
  truth with the sweep tool) and `pickModifiers` re-rolls the last pick through a filtered
  benign bag when a draw exceeds SEVERITY_CAP = 1.9 — the top-8 harshest stacks (incl.
  fragile+sensitive+wired at 2.10× base) can no longer be dealt. Fires on ~14.3% of draws;
  first two picks per seed unchanged; downstream rng consumption unaffected. 4 new tests
  (rigged draws, 2000-seed sweep, determinism). BALANCE.md regenerated (also fixed a stale
  doc: 26/56 combos over 1.6× base pre-cap, not 21).
- **Spawn-in slingshot fixed** (found by the new bench tool): the predictor kept stepping
  through lobby/briefing, so the startMission teleport got reconcile-slingshot across the map
  for ~8-9 s at every spawn-in. The client now pins to the authoritative position outside
  mission phases.
- **docs/PERF.md** (new `e2e/bench.ts`): per-preset idle/walk draw calls + fps. Finding:
  presets change per-pixel cost (DPR/AA/fog/dust), not draw calls (~165 across tiers) —
  on SwiftShader fps cells are load-dependent floors; rerun on a quiet box for real numbers.
- **PERSONNEL FILE on the debrief**: per-browser records (best haul; fastest clean exit for
  escapes) with a subtle highlight on a beaten record; first-ever entries file quietly.
- Verification: tsc ×3 clean; vitest + e2e below.

### Co-op presence + loot variety (2026-11-06) — done

- **Remote crew is audible** (engine/audio): teammates now have positional footsteps
  (`pstep`, cadence from their RENDERED positions so sound and sight agree, sprint-shaded,
  ≤half the sting reference), and grab/drop/slip/store/ring events are positional for
  everyone — previously drop sounds played at YOUR camera (server events carry no x/z), slip
  had no sound at all, and a dead `bell` case never fired. Heavy drops get a heavier thud via
  the item's twoHandle flag. All positional cues muffled while you're hidden.
- **Remote smoothing verified, not rebuilt**: the engine already interpolated remotes through
  the two-snapshot SnapBuf (same as the enemy) — the pass verified the plumbing end-to-end and
  fixed the one gap: the dead-spectate camera followed raw 20 Hz positions and stuttered; it
  now samples the same buffers (shared INTERP_DELAY_MS).
- **5 new salvage items** (items.ts + items3d + loot.test.ts): Gumball Machine (fragile),
  Velvet Painting (fragile panel), Cuckoo Clock (noisy+fragile, new mesh builder), Payphone
  (twoHandle, dangling handset detail), Queen Mattress (twoHandle, deliberately low value —
  the "why did we grab this" haul). Economy drift −1 to −3.8% planValue; quotas stay payable
  by construction (300-seed sweep). mission.test's heavy-exclusion list extended.
- **The loot change flushed out a REAL gameplay bug in tryGrab**: for one-handed items the
  handle was assigned BEFORE the range/LOS checks — a grab from too far (or through a wall)
  was rejected AFTER setting `h0`, bricking the item (`state=0` + `h0` occupied rejects
  everyone forever). Grab-spam near a doorway bricked loot in real play. Fix: all rejection
  checks run before any mutation; pinned by a new carry.test assertion (rejected grab leaves
  h0 empty AND the item is still grabbable up close). The test harness also got a
  `walkAndGrab` helper (live-position re-reads + adjacent approach + opportunistic grab) —
  the old single-walk single-grab pattern was drift- and LOS-fragile.
- Verification (2026-11-06): tsc ×3 clean; server vitest **47/47** (15 files, loot tests
  included); full Playwright e2e **6/6**. Visual gate (new meshes) + audio balance need
  human eyes/ears.

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
