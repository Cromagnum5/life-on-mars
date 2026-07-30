# Session handoff

## Current checkpoint

`main` at `1efee9a` (`Take the throwaway browser drivers back out of the repo`),
**merged**. `animation-tool` has been fast-forwarded into it and is spent. `main`
is 10 commits ahead of `origin/main`; nothing is pushed, and pushing is the
user's call.

**The working tree is deliberately not clean.** `src/pose-tuning.ts` carries hurl
arm-key edits the user saved out of the animation tool while playing with it.
They are real work and they are also a regression — see "The ordering the throws
read by" below. Do not sweep them into a commit and do not throw them away
without asking. `git diff src/pose-tuning.ts` is the whole of it.

This session built the animation tool. Its commits, oldest first:

- `624051c` Make a throw's timing and its arm arc data, not constants
- `5cdabfb` Read the feet line off one function, not two
- `ebcb86d` Give the animation a workbench of its own
- `789d06a` Give the scrub bar a target worth aiming at, and its keys back
- `e0d57cc` Write down that a slider must not own the keyboard
- `ad61f9f` Let the free arm be edited, and measure what that costs
- `adee132` Count the entry points again
- `59a78c4` Revert everything, not the fields that existed when it was written
- `809ab52` Mark what is in the file on every slider
- `1efee9a` Take the throwaway browser drivers back out of the repo

## Checks

```sh
npm test        # 87 pass
npm run build
blender --background --python tools/render_rigwalker_throw.py
blender --background --python tools/render_rigwalker_duel.py
npm run dev     # 0.0.0.0:5173, so http://10.0.0.102:5173 from another machine
```

Three pages: the game at `/`, the combat sim at `/sim.html`, the animation tool
at `/anim.html`. The sim's bar links to the tool and the tool's back.

Two things that look like failures and are not:

- **Two tests in `combat.test.ts` time out under CPU load.** They are seed loops
  (32 and 120 seeds) inside a 5 s budget, and a headless Chrome rendering through
  SwiftShader in the background is enough to push them over. They passed on every
  quiet run this session. Re-run with the machine idle before believing them.
- Vite's warning about the shared chunk exceeding 500 kB is known and
  non-blocking.

## The animation tool

`AGENTS.md` has the full rules under **The animation tool**. The short version:
`anim.html` is the sim with the fight taken out — one Rigwalker, one motion, and
a phase you hold still, plus the numbers that motion is made of as controls that
move the rig while you drag them.

It is **not** a keyframe editor for the GLB. The combat poses are not in the
model. What it edits is `src/pose-tuning.ts`, and **Save** writes that file
through a dev-only Vite route, replacing only what is below the marker at the
foot of it so the prose above survives.

The reason it is the same instrument as `capture_sim.sh` and not a fourth opinion
is that it poses the rig by handing the real `Rigwalker.update` a hand-written cue
with `movement: "plant"`. Everything on screen has been through
`applyThrowPose`, the balance layer and the model offset.

The user's own words on it were "wonderful" and "I understand how to use it
intuitively". Treat the interaction as something worth protecting.

## The ordering the throws read by

**Read this before touching the arm.** The three throws have to release in order —
a hurl above a pitch above a toss — because that ordering is how the unit's three
ranges read as three different throws rather than one throw at three speeds.

The margin is thin and the arm keys spend it. Measured this session in the tool,
world height of the held rock at each throw's own release phase:

| | hurl | pitch | toss | hurl over pitch |
| --- | --- | --- | --- | --- |
| as committed | 4.481 | 4.462 | 4.225 | **+0.019** |
| the user's saved edits | 4.316 | 4.462 | 4.225 | **−0.146** |

The edits sitting in the working tree flip the elbow (`lowerX`) on four hurl keys
from folded to extended. It is a defensible change to how the arm looks, and it
releases 0.165 m lower, which puts the hurl **under** the pitch. Either the pitch
comes down with it or the hurl's shoulder goes up; the change is not finished on
its own.

