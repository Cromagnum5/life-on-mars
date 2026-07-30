# Session handoff

## Current checkpoint

`main` at `0102586` (this file). `hurler-stone-melee` was fast-forwarded into it
and is deleted.

`origin/main` is at `4d4600a manual animations tweaks`, so **everything up to and
including the user's own animation edits is pushed** and `main` is 5 commits
ahead of it — this session's four plus this file. Pushing is the user's call and
he has not made it.

Seven older branches are still lying around (`animation-tool`, `parry-the-cut`,
`remove-hurler-hip-rocks` and so on). All are merged and spent; none is worth
reading.

**The working tree is clean.** The previous handoff's blocking item — hurl arm
keys saved out of the animation tool that released the hurl *under* the pitch —
is closed. The user committed his own resolution as `4d4600a manual animations
tweaks`, and the ordering now measures hurl 3.80 > pitch 3.78 > toss 3.55 in the
Blender frame. See "The ordering the throws read by", because the margin is two
centimetres and this session spent some of it.

This session, oldest first:

- `f4e36dc` Fight with the stone when somebody is on top of you
- `189c655` Put the stone in the fist and the off hand back on its own side
- `b7dcfa9` Hang the stone elbow instead of winging it out
- `b6271b9` Hold the cover while two bodies work a hurler

The first is the feature; the other three are pose faults the user found by
playing it, in the order he found them. That order is the useful part — see "What
playing it caught".

## Checks

