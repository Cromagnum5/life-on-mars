# Session handoff

## Current checkpoint

`main` at `8b6cfb6` plus this file on top of it. The session's branch
`draw-fewer-things` was fast-forwarded into `main` and is deleted.

`origin/main` is at `16c0d0e Point the handoff at the hurler's close fight`, so
`main` is **five commits ahead of it** plus this file. Pushing is the user's call
and he has not made it.

Seven older branches are still lying around (`animation-tool`, `parry-the-cut`,
`rigwalker-hurler` and so on). All are merged and spent; none is worth reading.

**The working tree is clean.**

This session is three commits, and one number is the whole story of it:

- `674dde6` Hold the bar's buttons before hud=0 takes the bar away
- `c42a6d6` Draw the army in eighty-six calls instead of eight thousand
- `8b6cfb6` Stop a dead man trailing his sword, and a rock inheriting the last one's streak

He asked why sixty-four a side ran five times slower than a small matchup, with
`render` at 82% of the frame. It was **8,260 draw calls a frame. It is now 86.**

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

## Why the frame was slow, and what was done about it

**Read this before touching anything that draws.**

`public/models/rigwalker.glb` is **33 separate rigid meshes** — 960 triangles in
total across 5 materials — hung off a 17-bone armature. Nothing in it is skinned
(a `skins` array is declared but no node references it), and all 54 animation
channels in `Idle`, `Walk` and `CombatIdle` target bones only. So every one of
those 33 parts has a local transform that never changes.

That shape is fine for one fighter and ruinous for 128. Measured, at 64v64:

| | before | after |
| --- | --- | --- |
| draw calls a frame | **8,260** | **86** |
| triangles those calls carry | 282,000 | 282,000 |

The triangles were never the problem. Three.js spends a few microseconds of
JavaScript per draw — material state, a model-view multiply, a normal-matrix
inverse-transpose, uniform uploads — and eight thousand of those was the forty-odd
milliseconds the panel was charging to `render`.

### `src/unit-render.ts` — how it works now

Because the parts are rigid, every fighter's copy of a part differs only by a
matrix. `RigwalkerBatch` gives each distinct geometry-and-material pair one
`InstancedMesh` holding the whole army's copies, filled each frame from the world
matrices the renderer was already computing. **The draw count no longer depends
on how many fighters are on the field** — 128 v 128 costs the same 86.

Four things about it that are not obvious and should not be undone:

- **The scene graph is left standing.** Only `unit.group.visible` is turned off.
  `projectObject` returns the instant it meets an invisible object, so the
  renderer skips the whole 52-node subtree for the price of one check — while
  `updateMatrixWorld` and raycasting both **ignore** visibility. That is what
  keeps `sampleBlade`, `getContactPoint`, `describeFeet`, the animation tool's
  `freeArmClearance`, the by-name probes in `parry.test.ts` and `stone.test.ts`,
  and click selection in the game all reading exactly what they read before.
- **Parts are found by traversal, never by a list of names.** Re-export the GLB
  with a new part on it and it is picked up without anybody remembering this file
  exists. Per-part `visible` is honoured, along with every ancestor's, which is
  what preserves the sword's `visible = inCombat`, the held rock, the selection
  ring and the health bar for free.
- **The batch owns the scene's matrix update.** It sets
  `scene.matrixWorldAutoUpdate = false` and calls `scene.updateMatrixWorld()`
  itself, so the seven thousand nodes are walked once a frame rather than twice.
  Anything that draws without calling `sync` first draws stale matrices.
- **`?batch=0` turns it off** on both the game and the sim, putting the bodies
  back on their own meshes. That is the A/B for any doubt about the picture.

**It is not literally pixel-identical, and do not expect it to be.** `batch=0`
against `batch=1` at 64v64 differs by **32 isolated pixels in 1.1 million**, mean
delta 6 of 255, scattered one and two at a time. That is antialiasing and depth
ties resolving under a changed draw order, not a drawing error — a drawing error
would be a connected blob.

### The three smaller wins in the same commit

- **The accent material is shared per colour** (`accentMaterialFor` in
  `rigwalker.ts`), not cloned per painted mesh per fighter. That was 1,024
  materials describing two colours. It is also a *precondition*: instances of one
  draw share a material by definition, so a per-fighter clone would have split
  the batch back into a draw per fighter.
- **The 33 leaves compose their local matrix once**, in `loadRigwalkerAsset`,
  instead of rebuilding a constant answer 4,224 times a frame. `Object3D.copy`
  carries `matrix` and `matrixAutoUpdate` together, so the clones inherit it.
  **Do not do this to the model root** — the hurl's lunge moves it. `traverse`
  will not, because the root is a Group.
