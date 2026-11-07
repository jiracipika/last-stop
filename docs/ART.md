# LAST STOP — Art Direction & Improvement Backlog

Direction: **"A forgotten roadside motel at 2 a.m., seen by an underpaid recovery crew."**
Stylized industrial horror — chunky silhouettes, weathered surfaces, believable scale, warm van
against a cold, increasingly uncomfortable motel.

## Palette tokens

| Token | Hex | Use |
|---|---|---|
| asphalt blue | `#18232B` | lot ground, night fog base |
| faded motel teal | `#477D78` | garage paint, trim, vinyl tiles |
| dirty cream | `#C6B99B` | motel plaster, van body, markings |
| rust orange | `#A55235` | wear, drums, cones, boiler |
| van tungsten | `#E6AD61` | van light, sign, porch bulbs |
| warning red | `#B63D35` | maintenance light, EXIT, taillights |

Lighting contrast rule: **warm = safety (van, sign, porch lights), cold = the building's interior
(fluorescents), red = hazard (maintenance, exit signage).** The lot between them is contested.

## Baseline audit (2026-11-05, verified from screenshots + renderer stats)

Evidence: `screenshots/baseline/` (9 fixed poses, deterministic via dev photo mode),
SwiftShader headless ~25 fps, 72 draw calls idle / 180 walking, **2 textures in the entire
renderer** (motel sign canvas + one name sprite). Vision-model audit + code read agree:

1. **Interiors are functionally unlit** — corridor, garage, reception, back rooms are
   near-black voids. There are zero interior light sources in the code. Severity: critical.
2. **Zero material identity** — every surface is a flat untextured Lambert. Graybox fidelity. Critical.
3. **No landmark hierarchy** — the motel facade merges with the sky; the PALE LANTERN sign
   (the one landmark) is dimmer than the parking-lot lamps. High.
4. **Ground is a black plane** — no asphalt read, parking lines invisible, no light pools
   in interiors. High.