```sh
npm test        # 118 pass
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
  SwiftShader in the background is enough to push them over. Seen once this
  session, immediately after a `npm run build` in the same command. Re-run with
  the machine idle before believing them.
- Vite's warning about the shared chunk exceeding 500 kB is known and
  non-blocking.

## What the Hurler is now

A ranged unit on the same skeleton, no sword, a rock in hand. Out at range it
picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | 3.2 m to 4.3 m | 11 m/s | 8 | 0.30 s |

**The toss band shrank at the bottom this session.** It is what is left of sword
reach once stone reach is taken out of it: close enough to be worth a pebble, far
enough that nobody has actually reached the thrower. A hurler does not throw at a
body standing inside `STONE_RANGE` — it hits it with the rock.

Inside `STONE_RANGE` (3.2 m) it fights, and that is the new half of the unit.
`AGENTS.md` has the full rules under **The hurler's close fight**; the short
version is four strikes picked by how much time the fighter has:

| strike | needs | motion | recovery | damage |
| --- | --- | --- | --- | --- |
| `hammer` | most warning | 1.22 s | 0.68 s | 38 |
| `swing` | a window | 1.02 s | 0.54 s | 28 |
| `jab` | a moment | 0.56 s | 0.28 s | 14 |
| `punch` | nothing | 0.36 s | 0.20 s | 9 |

`readIncoming` files, per fighter, what is committed to arriving and how soon;
`STONE_PROFILES.load` is what each strike costs out of that. A punch costs
nothing, so there is always something left to throw, and a riposte — planned
inside what is left of the attacker's recovery — is always one.

`src/stone.test.ts` pins all of it, director and poses, and is the file to read
before changing any of it.

## What playing it caught

Four rounds. The feature landed measured — reach, arm clearance, feet, drop all
checked against the real GLB — and the user still found three faults in it by
looking at it. Every one was measurable *after* he named it, and none was
measured *before*, because in each case nobody had thought to ask that question.
That is the pattern worth carrying, not the specific numbers.

**1. "The rock is back too far in their arm."** Two causes. The rock is 0.56 m
across, the fist is 0.28 m, and the hand mesh is centred on the wrist bone, so at
the 0.2 m `ROCK_IN_HAND` had always carried, the stone's near face sat 0.08 m
*behind* the wrist and swallowed the hand. **That was true for the throws too and
had been for months** — it only became visible when a fighting hurler started
holding the rock up at its shoulder instead of down at its hip. And the stone
stance's 0.72 rad of wrist swung the rock back *down the forearm*: measured at
0.80 of the way from elbow to fist. The ratio along the elbow-to-fist line is the
number; 1.0 is in the fist.

**2. "The off hand is crossed awkwardly in front of the chest."** Solved for a
hand in front of the sternum, it crossed 0.12 m past the centre line with the
forearm over the ribs.

**3. "The stone elbow is up a bit too high."** This is the instructive one. The
arm had been solved for the **grip alone**, so to put the rock where it was asked
for, the shoulder abducted 1.15 rad and left the elbow winged out 0.69 m to the
side and only 0.30 m below the shoulder. The throwing stance, which has had far
more eyes on it, hangs its elbow 0.75 m below. **Solve the elbow as well as the
grip** — where it rides is half of what a guard reads as.

**4. "I only see them cover when they die."** Literally true, and the diagnosis:
a defeated fighter keeps whatever pose it was last given, because `update`
returns into the toppling branch before any posing once health hits zero — and
dying is disproportionately the moment two attackers are both on you. The cover
was up for 1% of a crowded fight. Three independent causes, all in
`AGENTS.md`: an unreachable arc, one window doing two jobs, and a posture gated
to the frames a blow landed.

## The arm solver

Written this session, thrown away, and worth writing again the next time a pose
is needed. It is how every stone key was made and how the three fixes above were
resolved.

Coordinate descent with random restarts over the five arm angles
(`upperX/Y/Z, lowerX, handX`), scoring against a **written-down world position**
for the grip — plus, as needed, an elbow position, a wrist limit, and a torso
clearance floor. It poses the bones directly off their captured rest quaternions
exactly as `setBoneOffset` does, so it can solve for poses that do not exist yet,
and it runs in a scratch `*.test.ts` against the real GLB in about a second.

Two things it taught that are not obvious:

- **Chain the keys.** Solve each key seeded from the previous one, with a small
  penalty per radian of drift. Solved independently, two adjacent keys can both
  measure correctly and sit in different Euler branches, and the arm teleports
  between them.
- **Score everything you care about, or the solver will spend it.** Given only a
  grip it produced a chicken-wing; given only a grip and a clearance it produced a
  cocked wrist that hid the rock behind the hand. Each fault was the solver
  correctly optimising a target that did not mention the thing that was wrong.

## The ordering the throws read by

**Read this before touching the arm or the rock.** The three throws have to
release in order — hurl above pitch above toss — because that ordering is how the
unit's three ranges read as three different throws rather than one throw at three
speeds.

Blender frame, measured this session: **3.80 / 3.78 / 3.55**. The hurl's margin
over the pitch is **0.02 m**, down from 0.04 before `ROCK_IN_HAND` moved out.
Moving the rock raised all three and did not reorder them, and the validator
passes — but two centimetres is thin enough that the next change in this area
could invert it, and the validator failing is how you would find out.

**These numbers are in Blender's frame, not the tool's.** The animation tool
reports the same heights from a different origin. Both are right, they are not
comparable across instruments, and only within one. Whichever you use, use one.

## Which instrument to trust

There are **four**, they disagree, and each has shipped a wrong pose the others
would have caught.

**1. The arithmetic in `rigwalker.ts`** (`ankleLift`, `ankleReach`, `hurlStep`,
`stoneStep`) is planar and knows nothing about rotation about the vertical. Right
about what a pose *costs*, wrong about where anything ends up once the body
turns. It once said the lead foot was planted while the rig had it skating a
quarter of a metre. Do not tune a foot against it.

**2. `tools/render_rigwalker_throw.py`** ports the pose onto the real GLB and
measures it. Authoritative about the arm, the rock, and what a throw asks the
legs for. It stops before `applyBalancePose`, so it is **not** authoritative
about where a foot is on screen.

```sh
MEASURE=1 blender --background --python tools/render_rigwalker_throw.py
FEET=1 MEASURE=1 blender ...   # a hurl foot by foot, fifty phases
ARM=1  MEASURE=1 blender ...   # the free arm's depth inside the torso box
```

`MEASURE=1` skips the renders, which are most of the runtime: a stance question
is ten seconds, not three minutes.

**It is a hand port and reads nothing.** Every number the animation tool saves
has to be copied into it by hand. `ROCK_IN_HAND` is now in this list too — it is
in both files and every release height is measured from it.

**3. `tools/capture_sim.sh`** drives the real game and has seen every pose layer.
Final say on silhouette, and the only one that sees a pose inside a real fight.

```sh
EXTRA='zoom=5.5&on=HR1' tools/capture_sim.sh /tmp/sheet "1h in close" 3 2.4
```

**4. `anim.html`** is the same three layers as (3), interactive, at a phase that
holds still. The right instrument for *authoring* and for anything about the free
arm.

**And a fifth, for anything the four cannot see:** a scratch `*.test.ts` that
loads the GLB and measures. That is how the stone poses were made and how every
fault this session was confirmed. Use `parry.test.ts` or `stone.test.ts` as the
template — they stage a pinned pair and hold a phase until the balance spring
settles. Two things this rig gets wrong if they are not done every frame: a held
phase lets the separation force shove the pair apart, and the facing update lives
inside the moving branch of `update`, so a standing fighter never turns and both
have to be aimed by hand.

## Architecture notes worth preserving

- **A hurler enters a mutual duel now, but only when charged into one.** Two ways
  in and neither is redundant: the promotion pass turns a swordsman's support
  encounter into a trade at `STONE_RANGE`, and the mutual-candidate pass pairs a
  hurler with an enemy already that close — needed because a hurler does not
  throw at a body on top of it, so it may have no encounter to be promoted out
  of, and with nothing published nobody would ever engage it. Out at throwing
  range it is still a one-sided `ranged` encounter and still never promoted.
- **A defensive plan hands the attack to the other fighter**, so `react` and
  `distance-trap` are off the table against a hurler — they made it the attacker
  of a *sword* exchange, cutting with a weapon it does not carry. Sizing one up is
  fine; that leaves the attack where it was.
- **`primaryParticipants` must be maintained by every pass that creates a mutual
  pair.** The battery pass reads it to know which throwers are busy. The
  candidate pass did not add to it, and a hurler that paired off there was handed
  a second, ranged encounter on the same frame and drove both.
- **A fighter may drive only one encounter.** Anything that hands a fighter a
  second writes two cues a frame and reads as neither.
- **Being hit outranks what you were planning.** `writeCue` arbitrates *only*
  that case, which is why the rule above has to hold everywhere else.
- **A defender's cue carries the attacker's plan.** Anything keyed off
  `cue.strategy` to decide what a fighter *is* will flicker several times an
  exchange. `closeFight` reads the gap instead.
- **Acquire ranges must stay inside release ranges.** Noticing somebody at the
  range you forget them at is a unit stuttering under a strobing plan ring.
  `ACQUIRE_SLACK`, `UNCLAIMED_ACQUIRE_SLACK`, `RELEASE_SLACK`, and now
  `STONE_RANGE` against `STONE_RELEASE_RANGE`.
- **The strike is resolved at release, replayed on arrival.** The `throw` event
  carries speed, flight time and the already-rolled outcome.
- **The step is a model offset, not movement.** The director owns where a unit
  stands. Local +Z is forward. The health bar rides it; the selection ring does
  not, because the ring marks the ground the unit holds.
- **Rock size and arc are drawn from the rendered result, not from physics.**
- **Sparks are point sprites and get no perspective divide for free.**
- **Clear the imported animation data before rendering in Blender.** The GLB
  carries Idle, Walk and CombatIdle and Blender re-applies whichever action is
  assigned on every render. Miss this and the measurements are right while every
  picture shows a unit standing still.

## The rig has no IK, and that decides more than taste

The hips are pinned to the terrain and each leg is two rigid bones, so **a foot
cannot reach out and stay on the ground** — it travels an arc. The folded knee is
the biggest lifter; the root bone sits on the ground, not at the hips, so
pitching it swings the whole skeleton about the soles.

This is why a stone strike lunges *and* strides: the grip only reaches 1.65 m in
front of the fighter, measured, so the arm alone cannot cross the gap to an
opponent that may not stand closer than `MIN_FIGHT_DISTANCE`. Travel the legs do
not make is a foot sliding along the ground, so `STONE_LUNGE` and `stoneLegs`
have to be sized against each other.

`applyBalancePose` is authored for a fighter that is only standing, so its leg
authority is `1 - engagement`. Its lean and hit reaction are never scaled. **Only
one layer may own the legs** — and the same rule holds for arms, which is why the
guard is blended *toward* rather than added on.

## A seed is only worth what nothing else can touch

`combatId` is `group.id`, three.js's **global object counter**, and five sites in
`rigwalker.ts` once used that number as each unit's own beat. Adding one camera
to the sim shifted every id and moved every fighter in every seed by about half a
metre at six seconds, with an event log and damage tally that matched exactly. A
capture sheet compared against that looks like a pose regression and is not one.

**The rule: anything that changes how a unit moves must come from an injected
random stream** — never an id, a counter, an array index, or the wall clock.

## The camera, and both modes stay

The user is still deciding what the game is and is using the camera to look
around. **Keep both projections.** Controls are identical in all three pages:
`WASD` pans in the camera's own frame, `←` `→` orbit, `↑` `↓` raise and lower
between 6° and 84°, `P` swaps projection, the wheel zooms. `src/world.ts` owns
all of it.

Three things easy to get wrong: orthographic has **no distance term at all**, so
what the user reported as "units get bigger further away" is the ground
compressing while the unit does not; judge camera questions **in the game**,
where things are spread over 180 m, never in the sim; and perspective must spend
zoom on **distance, never the lens**, because a telephoto flattens the depth the
projection exists for.

## The animation tool

`AGENTS.md` has the full rules. It is **not** a keyframe editor for the GLB — the
combat poses are not in the model. What it edits is `src/pose-tuning.ts`, and
**Save** writes that file through a dev-only Vite route, replacing only what is
below the marker at the foot of it.

The user's own words on it were "wonderful" and "I understand how to use it
intuitively". Treat the interaction as something worth protecting.

The stone strikes are in it as motions — `hammer`, `swing`, `jab`, `punch`,
`ward`, `cover` — but they **scrub and do not edit**, like the sword's poses,
because their numbers are constants in `rigwalker.ts` rather than in
`pose-tuning.ts`. There are now more motions than number keys: `1`-`9` reach the
first nine and the rest are a click on the bar.

Rules the tool work found, still true: a slider must not own the keyboard; a
restore must not enumerate fields; a mark must line up with the thumb; the glTF
loader strips dots out of node names (`Elbow.L` is `ElbowL`); saving reloads the
page, so `Revert` after a `Save` reverts to the *saved* values and undoing a save
is a git job.

## Measured state

- 118 tests pass; production build passes; both Blender validators pass. The
  sword duel is untouched this session and still reads foot drift 0.069 m,
  recovery error 0.00 degrees.
- Release heights, Blender frame: **3.80 / 3.78 / 3.55**. The hurl's margin over
  the pitch is **0.02 m** and it is the budget.
- Free arm clearance through a hurl: tightest **0.069 m** at phase 0.92,
  unchanged this session.
- Stone strikes at the frame the director resolves: hammer and swing land within
  **0.1 m** of the opponent's torso, jab 0.30 m, punch 0.44 m. Both arms stay
  clear of the chest across twenty phases of every strike. `stoneStep` drop stays
  under 0.09 m.
- Stone stance: elbow **0.68 m** below the shoulder and 0.36 m out; rock at
  **1.02** along the elbow-to-fist line; off hand 0.38 m on its own side.
- Balance, `1h v 1` over 24 seeds: **14 sword / 10 hurler**, against 12/12 before
  the close fight. Two swords onto one hurler kill it in **20 of 20** at a median
  of 7.6 s. The cover makes a hurler defend itself, not survive.
- Capture sheets in `renders/` predate the seed fix and no longer match.
  `renders/` is gitignored.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **Play the close fight and judge the four strikes.** They are measured but not
   judged: whether `hammer`, `swing`, `jab` and `punch` are distinguishable in
   motion at gameplay speed, and whether the lunge reads as stepping in or as
   sliding, are questions only playing answers. `1h in close` and `1h v 2 close`
   in the sim exist to stage exactly this, and the six stone motions in the anim
   tool to scrub it.
2. **The hurl/pitch release margin is down to two centimetres.** Either widen it
   deliberately or accept that the validator is the only thing standing between
   the project and a hurl that reads as a pitch.
3. **Make the Blender port stop being a hand copy.** It is the one place the
   project can silently desynchronise from itself, and `ROCK_IN_HAND` just joined
   the list of things that have to be kept in step by hand. Emitting the tuning as
   JSON for the Python to read would end a whole class of wrong measurement.
4. **The sword has no tunables**, and now neither do the stone strikes.
   `applyCombatPose` and `applyStonePose` both sum inline. The same extraction the
   throws got would open them, and the torso check would run over the guards and
   cuts, which nobody has measured.
5. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   and the stone lunge traces to its absence. It is a feature, and worth scoping
   properly.
6. **The close fight has not been heard.** A stone strike reuses the sword's
   contact sounds. A two-handed hammer landing and a punch landing currently make
   the same noise graded only by intensity, and the standing lesson is that a
   fight wants its sound spent on contact.
7. **`hud=0` renders blank in headless capture.** Pre-existing, hit again this
   session, blocks the clean render path, small.
8. **Retake the capture sheets** used to judge poses; the ones in `renders/`
   predate the seed fix.
9. The projection is an open question, deliberately. What has not been tried:
   perspective at gameplay distance, and whether unit readability survives it at
   the zooms an RTS actually plays at.
10. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, and trails reading white-hot over bright ground.
