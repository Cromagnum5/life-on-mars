# Session handoff

## Current checkpoint

`main` at `b3e7f5b` (`Wind the hurl up like a spring`), clean tree, **merged**.
`settle-at-the-waypoint` has been fast-forwarded into it and is spent. `main` is
15 commits ahead of `origin/main`; nothing is pushed, and pushing is the user's
call.

This session's commits, oldest first — all one thread, the Hurler's long throw:

- `1946d35` Hurl with the whole body
- `705fb80` Judge a pose in the renderer that draws it
- `9a1fd1d` Stand a hurler like a thrower and let it drive off the back leg
- `b3e7f5b` Wind the hurl up like a spring

They came from playtest reports, and the middle one is the important one to read
first: it is a tooling commit that exists because the first commit was validated
against a renderer nobody was looking at. See **Which instrument to trust**.

Earlier session commits, oldest first:

- `e71fb45` Add a Rigwalker that throws rocks
- `23db02c` Throw the rock overhand
- `d76b50e` Send the swords out in pairs, the hurler alone
- `5e2b8c5` Send the swords out three at a time
- `d661abb` Give the hurlers a building of their own
- `a53267c` Let a crowd settle at the waypoint
- `1a209c3` Decide crowding with a band, not a line

Run these checks after further combat changes:

```sh
npm test
npm run build
blender --background --python tools/render_rigwalker_duel.py
blender --background --python tools/render_rigwalker_throw.py
npm run dev   # then see the capture recipes below
```

The Vite warning about the shared `world` chunk exceeding 500 kB is known and
non-blocking.

## Which instrument to trust

**Read this before touching a pose.** It is the main thing this session learnt
and it cost most of a session to learn.

`tools/render_rigwalker_throw.py` ports `applyThrowPose` onto the real GLB and
measures it. It stops there. The game then runs `applyBalancePose` on top —
a crouch, a lean, and recovery steps the tool knows nothing about. So the tool
is authoritative about **the arm**, and about what a throw *asks* the legs for.
It is not authoritative about where a foot lands on screen.

That gap is not academic: the tool passed a foot-drift check at 0.195 m while
the shipped rear foot was floating 0.41 m off the ground, and a whole commit's
worth of "validated" contact sheets showed a pose the game never drew.

For feet, weight, stance or silhouette, measure the renderer that draws it:

```sh
EXTRA='zoom=6&on=HR1&feet=1' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.62 1.95 3.00
```

- `on=HR1` rides one fighter by label. At a zoom that fills the frame with a
  body, the centroid of two fighters twelve metres apart frames neither of them,
  which is why earlier captures were unreadable specks.
- `feet=1` prints each foot in that fighter's own frame **after every pose
  layer**, with its toe pitch. A planted foot reads about `h0.07`; compare
  against a swordsman in the same frame rather than against zero.
- `capture_sim.sh` echoes every URL it builds. Paste one into a browser and it
  is the same frame — that is what makes a pose arguable with the user rather
  than describable at them.

## The rig has no IK, and that decides more than taste

The hips are pinned to the terrain and each leg is two rigid bones, so **a foot
cannot reach out and stay on the ground** — it travels an arc. Every stance
question is really this arithmetic:

- A leg reaching `d` from under the hip lifts its foot by
  `THIGH*(1-cos θ) + SHIN*(1-cos(θ+knee))`. `ankleLift` in `rigwalker.ts` is
  that, and `hurlStep` derives the hip drop from it rather than guessing.
- **The folded knee is the biggest lifter**, worth more than the whole hip
  sweep. A bent knee behind the body is why a rear foot floats. The hurl's rear
  leg therefore *drives straight*, which is free; crouching to pay for a folded
  one costs release height instead.
- **The root bone sits on the ground, not at the hips.** Pitching it forward
  swings the whole skeleton about the soles, and anything behind that pivot goes
  up. Bending belongs to the spine and chest, which pivot where a spine does. A
  root pitch of 0.3 rad was half of "standing on its toes".
- `drop` follows the **lower** of the two feet — the one actually standing on
  the ground. That single rule replaced a hand-tuned heel allowance and covers
  the whole motion: through the gather it tracks the leg holding the fighter up,
  through the drive it tracks the plant, and the other foot is free to fly.

The consequence to accept rather than fight: **the step cannot be as big as it
looks like it should be.** Half a body-width of travel asks the trailing leg to
reach about 0.9 m, which costs nearly 0.2 m of crouch, and a hurl crouched that
deep releases lower than a pitch — inverting the ordering the three throws are
read by. The travel peaks around 0.30 m. `hurler.test.ts` pins the bound and
says why. Getting more would need real foot IK, which is a feature, not a tune.

## Only one layer may own the legs

`applyBalancePose` is authored for a fighter that is only standing. Layered onto
a stride, its crouch and recovery steps lifted the rear foot 0.17 m and closed
the split back up. So `hurlStep` reports an `engagement` (how much of the
fighter the throw currently owns) and the balance layer's leg authority is
`1 - engagement`. Its lean and its hit reaction are never scaled — those are the
body's, whatever the feet have been told to do.

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

