# Session handoff

## Current checkpoint

`main` at `96bb3cc` (`Put the projection toggle in the game, where the problem
is visible`), clean tree, **merged**. `camera-orbits-the-scene` has been
fast-forwarded into it and is spent. `main` is 25 commits ahead of `origin/main`;
nothing is pushed, and pushing is the user's call.

This session was cameras, not combat. Its five commits, oldest first:

- `63096a4` Let the camera orbit the scene
- `d10c7a3` Give a fighter its own beat from the seed, not the object counter
- `e0bf84f` Let the sim ask the camera whether it should be orthographic
- `3f419cf` Zoom a perspective view by walking in, not by narrowing the lens
- `96bb3cc` Put the projection toggle in the game, where the problem is visible

Checks:

```sh
npm test        # 80 pass
npm run build
blender --background --python tools/render_rigwalker_throw.py
blender --background --python tools/render_rigwalker_duel.py
npm run dev
```

The Vite warning about the shared chunk exceeding 500 kB is known and
non-blocking.

## The camera, and both modes stay

The user is still deciding what the game is and is using the camera to look
around. **Keep both projections.** Neither is a leftover; the point is being able
to flip between them.

Controls, identical in the game and the sim:

- `WASD` pans, in the camera's own frame — `W` walks away from the eye whatever
  direction the view has been swung to.
- `←` `→` orbit; `↑` `↓` raise and lower, clamped to 6°–84° off the ground.
  Level reads as nothing and straight down leaves `lookAt` no way to tell which
  way is north.
- `P` swaps orthographic and perspective. The game's control hint reads
  `Flat view` / `Depth view`; the sim's status line reads `ortho 3.2×` or
  `persp 43° · 21 m`.
- Wheel zooms. `camera=perspective`, `fov`, `yaw`, `pitch` work in both URLs,
  because a headless capture cannot press a key.

`src/world.ts` owns all of it: `CameraOrbit` (yaw, pitch, radius), `orbitOffset`,
`panFocus`, `viewSpan`, `radiusForFov`, and both camera constructors. The game
and the sim only wire it up.

### Three things that are easy to get wrong here

**1. Orthographic has no distance term at all.** That is what the user reported
as "units get bigger as they get further away". Nothing scales — measured, a 2 m
unit is 81.6 px at 47 m and at 91 m. What changes is the *ground*, which
compresses toward the horizon while the unit does not, so a distant unit reads as
a giant standing at the back. It is a property of the projection, not a bug, and
it is why the toggle exists.

**2. Judge camera questions in the game, not the sim.** The sim holds every
fighter within a few metres of the focus, so nothing in it is ever far away. The
effect above is invisible there and obvious in the game, where units and
buildings are spread over 180 m. Capturing the sim at a low pitch is what made an
almost-dead feature look verified.

**3. Perspective must spend zoom on distance, never on the lens.** Magnifying by
narrowing the field of view is what a telephoto does, and a telephoto flattens
depth: at the sim's usual 3.2× that was a 14° lens 66 m out, orthographic in all
but name. `applyZoom` in both pages leaves the lens fixed and walks the eye in
(`radiusForFov(fov, VIEW_HEIGHT / zoomLevel)`) so both projections frame the same
span at the focus and only depth differs. A wider `fov` comes in closer still and
reads deeper.

## A seed is only worth what nothing else can touch

`combatId` is `group.id`, three.js's **global object counter**, and five sites in
`rigwalker.ts` used that number as each unit's own beat — separation angle,
distance-reading cadence, combat step phase. Every mesh, light, rock and camera
built before the units moved it. Adding one camera to the sim shifted every id by
one and moved every fighter in every seed by about half a metre at six seconds,
with an event log and damage tally that matched exactly. A capture sheet compared
against that looks like a pose regression and is not one.