5. **The van (hero object) is an untextured lump** — no branding, no windows response. High.
6. **No room identity** — identical doors, no room numbers, no fluorescent fixtures (the
   genre's iconography). Medium-high.
7. **No motion anywhere** — nothing sways, flickers, or drifts; the night feels dead, not
   tense. Medium.
8. **Title screen was DOM-only** — no in-engine composition. Medium (backlog). SHIPPED 2026-11-06: attract-mode backdrop.
9. **HUD praised by the audit** ("strongest part of the frame") — leave mostly alone. —

## Backlog (priority order; each item = one reviewable slice)

SHIPPED (2026-11-05 → 2026-11-07): texture pipeline + lighting + landmarks (slice 1);
van presentation; hiding in junkers + dumpster + hats; junker geometry; Caretaker lantern
pool + footsteps/clinks/drag; debrief shift-report + real survival data + first e2e
screenshot of results; static-geometry merge (380 → 184 draw calls); stop-slide + sprint
FOV + view-bob + bump thuds (carrying dead-stops: leash); spotted/lost/investigate/windup
cues; chaseSid over the wire (targeted-you sting + toast); RAISED TARGETS / AMPED UP /
STORM CELL modifiers (rain, lightning, delayed thunder); in-engine attract-mode title +
quality presets + PERSONNEL FILE bests + briefing sheet; netcode smoothing (predictor
parity, decaying reconcile, 30 Hz patches); hide-spot dome lights + flush doors;
success pull-away end-beat + escape compass + latency chip; late crew (mid-shift joins,
van-side spawn, ?code= invite links).

| # | Slice | Severity | Player impact | Effort | Acceptance |
|---|---|---|---|---|---|
| 1 | Human playtest pass: feel constants (bob amp, FOV kick, coast, bump threshold, storm flash peak, lostYou floor) + hide/fairness feel + pull-away beat | high | everything tuned by math gets ears/eyes | S (review) | playtest notes → constant tweaks → one regression gate |
| 2 | Second enemy or second map | high | replay variety | L | mission-flow tests + e2e for the new content |
| 3 | Progression/economy (shift streaks, van upgrades) | medium | retention | L | server tests + results-screen surfacing |
| 4 | Modifier balance: DONE in first pass (SEVERITY_CAP 1.9 draw cap, docs/BALANCE.md) — residual: re-verify the guessed weights (blackout 1.1, fragile 1.25) against real play | low | fairness | S | playtest notes on hard stacks |
| 5 | Remote-player smoothing residuals (pstep gains need ears) + per-preset bench rerun on a quiet box | medium | smooth others | M | route benchmark numbers per preset |
| 6 | Full regression + balance pass | — | ship quality | M | all suites green |

Deferred (per direction): voice chat, progression economy details.

## Asset provenance

All world materials are **original procedural canvas textures**, generated deterministically
(`mulberry32` seed constants) at runtime by `apps/web/src/game/textures.ts` — no external
image assets, no runtime hotlinks, nothing to license. See the manifest at the bottom of this
file. Normal/roughness maps are NOT faked from color output; materials stay Lambert (vertex
lit) by design for the low-poly look and SwiftShader floor.

## Manifest (procedural set, slice 1)

All generated at runtime by `apps/web/src/game/textures.ts` with the seeds below (512×512
unless noted). Tiles at consistent world scale: floors 4 m/tile, walls ~4 m/tile horizontally
(full wall height vertically), roofs 2 m/tile.

| Material | Size | Seed | Notes |
|---|---|---|---|
| asphalt | 512 | 0xa51 | aggregate speckle, cracks, tar patches; stall lines are geometry |
| gravel | 512 | 0x9a7e1 | stones over dirt, west yard + east alley |
| plaster | 512 | 0x91a57 | dirty cream, mid-freq weathering blotches, drips, brighter-teal wainscot + cream cap at wall base |
| garageSteel | 512 | 0x57ee1 | teal cinderblock coursing, edge wear, sparse rust |
| concrete | 512 | 0xc0c | pores, damp patches, cracks (back rooms, garage floor, walkway) |
| vinyl | 512 | 0x711 | aged checker tile, stained/missing tiles (front rooms, entry, corridor) |
| carpet | 512 | 0xca4 | two-tone noise, blotch stains |
| wood | 512 | 0xd00 | vertical grain, chips (doors, furniture, rail) |
| corrugated | 512 | 0x40f | seam stripes, rust streaks (roofs) |
| metalWorn | 512 | 0x7e7 | worn painted steel (shelves, gate, drums, poles, washer) |
| vanPaint | 512 | 0xa17 | cream + teal sweep, scratches, rust rocker |
| junkerTeal | 512 | 0x2ea7 | faded teal sedan paint: sun-bleach, 11 rust streaks, rust blooms, rocker grime (front-yard junker + its door) |
| primerCar | 512 | 0x5b21 | brown/grey primer blotches, key scratches, rust spots (south-fence junker + its lid) |
| oil stain decals | 256 | per-position | radial blobs, garage/lot/car |
| room numbers 1–4 | 128 | — | cream plates on front doors |
| corridor plates | 256 | — | teal LAUNDRY/MAINT/BOILER/STORAGE |
| PALE LANTERN sign | 256×512 | — | tungsten letters (dead A + T), NO VACANCY strip |
| DUSTPAN livery | 512 | — | "DUSTPAN RECOVERY / WE TOW REGRETS" both flanks |
| light pools | 256 | — | additive radial gradients (lamps, porches, headlights, entry spill) |

## Slice 1 results (2026-11-06)

- Corridor: "properly art-directed" (vision-model audit); garage: "lit workshop"; sign verified
  letter-by-letter as PALE / LANTERN with intentional dead letters; lamp/porch pools visible.
- Perf (SwiftShader headless, 1280×800): ~20 fps (was ~25 pre-ACES/textures), draw calls
  ~100–160 in normal play / ~330 at the wide overview pose (was 72) — static-geometry merging
  is backlog item 6.
- Residual, accepted for now: exterior facade texture reads mostly flat beyond ~15 m — night
  grade + fog crush it by design; sign + porch lights + windows carry the facade at range.
  Title screen: shipped 2026-11-06 as the in-engine attract-mode backdrop (auto-playing lot
  camera behind the clipboard).