`ROCK_REFERENCE_SPEED` in `effects.ts` is a **fixed** reference, not the fastest
throw. The hurl is thrown past it and sits pinned at the flat arc base; raising
it to match would loop the other two more.

## The hurl is a spring, not a swing

The current long throw was specified by the user and built to it. Reading order:
`applyThrowPose`'s `hurl` branch, `hurlLegs`, `hurlStep`.

1. **Gather.** The lead knee lifts and the shin **tucks back under** the body.
   The tuck is what brings the feet together — a knee lifted over a straight
   shin puts that foot two thirds of a metre ahead of the fighter, which is a
   stride, not a gather. The body leans away and winds clockwise off the target;
   the counterweight arm comes up at the shoulder with the forearm folded
   **across the chest**. Fold it upward instead and the pose stops being a
   counterweight and becomes a rude gesture — that was a real playtest report.
2. **Plant.** The lifted leg swings down and out and lands. Once planted it is
   supposed to stay; what it gives back on the whip is only what the body
   travels forward in the same stretch. Take back more and the fighter releases
   with its feet together.
3. **Unwind.** Hips lead the shoulders, and the coil runs **through square and
   on into a left twist** — a coil that only returns to neutral has spent itself
   stopping. The rear leg extends behind and its heel comes off the ground.
4. **Release.** The elbow holds a right angle through the top of the wind and
   extends *late*, so the arm is one straight bar from shoulder to rock with the
   wrist in line behind it. The shoulder carries higher than it used to
   (`upperX -1.60` at the release key) to pay for that: a straight arm releases
   lower than a bent one, and the hurl must clear the pitch.

The gather runs on `draw * (1 - stride)`, not `draw`. Those two beats overlap
badly enough that a knee lift hung on `draw` alone is still up under a foot that
has already planted.

Measured through the motion (`1h v 1`, seed 3), foot position in the fighter's
own frame, forward positive:

| | gather (0.29) | drive (0.47) | release (0.58) | standing |
| --- | --- | --- | --- | --- |
| lead foot | +0.37, **h0.50** lifted | +0.30, h0.06 | +0.22, h0.06 | +0.25, h0.02 |
| rear foot | −0.37, h0.05 | −0.44, h0.25 | −0.27, h0.43 | −0.66, h0.08 |
| split | 0.74 | 0.74 | 0.49 | **0.91** |

A hurler also now **stands bladed** rather than square, held through the hurl
and given back as the two shorter throws plant to square. The throw is under a
second of a cycle over two seconds long, so the stance it waits in *is* the unit
as far as anyone watching is concerned — and note the cue label
"Winding up a hurl" is the *strategy*, shown for the whole cycle including the
long size-up and recovery. A report about "the wind-up" is very likely about the
stance, not the motion.

## A rock knocks its target down

Damage now carries `sourceId` and `thrown`. Presentation turns those into a
world direction, and a killing throw tips the corpse's up-axis onto the rock's
line and carries it 0.4 m down it. A cut has no line worth carrying — it lands
from a fighter standing right there — so it keeps its sideways roll off `side`.

Before this, every rock kill in the game toppled the same way, because
`planThrow` has no side to give and hardcodes `1`.

## The animations, and how they were got right

All three throws are overhand: the rock gathers back and low, the elbow leads it
up above the shoulder, the hand comes over the top and lets go out in front and
high, and the arm rides down across the body. The body is driven by four beats
(draw, stride, whip, follow); the arm is keyed, for the reason below.

None of this was written from first principles. The bone axes were **measured**
first, one rotation at a time on the imported GLB, because the Z-up to Y-up
conversion moves them and the Euler order means a shoulder's abduction changes
what its elevation does. Those signs are in the comment above `applyThrowPose`.

Everything `render_rigwalker_throw.py` checks, it caught at least once — feet a
metre off the ground, a hurl releasing below a pitch, an arm finishing above the
head, a toss that read as dropping the rock, a body folded double, and contact
sheets that were all correct and all showed a unit standing still because
Blender re-applies the GLB's own actions on every render.

One check changed this session: it used to require **both** feet stay near the
ground, which fails a hurl for lifting a knee on purpose. It now measures the
foot being stood on.

Final geometry: release heights **3.81 / 3.73 / 3.48 m**, all above the head;
support-foot drift 0.081 / 0.060 / 0.045 m; recovery error 0.0 degrees. The
sword duel still validates at 0.069 m drift and 0.00 degrees.

### Why the arm is keyed and the body is not

The first version summed beat coefficients for every bone, including the
throwing arm, and read as sidearm. Two causes, both of the kind that measure
clean and look wrong:

1. **Blender's Euler `XYZ` is not Three.js's.** Three.js composes its default
   XYZ as `qx*qy*qz`; Blender calls that order `ZYX`. Every Blender tool here
   was posing with Blender's `'XYZ'`, so any bone with two non-zero angles —
   which is every shoulder in a throw — was measured and rendered in a pose the
   game never drew. All three tools now pose with `'ZYX'`.
