# Session handoff

## Current checkpoint

`main` at `c789ee5` plus this file on top of it. `measure-the-frame` was
fast-forwarded into `main` and is deleted.

`origin/main` is at `16c0d0e Point the handoff at the hurler's close fight`, so
everything up to and including the previous session is pushed and `main` is
**two commits ahead** of it — this session's one plus this file. Pushing is the
user's call and he has not made it.

Eight older branches are still lying around (`animation-tool`, `parry-the-cut`,
`rigwalker-hurler` and so on). All are merged and spent; none is worth reading.

**The working tree is clean.** Nothing from the previous session was left open.

This session is one commit:

- `c789ee5` Say where the frame went, and give it enough bodies to matter

He asked for four things — frame rate, unit count, CPU per code path, and army
matchups at a balanced sword-to-hurler ratio — and all four are in. The fourth
turned up a balance problem that is worth reading before anything is tuned: see
**Three to one is the even point on a slope**.

## Checks

```sh
npm test        # 125 pass
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
  SwiftShader in the background is enough to push them over. Re-run with the
  machine idle before believing them.
- Vite's warning about the shared chunk exceeding 500 kB is known and
  non-blocking.

## The perf panel

`src/perf.ts`. Both pages carry the same panel, in the same shape: frame rate,
how many bodies are being simulated, the wall-clock frame in milliseconds with
what the timed paths add up to as a percentage of it, then five named paths.

| path | what is charged to it |
| --- | --- |
| `ai` | `CombatDirector.update`, **and** building the snapshot array it is fed |
| `physics` | `unit.update` for every unit, damage application, the game's producers and camera |
| `fx` | audio listener and playback, `presentEvents`, defeat flashes, blade trails, `effects.update` |
| `render` | `renderer.render` alone |
| `hud` | the readout, the log, the roster, and the perf panel's own redraw |

`BattleRuntime` charges the first three itself, so anything driving it gets them
free; each page charges `render` and `hud` around its own calls. Pass a shared
`PerfMonitor` in through `BattleOptions.perf` or the runtime keeps a private one
and nobody reads it.

Four decisions in there that are not obvious and should not be undone:

- **Shares are of the frame that actually happened**, not of a 16.7 ms budget.
  So what the paths do not add up to is visible, and it is the browser's: vsync
  waits, compositing, GC, layout. A path reading 15% is 15% of a real frame.
- **`measure(path, work)` rather than `begin`/`end`.** A mismatched pair
  misattributes silently, and a profiler that lies is worse than none. Costs
  accumulate per path within a frame, which is what lets the unit update and the
  blade sampling that has to follow it be one path rather than whichever half
  was measured last.
- **The clock is injected**, which is how the smoothing is tested without
  waiting for real frames — `perf.test.ts` runs a few hundred synthetic frames
  in milliseconds.
- **The panel charges its own redraw to `hud`.** An instrument that leaves
  itself out reports a frame nobody has.

Stalls are dropped rather than averaged in: any interval over half a second —
a backgrounded tab, a breakpoint, the sim's headless burst — throws that frame's
costs away instead of poisoning the average for the next several seconds.

**The wall clock must never reach the fight.** This is the same rule as the
seeded-stream one below, with a new way to break it. `performance.now()` is now
in the codebase; nothing that decides how a unit moves may read it.

## Three to one is the even point on a slope

The new army matchups field **three swords to one hurler**, and that number is
measured rather than picked. But the measurement turned up something more
important than the number, and it is the first thing to know before tuning
anything about the hurler.

Round-robin of every mix from all-sword to all-hurler, sixteen a side, both
sides of the field, eight seeds each way, real director and real `unit.update`:

| mix | net across the field |
| --- | --- |
| 16s / 0h | −96 |
| 14s / 2h | −60 |
| **12s / 4h** | **−10** |
| 10s / 6h | +24 |
| 8s / 8h | +14 |
| 4s / 12h | +56 |
| 0s / 16h | +72 |

Twelve-and-four is level against the field, and it is also what the game
produces — the Assembly Bay puts out three swords an opening and the Stoneworks
one hurler — so the sim now stages the army the player actually gets. That is
why `SWORDS_PER_HURLER` is 3.

**It is not an equilibrium. The field is a slope.** All-sword loses to every
single mix 0–16. Each further hurler is worth more than the sword it replaced,
monotonically, right up to an all-hurler army that beats everything. Three to
one is the even point on a curve that never turns over.

The mechanism is visible in a 64v64 capture at eight seconds: a dozen hurlers
all release at the *same* target within a tenth of a second, and the log is a
wall of `hurl at H16`. A hurler is roughly a fair fight one-on-one — the
previous session measured 14 sword / 10 hurler over 24 seeds — and two swords
kill one 20 of 20. None of that survives contact with mass, because at sixteen
metres the swords have no answer at all until they arrive, and massed throwers
delete the front rank during the walk.

**If massed hurlers are meant to be beatable, that is a combat question, not a
roster one.** Candidates nobody has tried: a throw that cannot be aimed at a
target already committed to by N throwers, a much longer reload at the top band,
or making the approach cheaper — shields, a charge, anything that makes crossing
sixteen metres cost less than it currently does.

**The sweep harness was scratch and was deleted.** To rebuild it: copy
`runFight` from `hurler.test.ts` — director plus `unit.update` plus
`applyCombatDamage`, which is the real thing — stage two team lines the way
`startMatch` in `sim.ts` does, run to a wipe or 90 s, and score wins. It runs a
16-a-side round-robin in about two minutes. Note that `console.log` is swallowed
by this vitest setup; append to a file instead.

## What the Hurler is

Untouched this session. A ranged unit on the same skeleton, no sword, a rock in
hand. Out at range it picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | 3.2 m to 4.3 m | 11 m/s | 8 | 0.30 s |

A hurler does not throw at a body standing inside `STONE_RANGE` (3.2 m) — it
hits it with the rock. That close fight is four strikes picked by how much time
the fighter has:

| strike | needs | motion | recovery | damage |
| --- | --- | --- | --- | --- |
| `hammer` | most warning | 1.22 s | 0.68 s | 38 |
| `swing` | a window | 1.02 s | 0.54 s | 28 |
| `jab` | a moment | 0.56 s | 0.28 s | 14 |
| `punch` | nothing | 0.36 s | 0.20 s | 9 |

`AGENTS.md` has the full rules under **The hurler's close fight**. `readIncoming`
files, per fighter, what is committed to arriving and how soon; `STONE_PROFILES.load`
is what each strike costs out of that. A punch costs nothing, so there is always
something left to throw, and a riposte — planned inside what is left of the
attacker's recovery — is always one.

`src/stone.test.ts` pins all of it, director and poses, and is the file to read
before changing any of it.

## The sim's matchups

Rosters now form up in **blocks**: each role centred on its own ranks, up to
`MAX_FILES` across before a second rank, swords in front, throwers set back
behind the *whole* screen rather than behind their own first rank.

- **`2h+2 v 4` restaged and its seeds have moved.** It used to lay melee and
  hurlers out side by side in one long mixed line, which put the screen off to
  one side of the throwers it was meant to be screening. Every all-melee matchup
  lands exactly where it always did — verified against the old arithmetic.
- **Past twelve fighters the readout stops issuing a card each** and says what
  each side has left instead. A hundred and twenty-eight cards is not a readout,
  and building them was the most expensive thing on the page. The `hud` row now
  says so out loud rather than burying it in the total.
- **The arena is wider** — 112 m — so a sixty-four a side line pulled back to fit
  still has ground under it. This moved no fight: `terrainHeightAt` is a function
  of world position, not of the patch drawn around it, so every seeded fight
  lands on the height it always did. Only the backdrop and the scattered rocks
  changed, and the sim passes `obstacles: []` so rocks were never in a fight.
- `16v16`, `32v32` and `64v64` are past the ninth entry, so the `1`–`9` keys do
  not reach them. Buttons only, same as `1h in close` before them.

## Which instrument to trust

There are **four**, they disagree, and each has shipped a wrong pose the others
would have caught.

**1. The arithmetic in `rigwalker.ts`** (`ankleLift`, `ankleReach`, `hurlStep`,
`stoneStep`) is planar and knows nothing about rotation about the vertical. Right
about what a pose *costs*, wrong about where anything ends up once the body
turns. Do not tune a foot against it.

**2. `tools/render_rigwalker_throw.py`** ports the pose onto the real GLB and
measures it. Authoritative about the arm, the rock, and what a throw asks the
legs for. It stops before `applyBalancePose`, so it is **not** authoritative
about where a foot is on screen.

```sh
MEASURE=1 blender --background --python tools/render_rigwalker_throw.py
FEET=1 MEASURE=1 blender ...   # a hurl foot by foot, fifty phases
ARM=1  MEASURE=1 blender ...   # the free arm's depth inside the torso box
```

**It is a hand port and reads nothing.** Every number the animation tool saves
has to be copied into it by hand, `ROCK_IN_HAND` included.

**3. `tools/capture_sim.sh`** drives the real game and has seen every pose layer.
Final say on silhouette, and the only one that sees a pose inside a real fight.

```sh
EXTRA='zoom=5.5&on=HR1' tools/capture_sim.sh /tmp/sheet "1h in close" 3 2.4
```

**4. `anim.html`** is the same three layers as (3), interactive, at a phase that
holds still. The right instrument for *authoring* and for anything about the free
arm.

**And a fifth, for anything the four cannot see:** a scratch `*.test.ts` that
loads the GLB and measures. Use `parry.test.ts` or `stone.test.ts` as the
template — they stage a pinned pair and hold a phase until the balance spring
settles. Two things this rig gets wrong if they are not done every frame: a held
phase lets the separation force shove the pair apart, and the facing update lives
inside the moving branch of `update`, so a standing fighter never turns and both
have to be aimed by hand.

**None of the five can measure a frame rate**, and this is a new trap. The sim's
`t=` capture mode bursts the whole fight through synchronously and then redraws
one frozen frame, so it has no frame rate to report — the perf panel deliberately
removes itself in that mode rather than showing a screenshot full of dashes. And
headless Chrome here runs through SwiftShader at about 4 fps, which is the
software rasteriser and not the game. **Real frame numbers only exist in a real
browser on his machine.**

## The ordering the throws read by

**Read this before touching the arm or the rock.** The three throws have to
release in order — hurl above pitch above toss — because that ordering is how the
unit's three ranges read as three different throws rather than one throw at three
speeds.

Blender frame: **3.80 / 3.78 / 3.55**, unchanged this session. The hurl's margin
over the pitch is **0.02 m** and it is the budget. Two centimetres is thin enough
that the next change in this area could invert it, and the validator failing is
how you would find out.

**These numbers are in Blender's frame, not the tool's.** The animation tool
reports the same heights from a different origin. Both are right, they are not
comparable across instruments, and only within one.

## The arm solver

Written two sessions ago, thrown away, and worth writing again the next time a
pose is needed. Coordinate descent with random restarts over the five arm angles
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

## Architecture notes worth preserving

- **A hurler enters a mutual duel, but only when charged into one.** Two ways in
  and neither is redundant: the promotion pass turns a swordsman's support
  encounter into a trade at `STONE_RANGE`, and the mutual-candidate pass pairs a
  hurler with an enemy already that close — needed because a hurler does not
  throw at a body on top of it, so it may have no encounter to be promoted out
  of, and with nothing published nobody would ever engage it.
- **A defensive plan hands the attack to the other fighter**, so `react` and
  `distance-trap` are off the table against a hurler — they made it the attacker
  of a *sword* exchange, cutting with a weapon it does not carry.
- **`primaryParticipants` must be maintained by every pass that creates a mutual
  pair.** The battery pass reads it to know which throwers are busy.
- **A fighter may drive only one encounter.** Anything that hands a fighter a
  second writes two cues a frame and reads as neither.
- **Being hit outranks what you were planning.** `writeCue` arbitrates *only*
  that case, which is why the rule above has to hold everywhere else.
- **A defender's cue carries the attacker's plan.** Anything keyed off
  `cue.strategy` to decide what a fighter *is* will flicker several times an
  exchange. `closeFight` reads the gap instead.
- **Acquire ranges must stay inside release ranges.** Noticing somebody at the
  range you forget them at is a unit stuttering under a strobing plan ring.
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
metre at six seconds, with an event log and damage tally that matched exactly.

**The rule: anything that changes how a unit moves must come from an injected
random stream** — never an id, a counter, an array index, or the wall clock. The
wall clock is the live one now that `performance.now()` is in the codebase; see
**The perf panel**.

## The camera, and both modes stay

The user is still deciding what the game is and is using the camera to look
around. **Keep both projections.** Controls are identical in all three pages:
`WASD` pans in the camera's own frame, `←` `→` orbit, `↑` `↓` raise and lower
between 6° and 84°, `P` swaps projection, the wheel zooms. `src/world.ts` owns
all of it.

Three things easy to get wrong: orthographic has **no distance term at all**, so
what the user reported as "units get bigger further away" is the ground
compressing while the unit does not; judge camera questions **in the game**,
where things are spread over 180 m; and perspective must spend zoom on
**distance, never the lens**, because a telephoto flattens the depth the
projection exists for.

## The animation tool

`AGENTS.md` has the full rules. It is **not** a keyframe editor for the GLB — the
combat poses are not in the model. What it edits is `src/pose-tuning.ts`, and
**Save** writes that file through a dev-only Vite route, replacing only what is
below the marker at the foot of it.

The user's own words on it were "wonderful" and "I understand how to use it
intuitively". Treat the interaction as something worth protecting. **It writes
`src/pose-tuning.ts` while he plays**, so check `git status` before staging
broadly.

The stone strikes are in it as motions — `hammer`, `swing`, `jab`, `punch`,
`ward`, `cover` — but they **scrub and do not edit**, like the sword's poses,
because their numbers are constants in `rigwalker.ts` rather than in
`pose-tuning.ts`.

Rules the tool work found, still true: a slider must not own the keyboard; a
restore must not enumerate fields; a mark must line up with the thumb; the glTF
loader strips dots out of node names (`Elbow.L` is `ElbowL`); saving reloads the
page, so `Revert` after a `Save` reverts to the *saved* values and undoing a save
is a git job.

## Measured state

- 125 tests pass (118 before, plus 7 for `PerfMonitor`); production build passes.
- Per-frame CPU, **node, fallback visual, no bone posed**, averaged over the
  first eight seconds of a fight:

  | bodies | `ai` | `physics` |
  | --- | --- | --- |
  | 2 | 0.026 ms | 0.074 ms |
  | 10 | 0.083 ms | 0.221 ms |
  | 32 | 0.163 ms | 0.540 ms |
  | 64 | 0.415 ms | 1.540 ms |
  | 128 | 0.563 ms | 5.988 ms |

  **`physics` is the quadratic one and it is separation** — every unit walks
  every other unit, every frame. `ai` stays comparatively cheap even though the
  candidate pairing is also a double loop. The browser will read higher than
  both, because these never posed a bone and never drew anything.
- The sword duel is untouched and still reads foot drift 0.069 m, recovery error
  0.00 degrees. Release heights, Blender frame: 3.80 / 3.78 / 3.55.
- Balance, `1h v 1` over 24 seeds: 14 sword / 10 hurler. Two swords onto one
  hurler kill it in 20 of 20 at a median of 7.6 s. **Neither number survives
  mass** — see the slope above.
- Capture sheets in `renders/` predate the seed fix and no longer match.
  `renders/` is gitignored.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **Open `64v64` in a real browser and read the panel.** Nothing in this repo
   can tell you the frame rate — see the end of "Which instrument to trust". Only
   once that has been read does anyone know whether the first optimisation is
   `physics`, `render` or `hud`. The node numbers say `physics`; they do not
   include skinning or drawing, so they are a prior and not an answer.
2. **Separation is O(n²) and is the obvious first cut** if the panel confirms
   `physics`. A uniform grid over the units, rebuilt once a frame, would turn it
   into a neighbourhood query. Nothing about it touches the director, so it
   cannot move a seeded fight — but check that it does not, because the seed rule
   above says everything about how easy that is to get wrong.
3. **The hurler dominates mass combat and nothing currently answers it.** The
   fullest statement is in "Three to one is the even point on a slope", including
   three candidate mechanisms. This is a design decision before it is a code one.
4. **Play the close fight and judge the four strikes.** Still not done. They are
   measured but not judged: whether `hammer`, `swing`, `jab` and `punch` are
   distinguishable in motion at gameplay speed, and whether the lunge reads as
   stepping in or as sliding. `1h in close` and `1h v 2 close` stage it.
5. **The hurl/pitch release margin is two centimetres.** Either widen it
   deliberately or accept that the validator is the only thing standing between
   the project and a hurl that reads as a pitch.
6. **Make the Blender port stop being a hand copy.** It is the one place the
   project can silently desynchronise from itself. Emitting the tuning as JSON
   for the Python to read would end a whole class of wrong measurement.
7. **The sword has no tunables**, and neither do the stone strikes.
   `applyCombatPose` and `applyStonePose` both sum inline.
8. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   and the stone lunge traces to its absence.
9. **The close fight has not been heard.** A stone strike reuses the sword's
   contact sounds; a two-handed hammer and a punch make the same noise graded
   only by intensity.
10. **`hud=0` renders blank in headless capture.** Pre-existing, small, blocks
   the clean render path.
11. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, trails reading white-hot over bright ground, retaking the capture
   sheets, and the projection question — perspective at gameplay distance, and
   whether unit readability survives it at the zooms an RTS actually plays at.
