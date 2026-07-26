# Session handoff

## Current checkpoint

Branch `rigwalker-hurler`, off `main` at `c644c70`. The whole session is one
feature: a second Rigwalker that throws rocks. Nothing is pushed; merging and
pushing are the user's call.

Production remains one Rigwalker every 20 seconds, and every third one off the
line is now a Hurler.

Run these checks after further combat changes:

```sh
npm test
npm run build
blender --background --python tools/render_rigwalker_duel.py
blender --background --python tools/render_rigwalker_throw.py
npm run dev   # then tools/capture_sim.sh /tmp/sheet "1h v 1" 3 2 5 8 11
```

The Vite warning about the shared `world` chunk exceeding 500 kB is known and
non-blocking.

## What the Hurler is

A ranged unit on the same skeleton, with no sword, a rock in its hand and a
cache of them on its hip. It picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 26 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | inside sword reach, 4.3 m | 11 m/s | 8 | 0.30 s |

Both derived ranges come from constants rather than being typed in, so moving
`ATTACK_RANGE` or rebuilding the model moves them. `AGENTS.md` has the full
rules; the short version is that it is deadliest at the top of its range, that
the range it is at picks its throw, and that it is walked down through all three
by anything that closes on it.

## The animations, and how they were got right

Three throws, each a different way of getting a rock moving, driven by the same
four beats (draw, stride, whip, follow) with different timings and amplitudes:

- **hurl** — full body. Rock drawn back past the ear over a coiled torso, left
  arm pointing out at the target, front foot striding, hips opening ahead of the
  shoulders, arm slinging over the top with the wrist last.
- **pitch** — arm and shoulder only, off a planted stance. Half the coil, no
  stride, no aiming arm.
- **toss** — a flick from the hip. Elbow and wrist, underhand, weight centred.

None of this was written from first principles. The bone axes were **measured**
first, one rotation at a time on the imported GLB, because the Z-up to Y-up
conversion moves them and the Euler order means a shoulder's abduction changes
what its elevation does. Those signs are in the comment above `applyThrowPose`.

`tools/render_rigwalker_throw.py` then measured and rendered every version.
Everything it currently checks, it caught at least once:

1. Feet a metre and a half off the ground, because the follow-through was
   pitching the whole body about the ankles instead of bending at the waist.
2. The rock releasing *below* where the pitch releases, because the whip had
   already carried the arm down by the release phase.
3. The arm finishing above the head after release rather than sweeping down
   across the body.
4. A toss that read as dropping the rock by its knee rather than flicking it.
5. The body folded double in the follow-through.
6. Contact sheets that were all correct and all showed a unit standing still,
   because Blender re-applies the GLB's own actions on every render. Clearing
   the animation data is the fix, and the tool now does it.

Final geometry: release heights 2.81 / 2.51 / 1.65 m (overhand, three-quarter,
underhand), foot drift under 0.31 m, recovery error 0.0 degrees. The sword duel
still validates unchanged at 0.069 m drift and 0.00 degrees.

## Architecture notes worth preserving

Everything in the previous handoff still holds. Added by this session:

- **The strike is resolved at release, replayed on arrival.** The `throw` event
  carries speed, flight time, and the already-rolled outcome, so presentation
  launches a rock that lands on the frame the director applies the damage. The
  exchange's recovery is stretched to outlast the flight so it cannot re-plan
  out from under a rock still in the air.
- **A hurler is never a mutual duellist.** One-sided `ranged` encounters, never
  promoted, never riposting. A swordsman attacking one takes a normal support
  encounter and does *not* defer to it — a hurler is permanently mid-throw at
  someone else, and deferring to that left swordsmen watching it work.
- **Being hit outranks what you were planning.** Several encounters can write a
  cue for one fighter in a frame; `writeCue` stops a landed blow being lost to
  whichever encounter happened to be iterated last.
- **Rock size and arc are drawn from the rendered result, not from physics.**
  All three throws are far harder than their distance needs, so honest
  ballistics gives three flat lines; looping the slow ones is what makes the
  speed difference visible.

## Measured state

- Long range out-damages medium by more than a fifth, and medium out-damages
  short by the same, across eight seeds at thirty seconds each.
- `1h v 1` seed 3: hurler opens at 11.9 m, lands two hurls and a run of pitches
  and tosses, is closed on and killed at 13.8 s. That is the intended shape.
- `2h v 3` the swords win; `2h+2 v 4` is still a heavy fight at 30 s.
- 51 tests pass; production build passes.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **This has not been played or heard yet.** The release currently reuses the
   sword's `swing` whoosh, graded by throw. A heave and a rock landing may want
   their own voices — but the standing lesson is that a fight wants its sound
   spent on contact, so add carefully.
2. Hurlers rally to the same point as everything else, so in the game they walk
   into melee rather than holding a line behind it.
3. A hurler that runs out of room has nowhere to go; it backpedals into whatever
   is behind it. Retreating toward its own side would read better than
   retreating in a straight line.
4. Earlier items still open: scorch decals under wrecks, encirclement positions
   for group fights, and trails reading white-hot over bright ground.