2. **A sum of beats cannot trace this arc.** The arm is only above shoulder
   height through a narrow band of shoulder angles, and blending from a cocked
   pose to a released one walks out of that band in between: halfway through the
   arm hangs at the hip and the throw reads as a sling. `THROW_ARM_KEYS` places
   poses along the arc instead, each solved for a written-down hand *and elbow*
   position. Constraining the elbow is the part that matters.

The same trap bites smaller things. The aiming arm runs on the *larger* of the
draw and stride beats rather than their sum, because adding them lifts it over
the head halfway through the wind.

## Crowds and waypoints

From the previous session; `AGENTS.md` has the rules under **Arriving at a
waypoint** and **Hysteresis, or the stutter step**.

Arrival is "stopped", not "within 8 cm": no ground made up for
`CROWD_ARRIVAL_SECONDS`, somebody within `CROWD_BLOCK_DISTANCE` between the unit
and the point, **and** enough bodies already nearer the point to fill the ground
still to cover. That last clause is the one to leave alone — without it a bay's
trio walking abreast funnels, loses a moment's ground, and two of the three quit
8.6 m short. Bodies pack about a clearance apart, so arrived units cover ground
growing with the root of their number.

The stutter had two independent causes, found by running the real loop headless
for three minutes and counting how often each unit changed its mind:
`ACQUIRE_SLACK` and the drop range were both 1.35 (identical for a hurler, so it
took and lost the same encounter forever — 626 plan events in 20 s while
standing still), and a standing unit drifted whenever one crowding threshold was
crossed. Now `ACQUIRE_SLACK` is 1.15 against a named `RELEASE_SLACK`, and
separation steps at `SEPARATION_NUDGE` until `SEPARATION_CLEAR`.

**The shape recurs:** anything decided by testing one threshold against
neighbours every frame will be decided both ways at frame rate, because a crowd
is never quite still. The headless soak is worth rebuilding when hunting one.

## Architecture notes worth preserving

- **The strike is resolved at release, replayed on arrival.** The `throw` event
  carries speed, flight time, and the already-rolled outcome, so presentation
  launches a rock that lands on the frame the director applies the damage. The
  exchange's recovery is stretched to outlast the flight so it cannot re-plan
  out from under a rock still in the air.
- **A hurler is never a mutual duellist.** One-sided `ranged` encounters, never
  promoted, never riposting. A swordsman attacking one takes a normal support
  encounter and does *not* defer to it.
- **Being hit outranks what you were planning.** `writeCue` stops a landed blow
  being lost to whichever encounter was iterated last.
- **Rock size and arc are drawn from the rendered result, not from physics.**
  All three throws are far harder than their distance needs, so honest
  ballistics gives three flat lines.
- **The step is a model offset, not movement.** The director owns where a hurler
  stands, so a hurl's travel is `modelRoot.position` inside the group. Local +Z
  is forward: the group's yaw is `atan2(direction.x, direction.z)`. The health
  bar rides it; the selection ring does not, because the ring marks the ground
  the unit holds.

## Measured state

- 69 tests pass; production build passes.
- Long range out-damages medium by more than a fifth, and medium out-damages
  short by the same, across eight seeds at thirty seconds each.
- `1h v 1` seed 3: hurler opens at 11.9 m, throws, is closed on and killed. A
  hurl at 12 m now flies in 0.35 s rather than 0.44 s.
- Crowds of 2 through 20 sent to one waypoint go completely still about 3.1 s
  after arriving, at a minimum gap of 1.22 m.
- Over a three-minute headless soak: out-of-combat walk-state flips fell from
  579 to 106; in-combat shuffling unchanged, which is fighters working.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **The rebuilt hurl has not been played.** It is measured and validated but
   two judgement calls are open and only watching it move will settle them:
   the rear heel reaches `h0.43` at release — correct for a full-effort drive,
   but it may read as a dangle; and the feet in the gather are 0.74 m apart
   rather than truly together, because tucking the shin further starts to look
   like a hurdler. Both are single coefficients in `hurlLegs`.
2. **Foot IK is the real unlock.** Everything cramped about the step traces to
   its absence — the travel bound, the heel lift, the small slide as the stance
   recovers. A two-bone solver on the planted foot would let the step be as big
   as it looks like it should be. It is a feature, and worth scoping properly.
3. **The throws have not been heard.** The release reuses the sword's `swing`
   whoosh, graded by throw. A heave and a rock landing may want their own voices
   — but the standing lesson is that a fight wants its sound spent on contact.
4. Hurlers can be held back: the Stoneworks has its own rally point, so a line
   behind the swords is a right-click rather than a code change.
5. A hurler that runs out of room backpedals into whatever is behind it.
   Retreating toward its own side would read better than a straight line.
6. Earlier items still open: scorch decals under wrecks, encirclement positions
   for group fights, and trails reading white-hot over bright ground.