- **The scattered rocks are one `InstancedMesh`**, not seventy. The same
  `pseudoRandom` sequence is walked in the same order, so the same rocks stand in
  the same places.

### The perf panel has a `draws` row

`renderer.info.render`, read after the draw. `createMarsRenderer` sets
`info.autoReset = false` and **each page resets it itself at the end of the
frame**, because the renderer otherwise clears its counters *between* the shadow
pass and the colour pass — so a page reading them afterwards is told about half
its frame. The shadow pass draws every caster a second time and is worth about as
much as the pass after it.

### A trap this session set and then walked into

`shadowMap.autoUpdate = false` was briefly put in `createMarsRenderer` so the
pages could run the shadow pass every other frame. **That silently removed the
animation tool's shadows** — 13% of its pixels — because a page that never sets
`needsUpdate` gets no shadow map at all, not a stale one.

The cadence is **gone now** and should stay gone: halving that pass was worth
doing when it was 4,200 draw calls, and the whole frame is now 86, of which the
pass is about 40. It bought twenty draw calls and paid for them with a shadow
lagging the body casting it. If a global renderer default ever needs changing
again, remember there are three pages and only two of them were being thought
about.

## Two ribbon bugs, reported from play

Both were older than the batching work and both were found by reading rather
than by catching them on camera. He described them as "long glowing lines along
hurlers' rock paths, almost like a stretched out spark".

- **A corpse went on swinging.** Everything below the `health <= 0` early return
  in `update` is skipped once a fighter is down, and `swinging` was among it. A
  fighter cut down mid-attack stayed `isSwinging` for the whole 3.4 s it took to
  topple, lie there and sink — and `BattleRuntime` feeds a blade ribbon for every
  swinging unit every frame. Worse: feeding a ribbon resets its idle timer, so
  those never aged out and never went back to the pool. **There are sixteen
  ribbons**; a melee that killed sixteen mid-swing had every one held by a dead
  man and the living stopped trailing at all.
- **A rock inherited the previous rock's ribbon.** A ribbon is found by owner and
  a flying rock's owner is its pool slot. Twenty-four slots is a few seconds of a
  64v64, so a slot comes round while the last rock's ribbon is still fading — and
  `trail` handed it straight back, six stale samples and all. The strip then
  reached from wherever the old rock had got to across to the new one leaving a
  hand somewhere else: **one long bright line drawn between two unrelated
  throws.** `rock` now releases the slot's ribbon as it launches, and
  `rockTrailOwner(slot)` is a named function so the two sites that depend on the
  id cannot drift apart.

He confirmed both artifacts are gone. **Neither was ever reproduced in a still**
— see the next section for why that is structural.

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
**`EXTRA='hud=0'` works again** — it had been throwing on a `requireElement` that
ran after `hud=0` removed the bar, which killed the module on the way in and
returned an empty canvas for every clean-frame capture.

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

**None of the five can measure a frame rate.** The sim's `t=` capture mode bursts
the whole fight through synchronously and redraws one frozen frame, so it has no
frame rate to report, and headless Chrome here runs through SwiftShader at a few
frames a second, which is the software rasteriser and not the game. **Real frame
numbers only exist in a real browser on his machine.** The `draws` row is the
exception and is worth trusting anywhere — it is a count, not a clock.

### Comparing two pictures, which is harder than it looks

Three traps, all of them cost time this session:

- **The effects are not seeded.** The fight replays exactly, but `sparkBurst` and
  `rock` draw velocities and spin from `Math.random()`. Two runs of the *same*
  URL at `t=8` in 64v64 differ by ~1,100 pixels. **Compare at a moment before
  first contact** — `t=1` in a big matchup — where two identical runs are
  byte-identical and anything that differs is the change under test.
- **Always render the control.** Same URL twice, as the noise floor, alongside
  the A/B. Without it a real difference and a spark are the same number.
- **Capture mode cannot see anything about frame cadence**, by construction: it
  draws one frozen frame. Any bug that lives in the difference between
  consecutive frames — a half-rate shadow, a pooled slot recycling — is invisible
  to every screenshot in this repo. That is why the two ribbon bugs above had to
  be argued from the code.

For the determinism half of a check, read the tally out of `#tally` with
Chromium `--dump-dom`. That stays exact at any `t`, because it comes off the
seeded fight rather than off the effects:

```sh
chrome --headless=new --virtual-time-budget=180000 --dump-dom \
  "http://localhost:5173/sim.html?matchup=64v64&seed=1&t=20"
```

