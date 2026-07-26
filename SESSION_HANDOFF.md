# Session handoff

## Current checkpoint

Branch `combat-spectacle-pass`, on top of `2d317e2` (`Document combat effects
handoff`). Working tree has the combat sim and the readability pass described
below; nothing committed or pushed yet.

Production remains set to one Rigwalker every 20 seconds.

Run these checks after future combat changes:

```sh
npm test
npm run build
blender --background --python tools/render_rigwalker_duel.py
npm run dev   # then tools/capture_sim.sh /tmp/sheet 3v2 5 3 6 9 12
```

The Vite warning about the core Three.js chunk exceeding 500 kB is known and
non-blocking. It is now reported against the shared `world` chunk.

## The effects have now been seen

The previous handoff's first job was to look at the spark, flash, ring, and
trail work, which had never been rendered. It has been, through the combat sim
in headless Chromium (SwiftShader), and the results drove this session's
changes. See `AGENTS.md` for how to capture frames.

What looking at it revealed, in rough order of how badly each one hurt:

1. **Fighters stood inside each other.** Pairs settled around 1.9 m and crowds
   pressed to 0.8 m, so a duel rendered as one twitching blob. Two causes: the
   closing step ran at full speed on a deliberately stale distance reading and
   overshot, and steering separation is too weak to hold a crowd that is all
   pushing the same way. Fixed by clamping the closing step against the real
   gap and adding a positional clearance floor. `src/rigwalker.test.ts` pins it.
2. **The weapon trail was an opaque wedge.** It spanned the whole blade from
   the hilt across a full arc at near-full additive accent, covering the
   fighter swinging it. Now it starts past the middle of the blade, holds fewer
   samples, and fades quadratically from a leading edge well under 1.
3. **Sparks were too small to read** at RTS scale. Sized up by about 1.6×.
4. **Health bars floated over every unit at full HP**, competing with the
   sparks. They now appear only once a fighter is hurt, or on selection.
5. **Sword-side cuts landed behind the attacker.** At the moment of contact,
   `overhead`, `forehand`, and `flank` put the blade's percussion point 0.14 m
   *behind* the attacker and 2 m out to the side, with the opponent 2.9 m
   straight ahead, so the sparks appeared to come off the attacker's own
   shoulder. The impact wrist carried a hand-tuned per-side triple instead of
   mirroring with `attackSide` like the rest of the arm; every line now
   resolves with 1.8-2.6 m of reach toward the opponent. Found and fixed by
   measurement, with `contacts=1` in the sim.
6. **Corpses blinked out** at 2.5 s. They now lie for 3.4 s and sink into the
   dust over the last 0.8 s. Sinking rather than fading is deliberate: cloned
   GLB instances share materials, so fading one corpse would fade every unit.

## Plans are visible, and the keypad is on the shelf

A `plan` event fires whenever a fighter commits to a new exchange, alongside
the existing contact events. Presentation draws a small accent ring under the
fighter, which flashes often as a fight swings between plans and reads well.

It briefly played a telephone keypad tone per strategy as well, then briefly
kept one on the riposte alone. Playtesting rejected both: a fight wants its
sound spent on contact. Plans and ripostes are now silent, and their rings
carry them. The tones live in `audio.ts` behind `playKey` for menu and
interface sounds, with the strategy mapping kept so an interface can speak the
same vocabulary as the fighting:

| key | strategy | key | strategy |
| --- | --- | --- | --- |
| 1 | rush | 5 | distance-trap |
| 2 | react | 6 | beat |
| 3 | size-up | 7 | riposte |
| 4 | feint | | |

Ripostes keep announcing themselves through their own event, so they are not
also announced as plans, and they draw the larger ring. The tones are real DTMF
pairs, held flat and released rather than decayed, which is what makes them
read as a key press rather than a game blip. Combat now sounds only on contact:
swing, whiff, block, glance, hit, and defeat.

## Layout

- `src/world.ts` — terrain, rocks, atmosphere, lighting, camera, renderer.
- `src/battle.ts` — `BattleRuntime`: one frame of fighting end to end (plan,
  present, damage, pose, trail, cull). The game and the sim both drive it.
- `src/sim.ts` + `sim.html` + `src/sim.css` — the combat workbench.
- `src/combat.ts` — planning, targeting, exchanges, outcomes, temperaments,
  tactical memory, group support, and the discrete event stream.
- `src/rigwalker.ts` — presentation: movement, imported-skeleton poses, guards,
  blocks, reactions, health bars, blending, blade sampling.
- `src/effects.ts` — pooled sparks, flashes, rings, trails. No allocation in
  the update path.
- `src/audio.ts` — synthesized combat sound.
- `src/random.ts` — seeded PRNG, so a sim replays a fight.
- `tools/capture_sim.sh` — headless contact sheets from the sim.

## Architecture notes worth preserving

- **Cues carry phases, not fake elapsed times.** Do not reintroduce a duration
  constant in `rigwalker.ts`; the director owns real per-strategy durations.
- **Events, not edge detection.** `CombatFrame.events` exists so presentation
  never diffs per-frame cues. Tests pin this.
- **The blade's ends come from geometry, not assumed axes.** `sampleBlade`
  reads the bounding box and picks the tip by distance from the body.
- **The pipe is fallback-only.** Keep its choreography behind `pipePivot.visible`.
- **Stale readings decide, real distance constrains.** Combat spacing looks
  unrehearsed because fighters act on an out-of-date distance; it stays legible
  because the step is clamped against the true one. Keep those separate.

## Measured state

- Duels resolve in roughly 22 s on average across 200 seeded runs.
- Outcome mix is about 26% blocked, 10% glancing, 55% clean hits, 8% whiffs.
  `combat.test.ts` now guards the pace and the mix, since a vanishing outcome
  silently removes a whole read from combat.
- Blender validation: foot drift 0.069 m, recovery error 0.00 degrees.
- 32 tests pass; production build passes.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency (attack orders, focus fire) is still out of scope.

1. Both corporations still rally to the world origin, so fights happen by
   accident at the map centre rather than anywhere the player is looking.
2. A scorch decal under a wreck would give the battlefield stakes; the corpse
   currently sinks into unmarked ground.
3. Group fights all converge on the same face of a target. Supporting attackers
   have an angle cue but no assigned position around the target, so a 3v2 reads
   as a queue rather than an encirclement.
4. Trails read as white-hot rather than corporate-colored, because additive
   blending over bright ground washes out the accent. Vertex alpha with normal
   blending would keep the color if that matters.