It now comes off the seeded spawn stream (`variation` in `createRigwalker`), and
`rigwalker.test.ts` replays a fight across a shifted object counter to keep it
that way. `combatId` stays `group.id`, which is fine: it is only compared and
keyed, never counted on.

**The rule: anything that changes how a unit moves must come from an injected
random stream** — never an id, a counter, an array index, or the wall clock. Any
of those turns a scenery change into a combat change.

**Consequence for the pose work below: every capture sheet taken before `d10c7a3`
no longer matches.** Outcomes are the same shape; the fine detail moved once.
Retake references before reading any of them as a regression.

## Verify the thing the user will actually do

`P` shipped twice as a dead key. Both times the URL parameter was tested, the
picture looked right, and the key itself was never pressed. The first time it was
wired only into the sim while the user was pressing it in the game.

`tools/capture_sim.sh` and URL parameters test *rendering*. They do not test
input, and they do not test the page the user has open. For anything driven by a
key, drive a real browser:

```sh
chrome --headless=new --remote-debugging-port=9223 about:blank &
# then Input.dispatchKeyEvent over CDP, and Page.captureScreenshot after it
```

Node 20 needs `--experimental-websocket` for a CDP client.

Known and unrelated: **`hud=0` renders a blank frame in headless capture.** It
reproduces on commits before this session's work. The clean-render path is
documented in AGENTS.md and currently broken.

## Which instrument to trust

**Read this before touching a pose.** There are three, they disagree, and each
one has shipped a wrong pose that the other two would have caught.

**1. The arithmetic in `rigwalker.ts`** (`ankleLift`, `ankleReach`, `hurlStep`)
is planar and knows nothing about rotation about the vertical. It is right about
what a pose *costs* and wrong about where anything ends up once the body turns.
It said the lead foot was planted while the rig had it skating a quarter of a
metre. Do not tune a foot against it.

**2. `tools/render_rigwalker_throw.py`** ports `applyThrowPose` onto the real
GLB and measures it. Authoritative about the arm, the rock, and about what a
throw *asks* the legs for — it sees the yaw, the root pitch and the real bone
axes, which (1) cannot. It stops before `applyBalancePose`, so it is **not**
authoritative about where a foot is on screen.

```sh
MEASURE=1 blender --background --python tools/render_rigwalker_throw.py
FEET=1 MEASURE=1 blender ...   # a hurl foot by foot, fifty phases
ARM=1  MEASURE=1 blender ...   # the free arm's depth inside the torso box
```

`MEASURE=1` skips the renders, which are most of the runtime; a stance question
is ten seconds, not three minutes. Drop it to get the contact sheets in
`/tmp/life-on-mars-throw-review`.

**3. `tools/capture_sim.sh`** drives the real game and is the only one that has
seen `applyBalancePose`. Final say on silhouette and on anything the balance
layer touches.

```sh
EXTRA='zoom=6&on=HR1&feet=1' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.63 1.95 2.21
```

- `on=HR1` rides one fighter by label. At a zoom that fills the frame with a
  body, the centroid of two fighters twelve metres apart frames neither.
- `feet=1` prints each foot in that fighter's own frame **after every pose
  layer**, with its toe pitch. A planted foot reads about `h0.07`; compare
  against a swordsman in the same frame rather than against zero.
- Every URL it builds is echoed. Paste one into a browser and it is the same
  frame — that is what makes a pose arguable with the user rather than
  describable at them.
- The balance layer is a live sim, so a single frame at low engagement is noisy.
  Judge the stance from several frames or from the middle of a throw, where
  engagement is high and the balance layer has no authority over the legs.

**`renders/index.html`** is an earlier session's output: fourteen phases of the
same hurl in three columns, each with the frame's sim URL. Regenerate with
`capture_sim.sh` into `renders/<column>/` and rebuild with
`python3 renders/build_index.py`. `renders/` is gitignored, and its current
contents predate `d10c7a3` — see the seed section above.

## The one rule the hurl work found

