# Session handoff

## Current checkpoint

`main` at `c952584` (`Point the handoff at combat target selection`), **merged**.
`remove-hurler-hip-rocks` was fast-forwarded into it and is spent. `main` is 7
commits ahead of `origin/main`; nothing is pushed, and pushing is the user's
call.

**The working tree is deliberately not clean.** `src/pose-tuning.ts` carries hurl
arm-key edits the user saved out of the animation tool while playing with it.
They are real work and they are also a regression — see "The ordering the throws
read by" below. Do not sweep them into a commit and do not throw them away
without asking. `git diff src/pose-tuning.ts` is the whole of it. Stage files by
name; `git add -A` will take that file with them.

The merged branch, oldest first:

- `3f3ca67` Take the rocks off the hurler's hip
- `a65ca54` Drop the blob shadow under every unit
- `5fd5c9f` Let a screen engage chargers that already have a target
- `3495fe7` Give each sword a charger of its own
- `dd6048d` Work a team's hurlers as one battery

The last three are this session and are all `src/combat.ts` target selection.
They were played and approved — "it's nice now" — so treat the behaviour as
settled and the balance as open.

## Checks

```sh
npm test        # 97 pass
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

## How to see what the director is thinking

This session's three defects were all invisible in a screenshot and obvious in a
trace, and getting a trace out is not obvious, so:

**`console.log` from the page does not reach the terminal.** `--enable-logging=stderr`
with `--v=1` gets you Chrome's own histograms and none of the page's output.
What works is writing the line into the DOM and dumping it:

```ts
const d = (globalThis as never as { document?: any }).document;
if (d?.body) {
  let node = d.getElementById("dbg");
  if (!node) { node = d.createElement("pre"); node.id = "dbg"; d.body.appendChild(node); }
  node.textContent += `...\n`;
}
```

```sh
chrome --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --use-gl=swiftshader --virtual-time-budget=18000 --dump-dom \
  "http://localhost:5173/sim.html?matchup=2h%2B2%20v%204&seed=4&t=14" | grep -o 'HURL .*'
