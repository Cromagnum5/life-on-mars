# Session handoff

## Current checkpoint

Branch `combat-spectacle-pass` at `f3778e1` (`Sharpen combat presentation with
sparks, sound, and trails`), branched from `main` at `3b89a55`. Not yet merged
to `main` and not pushed.

Production remains set to one Rigwalker every 20 seconds.

Run these checks after future combat changes:

```sh
npm test
npm run build
blender --background --python tools/render_rigwalker_duel.py
```

The Vite warning about the core Three.js chunk exceeding 500 kB is known and
non-blocking.

## Outstanding: the effects have never been seen

The spark, flash, ring, and weapon-trail work in `src/effects.ts` was written
and reasoned about but **never validated as a rendered result**. Browser
automation was unavailable in the session that wrote it, and the Blender duel
tool validates skeleton poses, not particles.

Reviewing the math instead caught four real bugs worth knowing about, since the
same class of error is likely to recur:

- Sparks were sized under 2 px. `gl_PointSize` for an orthographic camera needs
  an explicit world-to-pixel uniform; there is no perspective divide to rely on.
- That uniform must use the framebuffer height (`renderer.domElement.height`),
  not `window.innerHeight`, or a device pixel ratio above one halves everything.
- The trail tinted both `material.color` and its vertex colors, squaring the
  accent. The material stays white; the accent rides on vertex colors.
- Every `play()` leaked a `StereoPannerNode` connected to master.

**First job next session: open the game and look.** Spark counts, colors, trail
length, flash scale, and ring radius are all unverified guesses. Judge at RTS
viewing scale per `AGENTS.md`.

## Combat implementation

- `src/combat.ts` owns combat planning, targeting, exchanges, damage outcomes,
  persistent temperaments, tactical memory, group-support assignments, and the
  discrete event stream.
- `src/rigwalker.ts` owns presentation: movement cues, imported-skeleton
  procedural poses, guards, blocks, hit reactions, recoil, health bars,
  animation blending, and blade sampling in world space.
- `src/effects.ts` owns pooled sparks, flashes, ground rings, and weapon-trail
  ribbons. All preallocated; the update path does not allocate.
- `src/audio.ts` owns synthesized combat sound. No assets, no dependency.
- `src/main.ts` creates combat snapshots, applies damage, presents events as
  sparks and sound, and feeds trails.
- `src/combat.test.ts` and `src/effects.test.ts` carry deterministic coverage.
- `tools/render_rigwalker_duel.py` imports the shipped GLB and renders a
  multi-frame, three-angle duel review.

## Architecture notes worth preserving

- **Cues carry phases, not fake elapsed times.** An earlier design multiplied a
  cue phase by a constant and immediately divided by the same constant. Do not
  reintroduce a duration constant in `rigwalker.ts`; the director owns real
  per-strategy durations.
- **Events, not edge detection.** `CombatFrame.events` exists so presentation
  never has to diff per-frame cues. A swing that resolves inside one frame still
  produces exactly one spark and one sound. Tests pin this invariant.
- **The blade's ends come from geometry, not assumed axes.** The Blender
  cylinder is authored along local Z, but the glTF Z-up to Y-up conversion moves
  it. `sampleBlade` reads the bounding box and picks the tip by distance from
  the body.
- **The pipe is fallback-only.** `pipePivot` is rendered only when the GLB fails
  to load. Keep its choreography behind the `pipePivot.visible` guard.

## Implemented behavior

- Persistent bold, reactive, patient, and adaptive temperaments.
- Random opening plans including rushes, reaction waits, extended sizing-up,
  feints, beats, distance traps, and ripostes.
- Plans adapt to health, opponent health, tactical memory, and recent strategy.
- Only swinging/club-like attacks are used; no stabbing vocabulary or attacks.
- Blocks prevent damage, glancing outcomes reduce it, and clean hits apply full
  reaction intensity, each with a distinct spark, flash, and sound signature.
- Feints show a false line for the first 30% of the swing, visible as a
  mid-swing direction change in the weapon trail.
- Units help threatened teammates; a target accepts one primary opponent plus at
  most two support attackers.
- Survivors promote/retarget correctly after an opponent dies.
- Health is visible to opponents through combat snapshots and to players via
  world-space bars/HUD. The HUD reports temperament and current plan.

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
- All 28 tests passed.
- Production build passed.

Rendered review files are temporary:

- `/tmp/life-on-mars-animation-review/`
- `/tmp/life-on-mars-combat-contact-sheet.png`

## Relevant commit sequence

- `10a1678` Deepen tactical combat exchanges
- `ce9f3d6` Add line-specific combat choreography
- `fa06454` Harden long-running group combat
- `5f10e63` Validate Rigwalker duel facing
- `eb99c0d` Expand Rigwalker combat validation
- `8c59e74` Add Rigwalker balance controller
- `63fb5d8` Vary combat spacing and reactions
- `3b89a55` Fix death animation rotation wrap
- `f3778e1` Sharpen combat presentation with sparks, sound, and trails

## Suggested next-session approach

The stated goal is for combat to look cooler each iteration, not to become
playable. Player agency (attack orders, focus fire) is deliberately out of
scope.

1. Look at the running game and tune the effects. They are unverified.
2. Health bars render on every unit at full HP, competing with the new sparks.
   Hiding them until damaged or selected is a small readability win.
3. Corpses pop out of existence at 2.5 s with no fade. Persistent wrecks and a
   scorch decal would give the battlefield stakes.
4. Both corporations rally to the world origin, so fights happen by accident at
   the map centre rather than anywhere the player is looking.
