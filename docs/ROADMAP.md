# LAST STOP — roadmap to the beginner-friendliest version

Working backward from "a brand-new player reaches the site, understands the job in
under a minute, and finishes a first shift with friends." Each stage is scoped to
land independently behind the stage before it. Acceptance checks are things we can
actually run (vitest / e2e / a browser probe) — not vibes.

## Where we are (2026-11-19)

Already shipped (by the night-shift-overhaul PR #13 + this pass):

- **Wardrobe that replicates** — outfit editor in the crew room (color, headgear,
  and now nickname): one Save sends a validated `act: profile` (lobby + results
  only, colors unique per crew, 0.15 s rate) and every client rebuilds that
  player's avatar mesh — textured uniforms bake color/headgear/nametag at build.
- **Input comfort** — game keys only act while pointer-locked (typing in overlay
  fields is safe), held keys flush on blur/unlock, no delayed cursor warp.
- **First-shift onboarding (this pass)** — "First night? Here's the job" opens on
  the title screen and "How a shift goes" in the crew room for first-timers;
  dismissing either remembers the choice (`prefs.seenHowto`).

**Acceptance for this pass:** profile.test.ts over the wire (restyle lands on
other clients, taken color rejected, look locks once the shift is live, nickname
trim/cap/never-blank), wardrobe e2e in two real browsers, typecheck + build clean.

## Stage 1 — Practice shift (solo tutorial, no risk)

The single biggest beginner wall: your first Caretaker encounter shouldn't be in a
live crew shift.

- Solo host already gets "(solo practice)" on the start button — formalize it:
  a **practice modifier set** (calm Caretaker: slower, smaller hearing radius,
  no chase-lock), quota 0, and a results screen that says "practice" instead of
  scoring a loss.
- Scripted hint captions on first-time events: first door ("doors bang — The
  Caretaker hears"), first carry, first hide, first enemy sighting ("break line
  of sight, don't sprint"), quota met, part found.
- Server: `practice: true` create-option (host-only) that swaps the modifier draw
  and stamps `practice` on results rows. No client trust — the room decides.

**Accept when:** e2e drives a solo practice room and asserts the hint captions fire
in order and the results header reads PRACTICE; vitest pins that a practice room
never draws AMPED UP / LIGHT SLEEPER.

## Stage 2 — Cosmetics that mean something

Wardrobe exists; make the look worth keeping.

- **Persistent crew identity**: server-side profile per room is ephemeral — add
  a shareable "crew card" (name + look + best shift) string to paste in invites.
- **Unlockables**: shift earnings already exist — spend on cosmetics (new hats 5+:
  cowboy, welding mask, visor; jacket trims; van paint jobs). Gated per-player in
  prefs to start (no economy server), displayed to everyone via the existing
  color/hat schema fields (extend `hat` range + a `trim` field).
- **Portrait in HUD**: teammate rows get the portrait chip (lobby parity).

**Accept when:** two browsers see an unlocked hat render on the other's avatar
(mesh rebuild path already proven); e2e asserts the wardrobe shows locked/unlocked
states; no schema break with old clients (fields default).

## Stage 3 — Menu overhaul v3 (five-minute fun)

- **Landing**: one primary button ("Play with friends" → create/join flow), a
  "Practice alone" secondary, "How it plays" behind a 20-second looping attract
  clip (the attract renderer already exists — record/repurpose it).
- **Room flow**: the code + invite link front and center after create; role hints
  ("you're the host — start when everyone's ready" exists; keep polishing).
- **Settings discoverability**: gear icon on the title (currently only in pause).
- Mobile/tablet notice → offer a spectator link ("watch the crew") if WebGL input
  is impossible, instead of a dead end.

**Accept when:** a fresh browser profile goes URL → in-lobby in 2 clicks; e2e
asserts the new CTA order; the old `.roster`, `.ready`, room-code classes keep
their contracts (existing specs stay green unmodified).

## Stage 4 — Reliability & netcode comfort

- **Reconnect UX**: the grace window works but is invisible — add a
  "reconnecting…" full-screen state (client `status === "reconnecting"` exists)
  with a countdown and a "back to title" escape hatch.
- **Late-join funnel**: joining mid-shift drops you at the gate with no context —
  show a 3-line catch-up card ("quota 3/5, part missing, 4 min left") on join.
- **Server capacity surface**: `LS_MAX_ROOMS` rejects with a raw error today —
  serve a friendly "all lots are busy" toast and retry hint.
- Ambient e2e flake triage (the known loaded-box mode): split the two-browser
  specs into their own shard so single-browser suites stay signal.

**Accept when:** e2e kills the socket mid-scavenge and asserts the overlay +
auto-recovery; latejoin.spec asserts the catch-up card; capacity test asserts the
friendly error.

## Stage 5 — Depth without complexity (post-beginner)

Ranked "career" nights (modifier ladder), second map (the diner), proximity voice,
controller support. Only after stages 1–4 — these add surface area, and the whole
point is to subtract it for new players.

---

Priority order is the stage order; each stage is one PR-sized drop. The standing
rule from the codebase: every user-visible behavior lands with a test that fails
without it.
