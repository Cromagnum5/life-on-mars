# Session handoff

## Current checkpoint

`main` at `6636ccf`. The session's branch `fight-the-man-in-front` was
fast-forwarded into it at his word and still exists, fully merged.

`origin/main` is at `115a6b1`, so `main` is **six commits ahead of it**. Pushing
is his call and he has not made it.

Nine older branches are lying around (`animation-tool`, `parry-the-cut`,
`rigwalker-hurler` and so on). All merged and spent; none is worth reading.

**The working tree is clean.**

The session came out of one report from play, in his words: the frontline
swordsmen *"do not engage each other much… trying to walk through each other"*,
and *"an excessive amount of hurlers select the same target"*. Both were real,
both are fixed, and fixing the second one moved the game's balance.

- `e5a92d1` Let a swordsman fight the enemy in front of it
- `a4da149` Split the battery instead of putting sixteen rocks on one man
- `417b100` Stage a hundred and twenty-eight a side
- `ff372e4` Write down that three to one is no longer the even point
- `09d6480` Index the bodies by where they stand

Two numbers are the whole story: **three swords to a hurler is no longer the
even point — one to one is**, and **`physics` at 256 bodies went from 38 ms a
frame to 3.4**.

## Checks

```sh
npm test        # 134 pass
npm run build
blender --background --python tools/render_rigwalker_throw.py
blender --background --python tools/render_rigwalker_duel.py
npm run dev     # 0.0.0.0:5173, so http://10.0.0.102:5173 from another machine
```

Three pages: the game at `/`, the combat sim at `/sim.html`, the animation tool
at `/anim.html`. The sim's bar links to the tool and the tool's back.

Three things that look like failures and are not:

- **Two tests in `combat.test.ts` time out under CPU load.** They are seed loops
  (32 and 120 seeds) inside a 5 s budget, and a headless Chrome rendering through
  SwiftShader in the background is enough to push them over. Re-run with the
  machine idle before believing them.
- Vite's warning about the shared chunk exceeding 500 kB is known and
  non-blocking.
- **`console.log` in a vitest run is not swallowed** — an earlier handoff said it
  was, and that cost a session. It is *hidden by default*. `npx vitest run
  path.test.ts --reporter=verbose --silent=false` prints it. Writing to a file
  with `appendFileSync` still works and is better for anything long, because the
  output survives the run.

## The frontline: a charge used to be a commitment nothing could break

**Read this before touching target selection.**

A fighter that acquired a target held it until that target died or drifted past
the release band, and "walk at it" was the whole of its behaviour on the way.
That is right for one fighter crossing open ground. When two lines collide it is
ruinous, because almost every body in both of them is mid-charge at somebody
three ranks back — and `CLAIMED_TARGET_COST`, the spreading rule that stops three
swords piling onto one man, is exactly what aims them past the near enemy at the
far ranks. Two enemies would meet at arm's length, each unable to see the other,
shoulder past, and grind on. That is what a front rank walking through itself is.