```

Two traps in that URL. **The matchup must be URL-encoded** — `2h+2 v 4` passed
raw decodes to `2h 2 v 4`, matches nothing, and the sim silently falls back to
`1v1`, which looks like your change did nothing. `tools/capture_sim.sh` passes
the argument through raw, so encode it there too. And `--dump-dom` is also how to
read the verdict without looking at a picture:

```sh
... --dump-dom "...&t=60" | grep -o 'id="verdict"[^>]*>[^<]*' | sed 's/.*>//'
```

That is what the win tallies below were counted with.

## What the target selection defects were

All three were reported from play and all three had a cause other than the
obvious one. Worth reading before changing `CombatDirector.update`, because the
order things happen in that function is load-bearing.

**1. The screen did nothing.** In `2h+2 v 4` the two Helios swords never touched
the four Vanguard swords walking past them to the hurlers; the HUD read `idle ·
no contact` at 100 HP for the whole fight. Two coupled causes, not one:

- A hurler acquires at 18.5 m and two swordsmen only notice each other at 8.5, so
  **on the walk in every charger picks a hurler before the screen is in melee
  awareness range at all.** From that frame each red held a support encounter and
  was in `reserved`, so the mutual-duel pass skipped all four as unavailable.
- Melee support encounters were never published into the threat list — only
  ranged and mutual ones were — so from the blue side nobody registered that a
  red was threatening the hurler either.

A one-sided attacker is now a threat to the fighter it is walking at. And on
promotion the target's own outgoing encounter is dropped: without that a held
charger drives its charge *and* defends the new duel, writing two cues a frame
that fight each other. Dropping it is what actually makes a screen hold.

**The acquisition ordering is the whole defect**, so the regression test
reproduces it in two steps — chargers lock onto the hurlers a frame before the
screen is in range — rather than placing everyone and running one frame. A
one-frame placement test passes on the broken code.

**2. Both swords took the same charger.** The obvious fix — score a target that
somebody is already on as more expensive — is in, and **on its own it changed
nothing on screen.** Tracing the frame the second sword commits: its four
candidates were at 9.82, 10.26, 10.37 and 11.26 m against an acquire range of
9.775, and the only one it could reach was the one its partner had taken at
9.77 m. It doubled up because the nearest free charger was five centimetres out
of reach. So a target nobody is on is acquired at a longer slack as well.

That slack has a hard ceiling and it is not taste: acquiring past the range an
encounter survives to takes the encounter and loses it every frame, which is the
strobing plan ring `ACQUIRE_SLACK` is already written against.
`UNCLAIMED_ACQUIRE_SLACK` at 1.25 leaves a 0.85 m hysteresis band where the
ordinary one leaves 1.7. Do not raise it without re-reading that comment.

**3. A hurler charged into the crowd.** Not a hurler deciding anything. The melee
support pass had no role check, so a hurler that had not yet acquired — and at
the start of the walk in neither has, the enemy being 23 m off — was drafted as a
helper, handed a `beat`, and sent to close. It leaves its standoff at x = −13.5
and does not stop until x = −3.2, throwing nothing the whole way. `hurler.test.ts`
already claimed a hurler "only ever throws and never picks up a sword plan"; that
only held because every case in it was one where the hurler acquired first.

## The hurler battery

A team's hurlers now pick one body together and work it down together. The focus
is scored in metres in `chooseFocus`: how close the candidate has come to the
**nearest** thrower, plus its remaining health at `FOCUS_HEALTH_WEIGHT` (8), less
`FOCUS_HYSTERESIS` (2.5) for being the body they are already on. That gives
weakest-first through a crowd, while a fresh swordsman closing on the throwers
still outranks a near-dead one at the back — keeping the crowd off is what the
battery is for. A thrower that cannot reach the focus works on what it can hit
and rejoins when the focus comes round.

**Re-aiming reuses the rule the throw already had.** The band a throw is chosen
at may change while the gap is still being judged and not once the motion has
started; `canReaim` says the same about who it is thrown at. A rock in the air is
never re-aimed, and a wind-up that snapped to a new bearing mid-swing would read
as the model glitching rather than as the group changing its mind. Between throws
the next one is aimed wherever the battery is now, so a switch costs one plan and
not two — that is why `advanceThrow` takes the desired target rather than
re-planning against its current defender.

What it looks like when it works, seed 3 of `2h v 3`: both commit to a hurl at
0.73 s, both release at V2 at 2.00 and 2.10, both commit again at 3.03 and 3.13,
both pitch at 3.82 and 3.93, V2 at 5 HP with V1 and V3 untouched.

## What was deliberately left alone

- **Hurlers still get overrun in `2h+2 v 4`.** They hold 14 to 15 m until the
  chargers arrive, then get walked down through pitch and toss. A hurler
  backpedals at 1.5 m/s against a 3.6 m/s charge, so with four chargers and two
  screening swords, two get through by design. That is movement, not targeting,
  and changing it is a balance decision the user has not made.
- **The battery split once for about a second** in a 25 s trace: one thrower had
  swung to a closing enemy while the other was mid-wind-up and could not follow,
  then the focus swung back. It resolves itself. `FOCUS_HYSTERESIS` is the dial if
  it ever reads badly in motion.
- **Two swords may still double on one charger** when there is genuinely nothing
  else in reach. `MAX_SUPPORTERS_PER_TARGET` still caps pressure at a primary
  plus two, and focus fire is wanted; only the accidental case was removed.

## The balance moved and wants his eyes

Counted with the `--dump-dom` verdict recipe above, `2h+2 v 4` over seeds 1–12:
**7 Helios wins before the screen spread, 10 after.** Seeds 2 and 3 went from
still fighting at 40 s to resolving at 17.6 s and 16.7 s; seed 1 flipped the other
way. After the battery it sits at 7 of 8 on seeds 1–8, and `2h v 3` sits at 4–4.
Everything resolves inside 60 s.

That is the screen doing its job — holding two chargers instead of one buys the
hurlers the range they want — but a twelve-seed tally is a weak instrument and
whether the hurler side is now too strong is a question for playing it.

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

The margin is thin and the arm keys spend it. Measured in the tool, world height
of the held rock at each throw's own release phase:

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
  in the tool session that was wrong was wrong about input or focus, and only a
  driven browser found it:

```sh
chrome --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --use-gl=swiftshader --remote-debugging-port=9223 --user-data-dir=/tmp/prof
# then Input.dispatchKeyEvent / dispatchMouseEvent over CDP
```

Node 20 needs `--experimental-websocket` for a CDP client, and the driver scripts
belong in the scratchpad — three of them once rode into the repo on a `git add -A`
because the shell resets its working directory between commands. `window.__anim`
exposes the scene, subject, phase and clearance so a check can read a measurement
instead of scraping the panel.

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

A ranged unit on the same skeleton, no sword, a rock in hand. It picks one of
three throws from the current gap:

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
  promoted, never riposting — and, since this session, never drafted into a melee
  support encounter either.
- **A fighter may drive only one encounter.** Anything that hands a fighter a
  second one writes two cues a frame and reads as neither. The promotion pass
  drops the target's own outgoing encounter for exactly this reason.
- **Being hit outranks what you were planning.** `writeCue` stops a landed blow
  being lost to whichever encounter was iterated last. It arbitrates *only* that
  case, which is why the rule above has to hold everywhere else.
- **Acquire ranges must stay inside release ranges.** Noticing somebody at the
  range you forget them at is a unit stuttering under a strobing plan ring. Three
  constants encode the band: `ACQUIRE_SLACK`, `UNCLAIMED_ACQUIRE_SLACK`,
  `RELEASE_SLACK`.
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

- 97 tests pass; production build passes; both Blender validators pass.
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
   Nothing else should be built on top until that file is decided. This is the
   oldest open item and it blocks the arm.
2. **Play the screened matchup and judge the balance**, per the tally above. If
   the hurler side is now too strong the dials are `MAX_SUPPORTERS_PER_TARGET`,
   `CLAIMED_TARGET_COST` and the hurler backpedal speed — not the targeting.
3. **Make the Blender port stop being a hand copy.** It is the one place the tool
   can silently desynchronise the project from itself. Emitting the tuning as JSON
   for the Python to read would end a whole class of wrong measurement.
4. **The sword has no tunables.** `applyCombatPose` still sums its coefficients
   inline, so `cut`, `guard` and `struck` scrub but do not edit. The same
   extraction the throws got would open them, and the torso check would run over
   the guards and cuts, which nobody has measured.
5. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   traces to its absence. It is a feature, and worth scoping properly.
6. **The throws have not been heard.** The release reuses the sword's `swing`
   whoosh, graded by throw. The standing lesson is that a fight wants its sound
   spent on contact. A coordinated volley is a new reason to care: two rocks
   landing together currently make the same noise as two landing apart.
7. **`hud=0` renders blank in headless capture.** Pre-existing, blocks the clean
   render path, small.
8. **Retake the capture sheets** used to judge poses; the ones in `renders/`
   predate the seed fix.
9. The projection is an open question, deliberately. What has not been tried:
   perspective at gameplay distance, and whether unit readability survives it at
   the zooms an RTS actually plays at.
10. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, and trails reading white-hot over bright ground.