## Three to one is the even point on a slope

The army matchups field **three swords to one hurler**, measured rather than
picked. But the measurement turned up something more important than the number,
and it is the first thing to know before tuning anything about the hurler.

Round-robin of every mix from all-sword to all-hurler, sixteen a side, both sides
of the field, eight seeds each way, real director and real `unit.update`:

| mix | net across the field |
| --- | --- |
| 16s / 0h | −96 |
| 14s / 2h | −60 |
| **12s / 4h** | **−10** |
| 10s / 6h | +24 |
| 8s / 8h | +14 |
| 4s / 12h | +56 |
| 0s / 16h | +72 |

Twelve-and-four is level against the field, and it is also what the game produces
— the Assembly Bay puts out three swords an opening and the Stoneworks one
hurler — so the sim stages the army the player actually gets. That is why
`SWORDS_PER_HURLER` is 3.

**It is not an equilibrium. The field is a slope.** All-sword loses to every
single mix 0–16. Each further hurler is worth more than the sword it replaced,
monotonically, right up to an all-hurler army that beats everything.

The mechanism is visible in a 64v64 capture at eight seconds: a dozen hurlers all
release at the *same* target within a tenth of a second, and the log is a wall of
`hurl at H16`. A hurler is roughly a fair fight one-on-one — 14 sword / 10 hurler
over 24 seeds — and two swords kill one 20 of 20. None of that survives contact
with mass, because at sixteen metres the swords have no answer at all until they
arrive, and massed throwers delete the front rank during the walk.

**If massed hurlers are meant to be beatable, that is a combat question, not a
roster one.** Candidates nobody has tried: a throw that cannot be aimed at a
target already committed to by N throwers, a much longer reload at the top band,
or making the approach cheaper — shields, a charge, anything that makes crossing
sixteen metres cost less than it currently does.

**The sweep harness was scratch and was deleted.** To rebuild it: copy `runFight`
from `hurler.test.ts` — director plus `unit.update` plus `applyCombatDamage`,
which is the real thing — stage two team lines the way `startMatch` in `sim.ts`
does, run to a wipe or 90 s, and score wins. It runs a 16-a-side round-robin in
about two minutes. Note that `console.log` is swallowed by this vitest setup;
append to a file instead.

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
`MAX_FILES` across before a second rank, swords in front, throwers set back
behind the *whole* screen rather than behind their own first rank.

- **Past twelve fighters the readout stops issuing a card each** and says what
  each side has left instead. A hundred and twenty-eight cards is not a readout,
  and building them was the most expensive thing on the page.
- **The arena is 112 m wide**, so a sixty-four a side line pulled back to fit
  still has ground under it. This moved no fight: `terrainHeightAt` is a function
  of world position, not of the patch drawn around it.
- `16v16`, `32v32` and `64v64` are past the ninth entry, so the `1`–`9` keys do
  not reach them. Buttons only, same as `1h in close` before them.
- `LARGEST_MATCHUP` is derived from the table and handed to `RigwalkerBatch` so
  the instance buffers are allocated once at the size the biggest fight needs.

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

- **A hurler enters a mutual duel, but only when charged into one.** Two ways in
  and neither is redundant: the promotion pass turns a swordsman's support
  encounter into a trade at `STONE_RANGE`, and the mutual-candidate pass pairs a
  hurler with an enemy already that close — needed because a hurler does not throw
  at a body on top of it, so it may have no encounter to be promoted out of, and
  with nothing published nobody would ever engage it.
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
- **Anything below the `health <= 0` early return in `update` never runs for a
  corpse.** That return is three hundred lines above the pose layers, and it is
  why a dead fighter kept `swinging` and kept its sword drawn. Any new per-frame
  state on a unit has to decide whether it belongs above that line.
- **Materials are shared between fighters, deliberately.** A corpse sinks into
  the dust rather than fading out for exactly this reason, and the accent cache
  now depends on it too. Do not mutate a material at runtime.
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

This session added forty-odd `InstancedMesh`es to the scene, which shifts every
`group.id` by a constant. That is harmless — nothing sorts by raw id — but it is
exactly the shape of the bug above, so **the 64v64 seed-1 tally at `t=20` was
diffed before and after and is identical.** Do that again for anything that
constructs objects.

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
page that gets forgotten whenever a renderer default changes — see the shadow trap
above.

The stone strikes are in it as motions — `hammer`, `swing`, `jab`, `punch`, `ward`,
`cover` — but they **scrub and do not edit**, like the sword's poses, because their
numbers are constants in `rigwalker.ts` rather than in `pose-tuning.ts`.