The fix is `LINE_CONTACT_RANGE` (one sword's reach) plus a `charging` set in
`CombatDirector.update`. A fighter held by nothing but a one-sided melee support
it drives is reserved **only against the far half of the field**: an enemy inside
reach outranks whatever it set off after, the two pair off into a trade, and both
drop their charges — the same rule the promotion pass already worked by.

The band matters in both directions. Wider and a line re-pairs on every jostle;
narrower and nobody ever crosses ground to reach anything. `combat.test.ts` pins
both sides of that: *"turns two charges into a duel when they meet at reach"* and
*"leaves a charge alone while the enemy it passes is still off at a distance"*.

Measured headless at 64v64, swordsmen with an enemy inside reach they were
ignoring: **56 of 93 before, 33 after** at the moment of contact, 41 → 16 two
seconds later, 22 → 9 after that. The picture is the real evidence — the scrum
became a front with a seam down it.

**Roughly one in six of the front rank still has a target past reach at the
instant of collision.** Some of that is honest: two fighters committed to
partners, crossing. If it ever reads wrong again, the next thing to look at is
pairs that form at up to `AWARENESS_RANGE` (8.5 m) and then walk toward each
other *through* the crowd — that path was left alone deliberately.

## The battery splits

A team's hurlers picked **one** body together and every last one of them threw at
it. With four throwers that is a volley. With sixteen — which is what 64v64
fields — it is a body killed three times over while the rest of the line walks in
untouched. `chooseFocus` returned a single target per corporation and that was
the design, not an accident.

Now: a body is worth the rocks it takes to put it down and no more.
`throwersWorth` is one thrower per landed rock (`hurl` damage, less the deflect
and miss rates), floored at `MIN_THROWERS_PER_TARGET` = 2, because a single
thrower on a body is a body that may not go down. A fresh body comes to three.

- `chooseFocuses` takes bodies off the top of the old scoring until the
  battery's places are spoken for.
- `assignBattery` splits the throwers across them, closest pairing first, with
  `FOCUS_HYSTERESIS` for a thrower already working a body.
- **A place a thrower cannot reach is a place wasted** — it falls back on
  whatever is nearest, and the group it could not reach becomes a crowd somewhere
  else. `canThrowAt` gates the pairing on that. A hurler genuinely left over still
  falls back, which is the one case where piling on is right.

Rounded to the *nearest* rock, not up: a fresh body is 3.02, and the ceiling
would spend a fourth thrower on every enemy on the field to cover two per cent.

Throwers per target at 64v64 went from a flat `16,16` to `2,2,2,3,3,3…` across a
dozen bodies. A battery small enough to be spent on one body still picks only
that one, which is what keeps the existing pair-and-trio tests honest.

## Three to one is no longer the even point

**This is the most important thing in this file.** The old handoff said 12-and-4
was level against the field. It is not any more, and the battery fix is why.

Sweep re-run this session: every mix from all-sword to all-hurler, both sides of
the field, real director and real `unit.update`, 648 fights. Win rate against the
whole field:

| swords : hurlers | 16 a side | 32 a side | 64 a side |
| --- | --- | --- | --- |
| all sword | 0% | 0% | 0% |
| 7 : 1 | 12.5% | 12.5% | 12.5% |
| **3 : 1** | **29.7%** | **25.0%** | **25.0%** |
| 1.67 : 1 | 37.5% | 37.5% | 37.5% |
| **1 : 1** | **51.6%** | **52.1%** | **50.0%** |
| 0.6 : 1 | 62.5% | 62.5% | 62.5% |
| 1 : 3 | 81.3% | 77.1% | 84.4% |
| all hurler | 87.5% | 97.9% | 93.8% |

**One to one is the even point, and all three sizes agree on it to within two per
cent** — tighter agreement than the old number ever had.

The *shape* did not change. The field is still a slope with no turn in it:
all-sword loses every fight it plays, and each further hurler is worth more than
the sword it replaced. It is simply steeper. At 64 a side the ordering is very
nearly strict — more hurlers beats fewer hurlers in almost every fight.

This was foreseeable and was flagged before it was measured: wasted rocks were
most of what held massed throwers back, and the battery no longer wastes them.

**`SWORDS_PER_HURLER` stays at 3**, and its comment now says why: it records what
the player is handed — the Assembly Bay puts out three swords an opening and the
Stoneworks one hurler — and no longer claims to record what wins. Changing it
would stop the sim staging the army the game actually produces. **That is his
call and he has not been asked to make it.**

**If massed hurlers are meant to be beatable, that is a combat question and not a
roster one, and it is louder now than it was.** Candidates nobody has tried: a
much longer reload at the top band, or making the approach cheaper — shields, a
charge, anything that makes crossing sixteen metres cost less. (The third old
candidate, "a throw that cannot be aimed at a target already committed to by N
throwers", is now *implemented* — that is the battery split — and it made hurlers
stronger, not weaker, because the waste it removed was theirs.)

### Rebuilding the sweep harness

Scratch again, and deleted again. The recipe, which worked:

Copy the staging out of `startMatch` in `sim.ts` — `formationSlot`, `LINE_SPACING`
1.9, `RANK_SPACING` 2, `MAX_FILES` 16, the hurler setback, and `moveTo(side *
1.6, 0, lateral * 0.35)` — build both teams with `createRigwalker(null, …)` so it
uses the primitive fallback and needs no GLB, then loop: refresh the snapshots
off the units, `director.update`, apply `frame.damage` with `applyCombatDamage`,
`field.rebuild(units)`, `unit.update`. Stop on a wipe or 90 s and score wins.

Budget it against the clock. One fight costs roughly **1.4 s at 16 a side, 1.8 s
at 32, 10 s at 64**, so buy mix granularity and seeds accordingly — the run above
was step-2/4-seeds, step-4/3-seeds, step-8/2-seeds and took about 31 minutes
total on this box. Run it in the background; it saturates all four cores.

## `UnitField`: how `physics` stopped being quadratic

At 256 bodies `physics` was **38 ms a frame** — a sixty-hertz budget spent twice
over before anything was drawn.

Three things every Rigwalker did each frame walked the whole roster: the
separation drift, the clearance push, and a linear `find` for the unit its cue
names. None of it is a question about the army. Two bodies thirty metres apart do
not push on each other; the loop asked anyway. The scaling gave it away — four
times the pairs cost six and a half times the milliseconds, because the roster
had stopped fitting in cache.

`src/unit-field.ts` is a uniform grid on a 2.6 m cell (just over
`COMBAT_SEPARATION_RADIUS`, the largest query anything makes), rebuilt once a
frame by `BattleRuntime` after damage and before the first body moves. Cell
arrays are emptied rather than dropped, so a running fight allocates nothing.

| | `physics` before | after | `ai` |
| --- | --- | --- | --- |
| 64 bodies | 1.3 ms | 0.45 ms | 0.27 ms |
| 128 bodies | 5.7 ms | 1.0 ms | 0.45 ms |
| 256 bodies | **38.0 ms** | **3.4 ms** | 2.2 ms |

**It is exact, not approximate, and that is the part worth understanding.** A
grid normally drifts out of date because bodies move after it is built, and the
usual answer is to pad the cell and accept misses. This one cannot drift, because
of the order the frame runs in: a unit that has not been updated yet has not
moved, so its filed cell is still right, and a unit that has been updated
**re-files itself on the way out** of `update`. Every lookup therefore sees live
positions. `unit-field.test.ts` checks exactly that claim — every query against
reading the whole roster, including probe points between cells and after bodies
are shoved across cell edges.

If you add another neighbour query, route it through `forEachNear` and keep the
`refile` call last in `update`. `isWaypointTakenByCrowd` is the one loop left over
`field.living`, deliberately: how many bodies reached the waypoint first is not a
local question, and it only runs for a unit already stalled for a second.

## Why the frame was slow before that

**Read this before touching anything that draws.** Fully written up at the top of
`src/unit-render.ts`; the short version:

`public/models/rigwalker.glb` is **33 separate rigid meshes** — 960 triangles
across 5 materials — hung off a 17-bone armature, none of it skinned, every
animation channel targeting a bone. So all 33 parts have a local transform that
never changes. Fine for one fighter, ruinous for 128: it was **8,260 draw calls a
frame at 64v64. It is now 86**, and 86 again at 128v128 carrying 520k triangles.
`RigwalkerBatch` merges by material into `InstancedMesh`es and writes world
matrices per part per body.

The perf panel has a `draws` row and `?batch=0` turns the batch off, which is how
that number is read off rather than argued.

Two ribbon bugs from the same work, both confirmed gone by him and **neither ever
reproduced in a still** — a corpse kept `swinging` because everything below the
`health <= 0` early return in `update` never runs for it, and a pooled rock trail
inherited the previous rock's samples, drawing one long bright line between two
unrelated throws. `rockTrailOwner(slot)` exists so the two sites that depend on
that id cannot drift apart.

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
SIM_URL=http://localhost:5174/sim.html tools/capture_sim.sh /tmp/sheet 128v128 5 8 20
```

**4. `anim.html`** is the same three layers as (3), interactive, at a phase that
holds still. The right instrument for *authoring* and for anything about the free
arm.

**And a fifth, for anything the four cannot see:** a scratch `*.test.ts` that
loads the GLB and measures. `parry.test.ts` and `stone.test.ts` are the template
for poses; the sweep recipe above is the template for whole fights. Two things
this rig gets wrong if they are not done every frame: a held phase lets the
separation force shove a pair apart, and the facing update lives inside the moving
branch of `update`, so a standing fighter never turns and both have to be aimed by
hand.

**None of the five can measure a frame rate.** The sim's `t=` capture mode bursts
the whole fight through synchronously and redraws one frozen frame, and it
*removes the perf panel*. Running headless without `t=` keeps the panel but
Chrome's `--virtual-time-budget` makes every timing read 0.00 ms, and SwiftShader
is a software rasteriser and not the game. **Real frame numbers only exist in a
real browser on his machine.** `draws` and `units` are the exceptions and are
worth trusting anywhere — they are counts, not clocks. Everything CPU-side (`ai`,
`physics`) can be measured honestly in node, which is where the tables above come
from.

### Comparing two pictures, which is harder than it looks

- **The effects are not seeded.** The fight replays exactly, but `sparkBurst` and
  `rock` draw velocities and spin from `Math.random()`. Two runs of the *same* URL
  at `t=8` in 64v64 differ by ~1,100 pixels. **Compare at a moment before first
  contact** — `t=1` in a big matchup — where two identical runs are byte-identical
  and anything that differs is the change under test.
- **Always render the control.** Same URL twice, as the noise floor, alongside the
  A/B. Without it a real difference and a spark are the same number.
- **Capture mode cannot see anything about frame cadence**, by construction: it
  draws one frozen frame. Any bug living in the difference between consecutive
  frames — a half-rate shadow, a pooled slot recycling — is invisible to every
  screenshot in this repo.

For the determinism half of a check, read the tally out of `#tally` with Chromium
`--dump-dom`. That stays exact at any `t`, because it comes off the seeded fight
rather than off the effects:

```sh
chrome --headless=new --virtual-time-budget=180000 --dump-dom \
  "http://localhost:5173/sim.html?matchup=64v64&seed=1&t=20"
```

## What the Hurler is

A ranged unit on the same skeleton, no sword, a rock in hand. Out at range it
picks one of three throws from the current gap:

| throw | band | speed | damage | motion |
| --- | --- | --- | --- | --- |
| `hurl` | to 12 shoulder widths, 16.08 m | 32.5 m/s | 38 | 1.15 s |
| `pitch` | to twice sword reach, 8.6 m | 17 m/s | 19 | 0.62 s |
| `toss` | 3.2 m to 4.3 m | 11 m/s | 8 | 0.30 s |

A hurler does not throw at a body standing inside `STONE_RANGE` (3.2 m) — it hits
it with the rock. That close fight is four strikes picked by how much time the
fighter has:

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

Rosters form up in **blocks**: each role centred on its own ranks, up to
`MAX_FILES` (16) across before a second rank, swords in front, throwers set back
behind the *whole* screen rather than behind their own first rank.

- **`128v128` is new this session** — 256 bodies. The block does not get wider,
  because `MAX_FILES` holds a rank at sixteen, so it is the same line six ranks of
  swords deep instead of three. It opens at the same standoff as 64v64 and is only
  pulled back for the depth behind it; `MIN_ZOOM` at 0.7 already allowed for it and
  the matchup asks for 0.72.
- **Past twelve fighters the readout stops issuing a card each** and says what
  each side has left instead. Building the cards was the most expensive thing on
  the page.
- **The arena is 112 m wide**, which still holds the deepest line here. This moved
  no fight: `terrainHeightAt` is a function of world position, not of the patch
  drawn around it.
- The army matchups are all past the ninth entry, so the `1`–`9` keys do not reach
  them. Buttons only, same as `1h in close` before them.
- `LARGEST_MATCHUP` is derived from the table and handed to `RigwalkerBatch`, so
  adding a matchup grows the instance buffers on its own.

## The ordering the throws read by

**Read this before touching the arm or the rock.** The three throws have to
release in order — hurl above pitch above toss — because that ordering is how the
unit's three ranges read as three different throws rather than one throw at three
speeds.

Blender frame: **3.80 / 3.78 / 3.55**. The hurl's margin over the pitch is
**0.02 m** and it is the budget. Two centimetres is thin enough that the next
change in this area could invert it, and the validator failing is how you would
find out.

**These numbers are in Blender's frame, not the tool's.** The animation tool
reports the same heights from a different origin. Both are right, they are not
comparable across instruments, and only within one.

## The arm solver

Written, thrown away, and worth writing again the next time a pose is needed.
Coordinate descent with random restarts over the five arm angles (`upperX/Y/Z,
lowerX, handX`), scoring against a **written-down world position** for the grip —
plus, as needed, an elbow position, a wrist limit, and a torso clearance floor.
It poses the bones directly off their captured rest quaternions exactly as
`setBoneOffset` does, so it can solve for poses that do not exist yet, and it runs
in a scratch `*.test.ts` against the real GLB in about a second.

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

- **A charge is held only against the far field.** An enemy inside
  `LINE_CONTACT_RANGE` outranks it, and both fighters drop what they were walking
  at. Any new pass that creates a pair has to do that dropping, or a fighter drives
  two encounters.
- **A hurler enters a mutual duel, but only when charged into one.** Two ways in
  and neither is redundant: the promotion pass turns a swordsman's support
  encounter into a trade at `STONE_RANGE`, and the mutual-candidate pass pairs a
  hurler with an enemy already that close — needed because a hurler does not throw
  at a body on top of it, so it may have no encounter to be promoted out of, and
  with nothing published nobody would ever engage it.
- **A battery is a group per body, not the whole team on one body.** Anything that
  hands a thrower a target has to respect `throwersWorth`, and has to check the
  thrower can actually reach it — an unreachable assignment silently becomes a
  crowd somewhere else.
- **A defensive plan hands the attack to the other fighter**, so `react` and
  `distance-trap` are off the table against a hurler — they made it the attacker
  of a *sword* exchange, cutting with a weapon it does not carry.
- **`primaryParticipants` must be maintained by every pass that creates a mutual
  pair.** The battery pass reads it to know which throwers are busy.
- **A fighter may drive only one encounter.** Anything that hands a fighter a
  second writes two cues a frame and reads as neither.
- **Being hit outranks what you were planning.** `writeCue` arbitrates *only* that
  case, which is why the rule above has to hold everywhere else.
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
- **Anything below the `health <= 0` early return in `update` never runs for a
  corpse.** That return is three hundred lines above the pose layers. Any new
  per-frame state on a unit has to decide whether it belongs above that line.
- **`field.refile` must stay the last statement in `update`.** It is what keeps
  the grid exact rather than approximate.
- **Materials are shared between fighters, deliberately.** A corpse sinks into the
  dust rather than fading out for exactly this reason, and the accent cache depends
  on it too. Do not mutate a material at runtime.
- **Rock size and arc are drawn from the rendered result, not from physics.**
- **Sparks are point sprites and get no perspective divide for free.**
- **Clear the imported animation data before rendering in Blender.** The GLB
  carries Idle, Walk and CombatIdle and Blender re-applies whichever action is
  assigned on every render. Miss this and the measurements are right while every
  picture shows a unit standing still.

## The rig has no IK, and that decides more than taste

The hips are pinned to the terrain and each leg is two rigid bones, so **a foot
cannot reach out and stay on the ground** — it travels an arc. The folded knee is
the biggest lifter; the root bone sits on the ground, not at the hips, so pitching
it swings the whole skeleton about the soles.

This is why a stone strike lunges *and* strides: the grip only reaches 1.65 m in
front of the fighter, measured, so the arm alone cannot cross the gap to an
opponent that may not stand closer than `MIN_FIGHT_DISTANCE`. Travel the legs do
not make is a foot sliding along the ground, so `STONE_LUNGE` and `stoneLegs` have
to be sized against each other.

`applyBalancePose` is authored for a fighter that is only standing, so its leg
authority is `1 - engagement`. Its lean and hit reaction are never scaled. **Only
one layer may own the legs** — and the same rule holds for arms, which is why the
guard is blended *toward* rather than added on.

## A seed is only worth what nothing else can touch

`combatId` is `group.id`, three.js's **global object counter**, and five sites in
`rigwalker.ts` once used that number as each unit's own beat. Adding one camera to
the sim shifted every id and moved every fighter in every seed by about half a
metre at six seconds, with an event log and damage tally that matched exactly.

**The rule: anything that changes how a unit moves must come from an injected
random stream** — never an id, a counter, an array index, or the wall clock.
`performance.now()` is in the codebase for the perf panel; nothing that decides
how a unit moves may read it.

**A correction the last handoff earned the hard way.** It predicted the spatial
grid "cannot move a seeded fight" because it does not touch the director. That
was wrong. `forEachNear` visits neighbours in cell order rather than roster order,
and the clearance pass mutates position as it goes, so the float accumulation
differs and **every seeded fight is now a different fight than it was before
`09d6480`**. Determinism is intact — same seed, same fight, every time — but any
seed being used as a visual reference is gone. The general lesson is the one the
old note already gave and then talked itself out of: **iteration order is state.**
Diff the tally rather than reasoning about whether something could matter.

## The camera, and both modes stay

The user is still deciding what the game is and is using the camera to look
around. **Keep both projections.** Controls are identical in all three pages:
`WASD` pans in the camera's own frame, `←` `→` orbit, `↑` `↓` raise and lower
between 6° and 84°, `P` swaps projection, the wheel zooms. `src/world.ts` owns all
of it.

Three things easy to get wrong: orthographic has **no distance term at all**, so
what the user reported as "units get bigger further away" is the ground
compressing while the unit does not; judge camera questions **in the game**, where
things are spread over 180 m; and perspective must spend zoom on **distance, never
the lens**, because a telephoto flattens the depth the projection exists for.

## The animation tool

`AGENTS.md` has the full rules. It is **not** a keyframe editor for the GLB — the
combat poses are not in the model. What it edits is `src/pose-tuning.ts`, and
**Save** writes that file through a dev-only Vite route, replacing only what is
below the marker at the foot of it.

The user's own words on it were "wonderful" and "I understand how to use it
intuitively". Treat the interaction as something worth protecting. **It writes
`src/pose-tuning.ts` while he plays**, so check `git status` before staging
broadly.

**It does not install `RigwalkerBatch`** and must not: it draws two units and
toggles `group.visible` itself, which the batch would fight with. It is also the
page that gets forgotten whenever something changes under it — this session it
needed a `UnitField` of its own, because `update` no longer takes an array.

The stone strikes are in it as motions — `hammer`, `swing`, `jab`, `punch`, `ward`,
`cover` — but they **scrub and do not edit**, like the sword's poses, because their
numbers are constants in `rigwalker.ts` rather than in `pose-tuning.ts`.

Rules the tool work found, still true: a slider must not own the keyboard; a
restore must not enumerate fields; a mark must line up with the thumb; the glTF
loader strips dots out of node names (`Elbow.L` is `ElbowL`); saving reloads the
page, so `Revert` after a `Save` reverts to the *saved* values and undoing a save
is a git job.

## Measured state

- 134 tests pass; production build passes.
- **Draw calls: 86** at 64v64 (from 8,260) and 86 again at 128v128, carrying 520k
  triangles. Read off the panel's `draws` row, `batch=0` against `batch=1`.
- **Per-frame CPU, node, primitive fallback, averaged over the two seconds after
  contact** — the window matters, because an army still walking in is not the
  frame anybody worries about:

  | bodies | `ai` | `physics` |
  | --- | --- | --- |
  | 32 | 0.17 ms | 0.40 ms |
  | 64 | 0.27 ms | 0.45 ms |
  | 128 | 0.45 ms | 1.01 ms |
  | 256 | 2.18 ms | 3.36 ms |

  **`ai` is now the quadratic one** — `CombatDirector.update` still pairs every
  fighter against every other.
- **The frame time on his machine was never measured here** and cannot be — see
  "Which instrument to trust". He played the previous work and said "looks good
  now"; on this session's he said the performance *"has increase a ton"*. That is
  the whole of the evidence for the frame rate and it is the evidence that counts.
  **The browser-side `render`/`fx`/`hud` rows at 128v128 have not been read by
  anyone.**
- The sword duel is untouched and still reads foot drift 0.069 m, recovery error
  0.00 degrees. Release heights, Blender frame: 3.80 / 3.78 / 3.55.
- Balance, `1h v 1` over 24 seeds: 14 sword / 10 hurler. Two swords onto one
  hurler kill it in 20 of 20 at a median of 7.6 s. **Neither number survives
  mass** — see the slope above, which is now steeper than when those were taken.
- Capture sheets in `renders/` predate both the seed fix and the grid, and no
  longer match anything. `renders/` is gitignored.

## Suggested next steps

The goal remains that combat looks cooler each iteration, not that it becomes
playable. Player agency is still out of scope.

1. **Open `128v128` in a real browser and read the perf panel.** Everything above
   says the CPU half is fine; nothing here has seen `render`, `fx` and `hud` at 256
   bodies, and that is now the only unknown in the frame. It is five minutes of his
   time and it decides whether item 2 matters.
2. **`ai` is the last quadratic**, at 2.2 ms per frame at 256 bodies. The
   candidate loop in `CombatDirector.update` pairs every fighter against every
   other, and `readIncoming` and the threat list walk all encounters. The director
   works on snapshots rather than units, so it cannot reuse `UnitField` directly,
   but the same grid over snapshots would do it. **This one *can* move a seeded
   fight** — pairing order decides who duels whom — so it is a bigger deal than the
   physics grid was, and the tally has to be diffed.
3. **Animation cost has never been measured and is probably third.** 256
   `AnimationMixer`s × 54 tracks is ~14,000 interpolant evaluations a frame, and
   every unit runs the full pose stack whether it is forty pixels tall or filling
   the screen. Throttling the mixer and pose layers to 30 Hz beyond some distance
   from the camera focus is invisible at RTS zoom — but a throttled pose sampled by
   `sampleBlade` on an off-beat frame would move the sparks.
4. **The hurler now dominates mass combat harder than before and nothing answers
   it.** The fullest statement is in "Three to one is no longer the even point".
   This is a design decision before it is a code one, and it is the biggest open
   question in the project.
5. **The sim steps the fight by wall-clock delta** (`advance(frameDelta * speed)`,
   clamped at 0.05), so a seed already plays out differently at 30 fps than at 60,
   and only the headless `t=` path uses a fixed step. A fixed-timestep accumulator
   would make live play match the captures and stop a slow frame changing a fight.
   **It changes what every existing seed produces**, so it is a decision, not an
   optimisation. Worth raising with him — and cheaper to do now than later, since
   `09d6480` already invalidated every reference seed.
6. **Play the close fight and judge the four strikes.** Still not done. They are
   measured but not judged: whether `hammer`, `swing`, `jab` and `punch` are
   distinguishable in motion at gameplay speed, and whether the lunge reads as
   stepping in or as sliding. `1h in close` and `1h v 2 close` stage it.
7. **The hurl/pitch release margin is two centimetres.** Either widen it
   deliberately or accept that the validator is the only thing standing between the
   project and a hurl that reads as a pitch.
8. **Make the Blender port stop being a hand copy.** It is the one place the
   project can silently desynchronise from itself. Emitting the tuning as JSON for
   the Python to read would end a whole class of wrong measurement.
9. **The sword has no tunables**, and neither do the stone strikes.
   `applyCombatPose` and `applyStonePose` both sum inline.
10. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   and the stone lunge traces to its absence.
11. **The close fight has not been heard.** A stone strike reuses the sword's
   contact sounds; a two-handed hammer and a punch make the same noise graded only
   by intensity.
12. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, trails reading white-hot over bright ground, retaking the capture
   sheets, and the projection question — perspective at gameplay distance, and
   whether unit readability survives it at the zooms an RTS actually plays at.