**These numbers are in the tool's frame, not Blender's.** The Blender port reports
the same three release heights as 3.77 / 3.73 / 3.48, measured from a different
origin. Both are right and they are not comparable across instruments — only
within one. Whichever you use, use one.

## Which instrument to trust

There are now **four**, they disagree, and each has shipped a wrong pose the
others would have caught.

**1. The arithmetic in `rigwalker.ts`** (`ankleLift`, `ankleReach`, `hurlStep`) is
planar and knows nothing about rotation about the vertical. Right about what a
pose *costs*, wrong about where anything ends up once the body turns. It said the
lead foot was planted while the rig had it skating a quarter of a metre. Do not
tune a foot against it.

**2. `tools/render_rigwalker_throw.py`** ports the pose onto the real GLB and
measures it. Authoritative about the arm, the rock, and what a throw asks the legs
for — it sees the yaw, the root pitch and the real bone axes, which (1) cannot. It
stops before `applyBalancePose`, so it is **not** authoritative about where a foot
is on screen.

```sh
MEASURE=1 blender --background --python tools/render_rigwalker_throw.py
FEET=1 MEASURE=1 blender ...   # a hurl foot by foot, fifty phases
ARM=1  MEASURE=1 blender ...   # the free arm's depth inside the torso box
```

`MEASURE=1` skips the renders, which are most of the runtime: a stance question is
ten seconds, not three minutes.

**It is a hand port and reads nothing.** Every number the animation tool saves has
to be copied into it by hand, or the two instruments are describing different
animations. Nothing enforces this. It is the sharpest edge the tool introduced.

**3. `tools/capture_sim.sh`** drives the real game and has seen every pose layer.
Final say on silhouette, and the only one that sees a pose inside a real fight.

```sh
EXTRA='zoom=6&on=HR1&feet=1' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.63 1.95
```

**4. `anim.html`** is the same three layers as (3), interactive, at a phase that
holds still. It is the right instrument for *authoring* and for anything about the
free arm. Its readouts — engagement, the step's forward and drop, the rock's
height, the free arm's clearance, and the same feet string `feet=1` prints — are
live and after every layer.

Its one caveat: the balance layer is a damped spring, so a scrub takes a moment to
settle. What it settles to is the pose; the swing on the way there is not. At low
engagement that layer owns the legs completely, so the idle stance swings either
side of the authored one by a good margin. That is the sim working.

## The free arm is editable now, and measured

The counterweight arm's coefficients are `POSE_TUNING.freeArm`. It is **summed**
from the beats while the throwing arm is **keyed**, and that is not an
inconsistency: the throwing arm traces an arc through a narrow band of Euler
angles a sum walks out of, and this arm has no arc to trace.

Editing it needed the measurement to come with it, because this arm's one real
fault is going *through* the chest instead of round it — and that is the fault a
picture cannot show. The arm is drawn in front of the torso either way and the
difference is a few centimetres of one Euler angle. The elbow once sat a quarter
of a metre inside the body for a fifth of the motion and only a measurement found
it.

So the tool's readout ports `inside_torso` from the Blender tool, sign flipped so
bigger is safer, and reads red when the elbow, forearm or hand is buried. The two
agree to the millimetre: 0.259 m clear at phase 0, 0.345 at 0.40, **0.069 at
0.92**.

That last figure is the budget. It is the tightest moment of a hurl — the elbow on
its way home — and it is the first number to go negative if this arm is pushed
around. **The old handoff's claim of "at least 0.156 m at every phase" does not
survive a fine sweep of the hurl**; treat 0.069 m as the real headroom until
somebody re-measures all three throws.

## Rules the tool work found

- **A slider must not own the keyboard.** The keydown handler bailed on any
  focused input, so touching one slider killed every shortcut on the page and
  turned the arrow keys into an editor for the value last dragged. Only what you
  type into — number fields, the line picker — gets the keys. Drag a value, then
  step through the frames it changed, is the loop the tool exists for.