Rules the tool work found, still true: a slider must not own the keyboard; a
restore must not enumerate fields; a mark must line up with the thumb; the glTF
loader strips dots out of node names (`Elbow.L` is `ElbowL`); saving reloads the
page, so `Revert` after a `Save` reverts to the *saved* values and undoing a save
is a git job.

## Measured state

- 125 tests pass; production build passes.
- **64v64 draw calls: 8,260 → 86**, at 282,000 triangles either way. Read off the
  panel's new `draws` row, `batch=0` against `batch=1`.
- **The frame time on his machine was never measured here** and cannot be — see
  "Which instrument to trust". He played it and said "looks good now"; that is the
  whole of the evidence for the frame rate and it is the evidence that counts.
- Per-frame CPU, **node, fallback visual, no bone posed**, averaged over the first
  eight seconds of a fight. Unchanged this session — nothing here touched the
  fight:

  | bodies | `ai` | `physics` |
  | --- | --- | --- |
  | 2 | 0.026 ms | 0.074 ms |
  | 10 | 0.083 ms | 0.221 ms |
  | 32 | 0.163 ms | 0.540 ms |
  | 64 | 0.415 ms | 1.540 ms |
  | 128 | 0.563 ms | 5.988 ms |

  **`physics` is the quadratic one and it is separation** — every unit walks every
  other unit, every frame. With `render` now cheap, this is the next thing.
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

1. **Separation is O(n²) and is now the biggest thing left.** `unit.update` walks
   every other unit twice — `rigwalker.ts` separation and clearance — plus a
   `find` for the combat target, and `CombatDirector.update` pairs every fighter
   against every other. At 128 bodies that is roughly 50,000 distance checks a
   frame, and it quadruples if he ever wants 128 v 128. A uniform grid sized to
   `SEPARATION_RADIUS`, rebuilt once a frame, turns all of it near-linear. Nothing
   about it touches the director, so it cannot move a seeded fight — but diff the
   tally and check, because the seed rule above says how easy that is to get wrong.
2. **Animation cost is second.** 128 `AnimationMixer`s × 54 tracks is ~6,900
   interpolant evaluations a frame, and every unit runs the full pose stack whether
   it is forty pixels tall or filling the screen. Throttling the mixer and pose
   layers to 30 Hz beyond some distance from the camera focus is invisible at RTS
   zoom. Do it *after* the grid — it is the more delicate of the two, because a
   throttled pose sampled by `sampleBlade` on an off-beat frame would move the
   sparks.
3. **The sim steps the fight by wall-clock delta** (`advance(frameDelta * speed)`,
   clamped at 0.05), so a seed already plays out differently at 30 fps than at 60,
   and only the headless `t=` path uses a fixed step. A fixed-timestep accumulator
   would make live play match the captures and stop a slow frame changing a fight.
   **It changes what every existing seed produces**, so it is a decision, not an
   optimisation. Worth raising with him.
4. **The hurler dominates mass combat and nothing currently answers it.** The
   fullest statement is in "Three to one is the even point on a slope", including
   three candidate mechanisms. This is a design decision before it is a code one.
5. **Play the close fight and judge the four strikes.** Still not done. They are
   measured but not judged: whether `hammer`, `swing`, `jab` and `punch` are
   distinguishable in motion at gameplay speed, and whether the lunge reads as
   stepping in or as sliding. `1h in close` and `1h v 2 close` stage it.
6. **The hurl/pitch release margin is two centimetres.** Either widen it
   deliberately or accept that the validator is the only thing standing between
   the project and a hurl that reads as a pitch.
7. **Make the Blender port stop being a hand copy.** It is the one place the
   project can silently desynchronise from itself. Emitting the tuning as JSON for
   the Python to read would end a whole class of wrong measurement.
8. **The sword has no tunables**, and neither do the stone strikes.
   `applyCombatPose` and `applyStonePose` both sum inline.
9. **Foot IK is still the real unlock.** Everything cramped about the hurl step
   and the stone lunge traces to its absence.
10. **The close fight has not been heard.** A stone strike reuses the sword's
   contact sounds; a two-handed hammer and a punch make the same noise graded only
   by intensity.
11. Earlier items still open: hurlers held behind the swords via the Stoneworks
   rally point, a hurler that backpedals toward its own side rather than in a
   straight line, scorch decals under wrecks, encirclement positions for group
   fights, trails reading white-hot over bright ground, retaking the capture
   sheets, and the projection question — perspective at gameplay distance, and
   whether unit readability survives it at the zooms an RTS actually plays at.
