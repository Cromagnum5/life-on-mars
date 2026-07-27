# Session handoff

## Current checkpoint

`settle-at-the-waypoint` at `1a209c3` (`Decide crowding with a band, not a
line`), clean tree, **not merged**. It branches from `main` at `40b02fa` and is
2 commits ahead of it. `main` is 8 commits ahead of `origin/main`; nothing is
pushed, and both merging and pushing are the user's call.

This session's commits, oldest first:

- `a53267c` Let a crowd settle at the waypoint
- `1a209c3` Decide crowding with a band, not a line

Both came from playtest reports about movement rather than from planned work,
and both are written up under **Crowds and waypoints** below. Neither touches
combat animation, the production cadence, or the camera.

Earlier session commits, oldest first:

- `e71fb45` Add a Rigwalker that throws rocks
- `23db02c` Throw the rock overhand
- `d76b50e` Send the swords out in pairs, the hurler alone
- `5e2b8c5` Send the swords out three at a time
- `d661abb` Give the hurlers a building of their own

The first two are one thread. The throws shipped sidearm and were rebuilt
overhand a session later, which turned up a bug that had been quietly wrong the
whole time: the Blender tools were posing in Blender's Euler order rather than
Three.js's, so they had been validating and drawing poses the game never
rendered. Read `e71fb45`'s measurements with that in mind.

Production is split across two buildings per corporation. The Assembly Bay
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

## Crowds and waypoints

Two playtest reports, three defects, one recurring shape. `AGENTS.md` has the
rules under **Arriving at a waypoint** and **Hysteresis, or the stutter step**;
this is what was actually wrong and how it was found.

**"Units returning to the waypoint cannot settle down after combat ends."**
Arrival was an exact test: within 8 cm of the destination. But every unit a
building makes is sent to that building's *one* rally point, and the positional
clearance floor holds units 1.15 m apart, so only the first unit could ever
satisfy it. Everyone else pressed into a point they were being held off, for as
long as the game ran. A fight makes it visible because it puts a whole group
back on the road at once. Reproduced before touching anything: six units sent to
one rally point were still collectively walking 1.07 m/s twenty seconds later.

Arrival is now also "stopped": no ground made up for `CROWD_ARRIVAL_SECONDS`,
somebody within `CROWD_BLOCK_DISTANCE` between the unit and the point, **and**
enough bodies already nearer the point to fill the ground still to cover. That
last clause is the one that matters and the one to leave alone. Without it — the
first version — a bay's trio walking abreast converges, funnels, loses a
moment's ground with a neighbour alongside, and two of the three quit 8.6 m
short. `production.test.ts` caught it. Bodies pack about a clearance apart, so
the ground arrived units cover grows with the root of their number; comparing
that against the distance left is what tells a full rally point from a busy one.

**"A unit stutter-steps at a crowd of its team; the ring flashes rapidly."**
Two independent causes, found by running the real game loop headless for three
minutes — four producing buildings, both corporations — and counting how often
each unit changed its mind.

1. *The ring.* A plan event draws an accent ring under the fighter, so a strobe
   means an encounter churning. `ACQUIRE_SLACK` and the drop range were both
   1.35, which for a hurler is the same 21.71 m for both: sitting on that line
   it took the same encounter, lost it, and took it again — 626 plan events in
   20 s on the bench, while standing still and never throwing. `ACQUIRE_SLACK`
   is now 1.15 and the drop multiplier is a named `RELEASE_SLACK`. Hurlers
   consequently start their approach at 18.5 m rather than 21.7 m.
2. *The step.* Unrelated to combat. A standing unit drifted away from neighbours
   whenever one crowding threshold was crossed, so a unit sitting on that line
   started and stopped walking every frame, permanently half-blended through the
   0.16 s crossfade into the walk clip. It now steps at `SEPARATION_NUDGE` and
   keeps stepping until `SEPARATION_CLEAR`.

**Left deliberately alone.** A hurler at point-blank re-plans about every 0.68 s
because `toss` is a 0.30 s throw, against a 0.38 s ring. That is a busy ring, but
it is throwing a rock each time rather than churning. If the user reports the
flash again on a hurler with a swordsman on top of it, that is the cadence and a
tuning call, not this bug.

**How to look for more of these.** The shape recurs: anything decided by testing
one threshold against neighbours every frame will be decided both ways at frame
rate, because a crowd is never quite still. The headless soak is worth
rebuilding when hunting one — production plus `CombatDirector` plus
`unit.update`, no rendering, counting plan events per second and walk-state
flips per unit. It is what turned both of these up in one run, and neither was
visible in a two-unit test.

## What the Hurler is

A ranged unit on the same skeleton, with no sword, a rock in its hand and a
cache of them on its hip. It picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
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
- Crowds of 2 through 20 sent to one waypoint go completely still about 3.1 s
  after arriving — 0.000 m of movement in the final second — at a minimum gap of
  1.22 m. Post-fight survivors settle across four seeds.
- A bay's trio still walks the full distance and settles at 0.21 / 1.75 / 2.22 m
  from its rally point. That spread is the fix working, not units falling short.
- Over a three-minute headless soak: out-of-combat walk-state flips fell from
  579 to 106 and the sustained per-frame strobing is gone; in-combat shuffling
  is unchanged (2350 → 2302), which is fighters working rather than stuttering.
- 64 tests pass; production build passes. Both new regression tests were
  confirmed to fail when their fix is reverted.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **This session's movement work needs playing.** Both fixes are measured, but
   what cannot be measured from here is whether a crowd resting in a loose blob
   *around* its rally point rather than on it reads right at gameplay scale, and
   whether 0.45 s of stalling before a unit gives up looks like a decision or
   like hesitation. `CROWD_ARRIVAL_SECONDS`, `CROWD_BLOCK_DISTANCE`,
   `SEPARATION_NUDGE` and `SEPARATION_CLEAR` are all at the top of
   `rigwalker.ts` if they want moving.
2. **The throws have not been heard.** The release reuses the sword's `swing`
   whoosh, graded by throw. A heave and a rock landing may want their own voices
   — but the standing lesson is that a fight wants its sound spent on contact,
   so add carefully.
3. Hurlers can be held back: the Stoneworks has its own rally point, so a line
   behind the swords is a right-click rather than a code change. Whether the
   default of everything rallying to the middle wants changing is a playtest
   question — and note that default is what makes the rally-point crowd, so it
   is also what this session's first fix was exercising.
4. A hurler that runs out of room has nowhere to go; it backpedals into whatever
   is behind it. Retreating toward its own side would read better than
   retreating in a straight line.
5. Earlier items still open: scorch decals under wrecks, encirclement positions
   for group fights, and trails reading white-hot over bright ground.
