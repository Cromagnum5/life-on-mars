# Session handoff

## Current checkpoint

Branch `three-swords-then-a-hurler`, clean tree, two commits ahead of `main`:
`5e2b8c5` (`Send the swords out three at a time`) and `d661abb` (`Give the
hurlers a building of their own`). `main` is at `ac71199` and is 4 commits ahead of `origin/main`;
nothing is pushed, and both merging and pushing are the user's call.

Earlier session commits, oldest first:

- `e71fb45` Add a Rigwalker that throws rocks
- `23db02c` Throw the rock overhand
- `d76b50e` Send the swords out in pairs, the hurler alone

The first two are one thread. The throws shipped sidearm and were rebuilt
overhand a session later, which turned up a bug that had been quietly wrong the
whole time: the Blender tools were posing in Blender's Euler order rather than
Three.js's, so they had been validating and drawing poses the game never
rendered. Read `e71fb45`'s measurements with that in mind.

Production is now split across two buildings per corporation. The Assembly Bay
opens every 20 seconds and sends out three swords abreast; the new **Stoneworks**
opens on its own 20-second timer and sends out one Hurler. `SWORD_ORDER` and
`HURLER_ORDER` in `production.ts` are the whole of it; `production.test.ts` pins
each order, the cadence, and that a trio walks clear of the door instead of
jamming it, and `buildings.test.ts` pins the base layout.

Each producing building selects on its own, shows its own ring, and keeps its
own rally point. All four start rallying to the middle of the map; right-click
with one selected moves only that building's rally point. Note the throughput
change that follows from the user's brief: the mix is still three swords to a
rock, but both doors run at once, so units arrive twice as fast as they did when
one door alternated.

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

All three throws are overhand, the way a baseball is thrown: the rock gathers
back and low, the elbow leads it up above the shoulder, the hand comes over the
top and lets go out in front and high, and the arm rides down across the body.
They differ in how much of the fighter goes into it. The body is driven by four
beats (draw, stride, whip, follow); the arm is keyed, for the reason below.

- **hurl** — full body. A coiled torso, left arm pointing out at the target,
  front foot striding, hips opening ahead of the shoulders, arm slinging over
  last. Releases at 3.88 m, roughly a metre above the head.
- **pitch** — off a planted stance. Half the coil, no stride, no aiming arm.
- **toss** — a dart. The arm is up and gone before the body has moved.

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

Final geometry: release heights 3.88 / 3.71 / 3.46 m, all of them above the
head, foot drift under 0.19 m, recovery error 0.0 degrees. The sword duel still
validates at 0.069 m drift and 0.00 degrees.

### Why the arm is keyed and the body is not

The first version of these throws summed beat coefficients for every bone,
including the throwing arm, and read as sidearm. Two things were wrong, and
both are the kind that measure clean and look wrong:

1. **Blender's Euler `XYZ` is not Three.js's.** Three.js composes its default
   XYZ as `qx*qy*qz`; Blender calls that order `ZYX`. Every Blender tool here
   was posing with Blender's `'XYZ'`, so any bone with two non-zero angles —
   which is every shoulder in a throw — was measured and rendered in a pose the
   game never drew. All three tools now pose with `'ZYX'`.
2. **A sum of beats cannot trace this arc.** On this rig the arm is only above
   shoulder height through a narrow band of shoulder angles. Blending from a
   cocked pose to a released one walks straight out of that band in between:
   halfway through, the arm is hanging at the hip with the elbow below the
   shoulder, and the throw reads as a sling round the side however good the two
   end poses are. `THROW_ARM_KEYS` places poses along the arc instead, each one
   solved against the imported skeleton for a written-down hand *and elbow*
   position. Constraining the elbow is the part that matters: the hand alone can
   be put in the right place by an arm wrapped any number of ways.

The tool now checks the arc rather than the release pose — the rock has to clear
the head, and once it is above the shoulder the elbow has to stay above it too,
sampled every hundredth of a phase because the dropped-elbow dip lives between
two good keys and a coarse sweep steps over it.

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
2. Hurlers can now be held back: the Stoneworks has its own rally point, so a
   line behind the swords is a right-click rather than a code change. Whether
   the default of everything rallying to the middle wants changing is a
   playtest question.
3. A hurler that runs out of room has nowhere to go; it backpedals into whatever
   is behind it. Retreating toward its own side would read better than
   retreating in a straight line.
4. Earlier items still open: scorch decals under wrecks, encirclement positions
   for group fights, and trails reading white-hot over bright ground.