- **A restore must not enumerate fields.** Revert named the four things it put
  back and shipped broken the day the free arm was added: everything else went
  home and the arm stayed dragged, which is worse than not reverting, because it
  looks like it worked. `restorePoseTuning` copies whatever keys the object has.
- **A mark must line up with the thumb**, which means knowing how wide the thumb
  is, which means styling the slider all the way down. A thumb's centre travels
  inset by half a thumb at each end, and measuring against the full width puts the
  mark visibly wide at exactly the extremes where the interesting values sit.
- **The glTF loader strips the dots out of node names.** `Elbow.L` is `ElbowL`.
  The clearance check measured nothing and reported that as nothing to report
  until it got the same fallback `findCombatBones` already carries.
- **Saving reloads the page**, because it writes a module the page imports. That
  is right — it proves disk matches screen — so the tool keeps the motion, phase
  and camera in the URL and carries the confirmation back in `saved=`. The
  consequence: `Revert` after a `Save` reverts to the *saved* values. Undoing a
  save is a git job.
- **Verify input in a real browser.** URL parameters test rendering. Everything
  this session that was wrong was wrong about input or focus, and only a driven
  browser found it:

```sh
chrome --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --use-gl=swiftshader --remote-debugging-port=9223 --user-data-dir=/tmp/prof
# then Input.dispatchKeyEvent / dispatchMouseEvent over CDP
```

Node 20 needs `--experimental-websocket` for a CDP client, and the driver scripts
belong in the scratchpad — three of them rode into the repo on a `git add -A` this
session because the shell resets its working directory between commands.
`window.__anim` exposes the scene, subject, phase and clearance so a check can
read a measurement instead of scraping the panel.

## A seed is only worth what nothing else can touch

`combatId` is `group.id`, three.js's **global object counter**, and five sites in
`rigwalker.ts` once used that number as each unit's own beat. Adding one camera to
the sim shifted every id and moved every fighter in every seed by about half a
metre at six seconds, with an event log and damage tally that matched exactly. A
capture sheet compared against that looks like a pose regression and is not one.

It now comes off the seeded spawn stream (`variation` in `createRigwalker`), and
`rigwalker.test.ts` replays a fight across a shifted object counter to keep it
that way.

**The rule: anything that changes how a unit moves must come from an injected
random stream** — never an id, a counter, an array index, or the wall clock.

## The camera, and both modes stay

The user is still deciding what the game is and is using the camera to look
around. **Keep both projections.** Controls are identical in all three pages:
`WASD` pans in the camera's own frame, `←` `→` orbit, `↑` `↓` raise and lower
between 6° and 84°, `P` swaps projection, the wheel zooms. `src/world.ts` owns all
of it.

Three things easy to get wrong here: orthographic has **no distance term at all**,
so what the user reported as "units get bigger further away" is the ground
compressing while the unit does not; judge camera questions **in the game**, where
things are spread over 180 m, never in the sim; and perspective must spend zoom on
**distance, never the lens**, because a telephoto flattens the depth the
projection exists for.

## The hurl is a step

Read `hurlLegs`, then `hurlStep`, then `applyThrowPose`'s `hurl` branch. A hurler
waits bladed with the **throwing-side leg forward** carrying the weight. The
trailing knee folds *before* anything swings, carries through under the body,
plants 0.46 m ahead, the body travels over it, the rear leg lifts its heel before
extending, release is over the planted foot, and the recovery is a step home — not
a slide.

**A limb has to be clear of the body before it swings through where the body is.**
That cost two commits at two joints and it generalises: the four body beats are
about **power**, and anything about **contact** — with the ground, with the torso —
needs its own timing. It is why the legs have six beats of their own and why the
free arm's opening has one.

**The coil drags the planted foot, and only the leg can put it back.** The root
turns the whole skeleton about a point on the ground, so the hips opening sweeps
the foot the fighter is standing on round with them. `hurlLegs` takes a term off
`hurlHips` for it. This is the clearest example of instrument (1) lying.

## The rig has no IK, and that decides more than taste