**A limb has to be clear of the body before it swings through where the body
is.** It cost two commits, at two different joints, and it generalises:

- A foot that starts travelling before it lifts skates. Feet hung on the body's
  power beats did exactly that at both ends of the step, so the legs got six
  beats of their own (`HURL_TUCK`, `HURL_SWING`, `HURL_STEP`, `HURL_HEEL`,
  `HURL_DRIVE`, `HURL_HOME`). None of draw/stride/whip/follow start where a foot
  needs to.
- The free arm folds across the chest and is then driven down and back. Opening
  it on the whip is too late, because the whip *is* the swing — so the opening
  got its own beat too, `HURL_OPEN`, that leads it.

The corollary is that the four body beats are about **power**, and anything
about **contact** — with the ground, with the torso — needs its own timing.

## The hurl is a step

Read `hurlLegs` first, then `hurlStep`, then `applyThrowPose`'s `hurl` branch.

A hurler waits **bladed with the throwing-side leg forward**, carrying the
weight, and the other leg trailing behind it. `HURLER_LOAD` gives the weighted
leg the deeper knee, which is the whole of "weight on that leg" as far as the
rig is concerned — and because `drop` follows the lower foot, bending it is also
what puts that foot on the ground and lets the trailing one hang light.

Which leg is forward is not a coin toss. It was the other way round and the
playtest report was that the wind-up had nowhere to step to: the gather lifted
the near knee and put it back down where it came from.

1. **Pick up and swing through.** The trailing knee folds before anything
   swings, so the foot leaves the ground where it stood instead of dragging out
   of the stance. Then it carries through under the body with the shin tucked.
2. **The gather.** Knee up, feet passing each other, the body leaning away and
   winding clockwise off the target. All the weight is still on the
   throwing-side foot, which has not moved since phase 0.
3. **The plant.** That leg reaches out and lands 0.46 m ahead of the spot the
   fighter holds. The body then travels over it — 0.30 m of `forward`, carried
   as a model offset because the director owns where a hurler stands.
4. **The drive.** The throwing-side leg lifts its heel *before* it extends
   behind, and is then allowed to drag: by that point it is in the air, and a
   trailing foot in the air is a drive rather than a slide.
5. **Release**, over the planted lead foot, feet 0.47 m apart.
6. **The recovery is a step, not a slide.** The lead foot picks itself up,
   travels about a metre, and sets down back in the stance. `HURL_STEP` fades
   out over the whole back end of the motion for this; reusing the stride beat
   snapped it home in a tenth of a second.

**The coil drags the planted foot, and only the leg can put it back.** The root
turns the whole skeleton about a point on the ground between the feet, so the
hips opening through the release sweeps the foot the fighter is standing on
round with them. Uncancelled that was 0.24 m of the lead foot skating backwards,
in a pose whose own planar numbers said it was still. `hurlLegs` takes a term
off `hurlHips` for it. This is the clearest example of instrument (1) lying.

Measured on the rig, foot position against the spot the fighter holds:

| | stance | gather (0.30) | plant (0.45) | release (0.58) | recovery (0.85) |
| --- | --- | --- | --- | --- | --- |
| trailing/lead foot | −0.66 | −0.06, **h0.68** | +0.38 | +0.46 | −0.09 |
| throwing-side foot | +0.18 | +0.14 planted | +0.06 | −0.01, h0.14 | +0.32 |
| split | −0.84 | −0.20 | +0.32 | **+0.47** | −0.41 |

## The rig has no IK, and that decides more than taste

The hips are pinned to the terrain and each leg is two rigid bones, so **a foot
cannot reach out and stay on the ground** — it travels an arc. Every stance
question is that arithmetic, in `ankleLift`/`ankleReach`.

- **The folded knee is the biggest lifter**, worth more than the whole hip
  sweep. That is only a bill when the leg is the one being stood on: `drop`
  follows the *lower* foot, so once the lead foot is planted the rear knee may
  fold as much as the drive wants, and it should. Fold the knee of the leg
  holding the fighter up and the crouch that pays for it costs release height.
