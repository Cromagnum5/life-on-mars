# Session handoff

## Current checkpoint

The Rigwalker combat plan is complete and the working tree was clean at commit
`eb99c0d` (`Expand Rigwalker combat validation`).

Production remains set to one Rigwalker every 20 seconds.

Run these checks after future combat changes:

```sh
npm test
npm run build
blender --background --python tools/render_rigwalker_duel.py
```

The Vite warning about the core Three.js chunk exceeding 500 kB is known and
non-blocking.

## Combat implementation

- `src/combat.ts` owns combat planning, targeting, exchanges, damage outcomes,
  persistent temperaments, tactical memory, and group-support assignments.
- `src/rigwalker.ts` owns presentation: movement cues, imported-skeleton
  procedural poses, attack lines, guards, blocks, hit reactions, recoil,
  health bars, and animation blending.
- `src/main.ts` creates combat snapshots, applies damage events, and passes
  combat cues into each Rigwalker.
- `src/combat.test.ts` contains deterministic duel and 3v3 simulation coverage.
- `tools/render_rigwalker_duel.py` imports the shipped GLB and renders a
  multi-frame, three-angle duel review.

## Implemented behavior

- Persistent bold, reactive, patient, and adaptive temperaments.
- Random opening plans including rushes, reaction waits, extended sizing-up,
  feints, beats, distance traps, and ripostes.
- Plans adapt to health, opponent health, tactical memory, and recent strategy.
- Only swinging/club-like attacks are used; no stabbing vocabulary or attacks.
- Blocks prevent damage, glancing outcomes reduce it, and clean hits apply full
  reaction intensity.
- Distinct overhead, forehand, backhand, flank, and rising choreography.
- Deflected attackers recoil; struck defenders visibly react.
- Units help threatened teammates and support existing engagements.
- A target accepts one primary opponent plus at most two support attackers.
- Survivors promote/retarget correctly after an opponent dies.
- Stale combat state is removed for units no longer present.
- Health is visible to opponents through combat snapshots and to players via
  world-space bars/HUD.

## Validation details

The duel renderer must transform every imported GLB top-level object through a
shared actor root. Rotating only the armature can leave visible meshes facing
the wrong direction.

Automated imported-GLB validation currently checks:

- Visible facing from the visor-to-backpack vector at multiple approach and
  combat frames. A non-positive opponent-facing dot product fails.
- `Broadsword` is bone-parented to `weapon.R`.
- `weapon.R` is directly parented to `hand.R`.
- Maximum sampled foot-height drift stays below 0.18 m.
- Recovery stays within 0.08 radians of the ready pose.

Last measured result:

- Maximum foot drift: 0.069 m.
- Maximum recovery error: 0.00 degrees.
- All 13 tests passed.
- Production build passed.

Rendered review files are temporary:

- `/tmp/life-on-mars-animation-review/`
- `/tmp/life-on-mars-combat-contact-sheet.png`

## Relevant commit sequence

- `0dcf327` Add distinct Rigwalker combat temperaments
- `1da20ee` Add teammate-aware group combat
- `10a1678` Deepen tactical combat exchanges
- `ce9f3d6` Add line-specific combat choreography
- `fa06454` Harden long-running group combat
- `5f10e63` Validate Rigwalker duel facing
- `eb99c0d` Expand Rigwalker combat validation

## Suggested next-session approach

Playtest before expanding the system. Likely useful tuning targets are exchange
tempo, block frequency, crowd readability, and whether support attackers leave
enough visual space around a target. Preserve the present architecture and
measure a specific problem before adding navigation or performance systems.