The hips are pinned to the terrain and each leg is two rigid bones, so **a foot
cannot reach out and stay on the ground** — it travels an arc. The folded knee is
the biggest lifter; the root bone sits on the ground, not at the hips, so pitching
it swings the whole skeleton about the soles. The step's size is bounded by this,
not by taste, and it sits at 0.30 m.

`applyBalancePose` is authored for a fighter that is only standing, so its leg
authority is `1 - engagement`. Its lean and hit reaction are never scaled. **Only
one layer may own the legs.**

## What the Hurler is

A ranged unit on the same skeleton, no sword, a rock in hand and a cache on its
hip. It picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | inside sword reach, 4.3 m | 11 m/s | 8 | 0.30 s |

Deadliest at the top of its range; the range picks the throw; anything that closes
walks it down through all three. The stance is shared by all four branches — hurl,
pitch, toss and the pose between throws — and they have to agree to the decimal or
every throw opens with a foot jumping to a new spot. `hurler.test.ts` pins that.

## Architecture notes worth preserving

- **The strike is resolved at release, replayed on arrival.** The `throw` event
  carries speed, flight time and the already-rolled outcome.
- **A hurler is never a mutual duellist.** One-sided `ranged` encounters, never
  promoted, never riposting.
- **Being hit outranks what you were planning.** `writeCue` stops a landed blow
  being lost to whichever encounter was iterated last.
- **Rock size and arc are drawn from the rendered result, not from physics.** All
  three throws are far harder than their distance needs.
- **The step is a model offset, not movement.** The director owns where a hurler
  stands. Local +Z is forward. The health bar rides it; the selection ring does
  not, because the ring marks the ground the unit holds.
- **Sparks are point sprites and get no perspective divide for free.**
- **Clear the imported animation data before rendering in Blender.** The GLB
  carries Idle, Walk and CombatIdle and Blender re-applies whichever action is
  assigned on every render. Miss this and the measurements are right while every
  picture shows a unit standing still.

## Measured state

- 87 tests pass; production build passes; both Blender validators pass.
- Release heights, Blender frame: **3.77 / 3.73 / 3.48**, all above the head.
  Tool frame: **4.481 / 4.462 / 4.225**. The hurl's margin over the pitch is the
  budget and it is about two centimetres.
- Free arm clearance through a hurl: tightest **0.069 m** at phase 0.92.
- Support-foot drift 0.081 m; the lead foot moves 0.090 m between planting and
  recovery; recovery error 0.0 degrees. The sword duel validates at 0.069 m drift
  and 0.00 degrees.
- Camera: the default orbit reproduces the old fixed `(36, 42, 36)` eye exactly.
- Capture sheets in `renders/` predate the seed fix and no longer match. `renders/`
  is gitignored.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **Settle the arm edits in the working tree** with the user — either bring the
   pitch down to match or lift the hurl's shoulder, then re-measure the ordering.
   Nothing else should be built on top until that file is decided.
2. **Make the Blender port stop being a hand copy.** It is the one place the tool
   can silently desynchronise the project from itself. Emitting the tuning as JSON
   for the Python to read would end a whole class of wrong measurement.
3. **The sword has no tunables.** `applyCombatPose` still sums its coefficients
   inline, so `cut`, `guard` and `struck` scrub but do not edit. The same
   extraction the throws got would open them, and the torso check would run over
   the guards and cuts, which nobody has measured.
4. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   traces to its absence. It is a feature, and worth scoping properly.
5. **The throws have not been heard.** The release reuses the sword's `swing`
   whoosh, graded by throw. The standing lesson is that a fight wants its sound
   spent on contact.
6. **`hud=0` renders blank in headless capture.** Pre-existing, blocks the clean
   render path, small.
7. **Retake the capture sheets** used to judge poses; the ones in `renders/`
   predate the seed fix.
8. The projection is an open question, deliberately. What has not been tried:
   perspective at gameplay distance, and whether unit readability survives it at
   the zooms an RTS actually plays at.
9. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, and trails reading white-hot over bright ground.
