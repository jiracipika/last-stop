# Entity and vehicle overhaul

This change preserves the motel's procedural horror-comedy style and the existing co-op mission loop. It improves the interactions and enemy behavior that players depend on during a run.

## Vehicle interactions

- Rear doors swing outward, with elapsed-time smoothing. The van is a hollow shell with a lit cargo bay, rather than a solid box hidden behind animated doors. The spare tire moves with its door.
- The driver can board from the advertised cab-side point while cargo doors are closed. Explicit driver entry from the open rear remains compatible with older clients.
- Passenger boarding reserves seats 2–4; it cannot silently assign the driver role.
- Aiming at the open rear bay boards as a passenger; aiming at the left rear hinge closes the doors. Headlight controls move to the front, away from the driver-seat target.
- Interaction prompts use the server's ranges. Hiding spots reject a second occupant, and occupied spots no longer offer another hide prompt.
- Wheels turn around their axles using distance traveled. Loose cargo only jiggles while moving.

## Enemy and entity behavior

- Fixed an inverted movement-blocking test: unobstructed movement used to trigger the enemy's stuck-recovery teleport.
- Walls and closed doors block melee contact. Closing a door during the windup can prevent the hit.
- An attack commits to its target through the windup and enters one protected recovery window after contact. Vision and noise cannot immediately cancel recovery.
- Door-forcing approaches obey collision. Mission replay resets attack, sight, search, forcing and navigation timers.
- Shared heavy cargo renders between both carriers, using their rendered hold positions.
- New item meshes start at their spawn instead of gliding from the origin. Reused item IDs rebuild their mesh when the catalog definition changes on replay.
- Damage darkens original material colors instead of repainting every surface the same color; recalculation only happens when damage changes.
- First-person character geometry is hidden while its flashlight stays active. Remote flashlights aim in the avatar's local frame, preventing double yaw rotation.
- Seated cameras share the van's interpolated pose. Avatar and enemy animation transforms reset between states, and entity resources are released when removed or when leaving a room.
- The client waits for its full initial room state before exposing it to the renderer. This avoids a room-entry race that could stop the frame loop and leave an empty lobby.

## Readability

A compact mission card names the next action and the appropriate control. Nearby attacks and door forcing have text cues as well as animation/audio. Item pickup prompts display LMB, matching the actual binding.

Animation timing follows the elapsed-time approach documented in the current [Three.js MathUtils reference](https://threejs.org/docs/pages/MathUtils.html). Combat changes apply the telegraph/action/recovery readability principle discussed in the [GDC Rules of the Game presentation](https://media.gdcvault.com/gdc2016/Presentations/Rouse_Richard_RulesOfTheGame.pdf).

## Review and playtest

Automated coverage includes targeted server regressions and browser tests that walk to the van using the normal client/server input pipeline, open its doors, check that the bay is unobstructed, board as passenger, and board at the cab with cargo doors closed. Existing mission, multiplayer, carrying, reconnect and anti-cheat tests remain part of validation.

Human playtesting should still cover four players under real network latency, audio balance, and performance on integrated graphics. These changes do not deploy either the frontend or the authoritative server.