- **The root bone sits on the ground, not at the hips.** Pitching it forward
  swings the whole skeleton about the soles, and anything behind that pivot goes
  up. Bending belongs to the spine and chest. A root pitch of 0.3 rad was half
  of "standing on its toes".
- The step's size is bounded by this, not by taste. It sits at 0.30 m.

## Only one layer may own the legs

`applyBalancePose` is authored for a fighter that is only standing. Layered onto
a stride, its crouch and recovery steps lifted the rear foot and closed the
split back up. So `hurlStep` reports an `engagement` and the balance layer's leg
authority is `1 - engagement`. Its lean and its hit reaction are never scaled.

A consequence worth knowing: at low engagement the balance layer owns the legs
completely, so the **idle** stance on screen swings either side of the authored
one by a good margin. That is the sim working, not the stance being wrong.

## What the Hurler is

A ranged unit on the same skeleton, with no sword, a rock in its hand and a
cache of them on its hip. It picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | inside sword reach, 4.3 m | 11 m/s | 8 | 0.30 s |

Both derived ranges come from constants rather than being typed in. `AGENTS.md`
has the full rules; the short version is that it is deadliest at the top of its
range, that the range it is at picks its throw, and that it is walked down
through all three by anything that closes on it.

The stance is shared by all four branches — hurl, pitch, toss, and the pose
between throws — and they have to agree to the decimal, or every throw opens
with a foot jumping to a new spot. `hurler.test.ts` pins that.

`ROCK_REFERENCE_SPEED` in `effects.ts` is a **fixed** reference, not the fastest
throw. The hurl is thrown past it and sits pinned at the flat arc base.

## The arm, and why it is keyed rather than summed

All three throws are overhand: the rock gathers back and low, the elbow leads it
up above the shoulder, the hand comes over the top and lets go out in front and
high, and the arm rides down across the body. The elbow holds a right angle
through the top of the wind and extends *late*, so the arm is one straight bar
from shoulder to rock at release. An elbow still bent at release is a thrower
pushing rather than throwing.

None of it was written from first principles. The bone axes were **measured**
first, one rotation at a time on the imported GLB, because the Z-up to Y-up
conversion moves them. Those signs are in the comment above `applyThrowPose`.

Two traps behind the keys:

1. **Blender's Euler `XYZ` is not Three.js's.** Three.js composes its default
   XYZ as `qx*qy*qz`; Blender calls that order `ZYX`. All three tools here pose
   with `'ZYX'`. Get this wrong and you measure a pose the game never drew.
2. **A sum of beats cannot trace this arc.** The arm is only above shoulder
   height through a narrow band of shoulder angles, and blending from a cocked
   pose to a released one walks out of that band in between — halfway through
   the arm hangs at the hip and the throw reads as a sling. `THROW_ARM_KEYS`
   places poses along the arc instead, each solved for a written-down hand *and
   elbow* position. Constraining the elbow is the part that matters.

The aiming arm runs on the *larger* of the draw and stride beats rather than
their sum, for the same reason.

## A rock knocks its target down

Damage carries `sourceId` and `thrown`. Presentation turns those into a world
direction, and a killing throw tips the corpse's up-axis onto the rock's line
and carries it 0.4 m down it. A cut has no line worth carrying — it lands from a
fighter standing right there — so it keeps its sideways roll off `side`.

## Crowds and waypoints

From an earlier session; `AGENTS.md` has the rules under **Arriving at a
waypoint** and **Hysteresis, or the stutter step**.

Arrival is "stopped", not "within 8 cm": no ground made up for
`CROWD_ARRIVAL_SECONDS`, somebody within `CROWD_BLOCK_DISTANCE` between the unit
and the point, **and** enough bodies already nearer the point to fill the ground
still to cover. That last clause is the one to leave alone — without it a bay's
trio walking abreast funnels, loses a moment's ground, and two of the three quit
8.6 m short.

The stutter had two independent causes, found by running the real loop headless
for three minutes and counting how often each unit changed its mind. Now
`ACQUIRE_SLACK` is 1.15 against a named `RELEASE_SLACK`, and separation steps at
`SEPARATION_NUDGE` until `SEPARATION_CLEAR`.

**The shape recurs:** anything decided by testing one threshold against
neighbours every frame will be decided both ways at frame rate, because a crowd
is never quite still. The headless soak is worth rebuilding when hunting one.

## Architecture notes worth preserving

- **The strike is resolved at release, replayed on arrival.** The `throw` event
  carries speed, flight time, and the already-rolled outcome, so presentation
  launches a rock that lands on the frame the director applies the damage. The
  exchange's recovery is stretched to outlast the flight.
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
  is forward. The health bar rides it; the selection ring does not, because the
  ring marks the ground the unit holds.
- **Sparks are point sprites and get no perspective divide for free.** The
  shader now applies one under a uniform; the orthographic path computes the
  identical pixels-per-unit it always did. Anything else added in screen space
  will have the same problem.
- **Clear the imported animation data before rendering in Blender.** The GLB
  carries Idle, Walk and CombatIdle, and Blender re-applies whichever action is
  assigned on every render. Miss this and the measurements are right while every
  picture shows a unit standing still.

## Measured state

- 80 tests pass; production build passes.
- Camera: default orbit reproduces the old fixed `(36, 42, 36)` eye exactly —
  verified byte-identical captures before and after `63096a4`. Perspective at
  the default fov frames the same span at the focus, within 3% on a standing
  body (the residue is real: the camera looks down, so a head is nearer the eye
  than the feet).
- Pose figures below predate `d10c7a3` and still hold as *rig* measurements —
  they come from the Blender tools, which spawn no units and are unaffected by
  the seed change. Only sim capture sheets moved.
- Release heights **3.77 / 3.73 / 3.48 m**, all above the head. The hurl's
  margin over the pitch is **0.04 m** — treat it as the budget: anything that
  lowers the hurl or raises the pitch needs the arm keys revisited.
- Support-foot drift 0.081 m; the lead foot moves 0.090 m between planting and
  the recovery; recovery error 0.0 degrees.
- The free arm clears the torso by at least 0.156 m at every phase of all three
  throws.
- The sword duel still validates at 0.069 m drift and 0.00 degrees.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope. The user is currently exploring
what the game *is* by moving the camera, so camera work is live.

1. **The projection is an open question, deliberately.** Both modes stay until
   the user decides. What has not been tried: perspective at gameplay distance
   rather than at ground level, and whether unit readability survives it at the
   zooms an RTS actually plays at.
2. **`hud=0` renders blank in headless capture.** Pre-existing, blocks the clean
   render path, small.
3. **Retake the capture sheets** used to judge poses; the ones in `renders/`
   predate the seed fix.
4. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   traces to its absence — the travel bound, the release-height budget, the small
   slide as the stance recovers. A two-bone solver on the planted foot would let
   the step be as big as it looks like it should be. It is a feature, and worth
   scoping properly.
5. **The throws have not been heard.** The release reuses the sword's `swing`
   whoosh, graded by throw. The standing lesson is that a fight wants its sound
   spent on contact.
6. **The torso check is cheap and only the hurler has it.** The same measurement
   would run over the swordsman's guards and cuts, which nobody has checked.
7. Hurlers can be held back: the Stoneworks has its own rally point, so a line
   behind the swords is a right-click rather than a code change.
8. A hurler that runs out of room backpedals into whatever is behind it.
   Retreating toward its own side would read better than a straight line.
9. Earlier items still open: scorch decals under wrecks, encirclement positions
   for group fights, and trails reading white-hot over bright ground.
