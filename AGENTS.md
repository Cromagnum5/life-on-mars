# Life on Mars — Project Guide

## Vision

Life on Mars is a browser-based real-time strategy game inspired by the feel of
classic games such as Red Alert 2. Corporations compete for Martian resources
using robots, industrial machinery, and eventually planet-scale projects such
as terraforming.

Keep the first playable version deliberately small. Favor a satisfying core
interaction over broad systems or premature engine architecture.

## Visual direction

- Stylized low-poly 3D with a readable tabletop-RTS presentation.
- Fixed three-quarter orthographic camera.
- Chunky silhouettes, simple materials, corporate accent colors, and emissive
  status lights.
- Use code-built primitive models while proving gameplay.
- Move production assets to animated `.glb` models made in Blender when the
  gameplay loop is established. Use `GLTFLoader`, `AnimationMixer`, and
  `SkeletonUtils.clone` for animated units.
- A robot needs idle and forward-walk animations. Rotate the model toward its
  movement vector rather than authoring eight directional animation sets.

## Current technical foundation

- TypeScript, Vite, and Three.js.
- Plain HTML/CSS for interface elements.
- No physics engine or ECS dependency at this stage.
- Development server listens on `0.0.0.0:5173` for access from another machine.
- Run with `npm run dev`; validate with `npm run build`.
- Three entry points: `index.html` for the game, `sim.html` for the combat sim,
  and `anim.html` for the animation tool. All are listed in `vite.config.ts`; a
  new page needs an entry there.
- `src/world.ts` owns terrain, lighting, and the camera; `src/battle.ts` owns one
  frame of fighting end to end. The game and the sim share both, so a change
  seen in the sim is a change the player gets.

Current camera controls are intentionally minimal after playtesting:

- `WASD` pans the camera, in the camera's own frame rather than along the world
  axes, so a pan still means what the screen says once the view has been turned.
- The left and right arrows orbit about what the camera is watching; the up and
  down arrows raise and lower it, between six and eighty-four degrees off the
  ground. The three-quarter view is where it starts and nothing else moves it.
- Mouse wheel zooms. Under perspective the wheel walks the eye in rather than
  narrowing the lens, because narrowing is what a telephoto does and a telephoto
  flattens the depth the projection exists for.
- `P` swaps the projection, in the game as well as the sim, and the control hint
  names the one in use (`Flat view` / `Depth view`). Orthographic remains the
  default and the documented visual direction; the toggle is there because the
  choice cannot be judged from a still, only from moving the camera around under
  both. Both pages also take `camera=perspective`, `fov`, `yaw` and `pitch` in
  the URL, since a headless capture cannot press a key.
- Do not add edge scrolling, arrow-key panning, or mouse-drag panning unless the
  user asks for them; those controls were tested and removed. The arrows orbit,
  which is a different question — what the scene looks like from elsewhere, not
  what is on screen — and was asked for while the game is still being decided.

The reverse-perspective complaint that prompted the toggle is an orthographic
camera doing exactly what it is: a unit's size never changes with distance, so
at a low angle the ground shrinks toward the horizon while a distant unit does
not, and it reads as a giant standing at the back. It is most obvious in the
game, where units and buildings are spread across a hundred and eighty metres —
never in the sim, where every fighter is within a few metres of the focus. Judge
this one in the game.

## Initial game vocabulary

- Power building: **Reactor**
- Robot production building: **Assembly Bay**
- Hurler production building: **Stoneworks**
- Mining building: **Extractor**
- Initial robot unit: **Rigwalker**
- Ranged Rigwalker variant: **Rigwalker Hurler**, which throws rocks

Avoid the name “Optimus” because of its strong association with Transformers.

## Nine-step roadmap

1. Render the Mars scene and establish the camera. **Complete.**
2. Add primitive versions of the Reactor, Assembly Bay, and Extractor. **Complete.**
3. Create one primitive animated Rigwalker. **Complete.**
4. Implement selection and click-to-move controls. **Complete.**
5. Add the Assembly Bay's 30-second production cycle and visible unit exit. **Complete.**
6. Add selection feedback, movement markers, and the basic HUD. **Complete.**
7. Add simple unit separation and building obstacles. **Complete.**
8. Create the first Blender robot and validate the animated GLB pipeline. **Complete.**
9. Replace placeholders while preserving gameplay behavior. **Complete.**

## First playable slice

The initial slice has a small bounded Martian map and four pre-placed
buildings. The Assembly Bay and the Stoneworks each open every 20 seconds. Units
come out through their own spawn doors, can be selected with left click, and
receive move orders with right click. Each producing building is selectable and
keeps its own rally point. The Reactor and Extractor initially generate simple
power/resource values over time.

Do not expand the first slice into construction, combat, enemies, complex
resource nodes, multiplayer, or full navigation until the basic spawning and
movement loop feels good.

## Implementation guidance

- Preserve right click for future unit orders.
- Use raycasting for selection and terrain commands.
- Use delta-time movement and small unit states such as `spawning`, `idle`, and
  `moving`.
- Start with direct movement; introduce a navigation grid and A* only when
  buildings and group movement make it necessary.
- Add automated tests when simulation logic such as timers and movement states
  arrives.
- Keep rendering, input, and simulation responsibilities separable as the main
  file grows, but avoid abstractions that do not yet pay for themselves.

## Current state

Steps 1 through 3 provide a procedurally varied Mars surface, scattered rocks,
atmospheric lighting and fog, responsive rendering, bounded camera movement,
a compact control hint, and distinct primitive models for the Reactor, Assembly
Bay, Stoneworks, Extractor, and Rigwalker. The Rigwalker has an articulated
procedural walk
cycle, can be selected with left click, and accepts terrain movement orders with
right click. It turns smoothly, follows the terrain, and returns to idle on
arrival. Each producing building opens every 20 seconds: its shutter rises, the
batch walks from inside to that building's own rally point, and the shutter
closes. The Assembly Bay sends out three swords abreast and the Stoneworks a
single Hurler, so the line is mixed by which building made it rather than by
whose turn it is. Selected units show an orange ring, movement
orders pulse on the terrain, and the operations HUD reports power, ore, unit
count, selection, and production progress. Units support single-click and
left-drag marquee selection, with group orders arranged into a loose formation.
Rigwalkers use lightweight local
steering to maintain personal space and travel around circular building
footprints; commands placed on a building are moved to its nearest clear edge.
The editable `assets/rigwalker.blend` and runtime
`public/models/rigwalker.glb` are generated by `tools/create_rigwalker.py`. The
GLB contains `Idle` and `Walk` clips; Three.js loads it once, clones it for each
unit, and falls back to the primitive model if loading fails. The Blender model
is now the normal runtime visual for initial and produced units; asset tooling
is loaded as a separate browser chunk, and gameplay remains independent of the
rendered model. The original nine-step vertical slice is complete.

Combat has its own workbench rather than being tuned in the game: `sim.html`
stages seeded sword and hurler matchups against the same runtime, with a
per-fighter readout and an event log, and renders headlessly for review.

The Rigwalker Hurler is a second unit built on the same skeleton and the same
runtime: no sword, a rock in its hand, and three throws picked by how far away its
target is. Walked down to arm's length it fights with that rock rather than
throwing it — four strikes chosen by how much time it has, and its forearms for a
guard. It is produced by its own building, the Stoneworks, one per opening, so
the game fields a mixed line without new interface.

## Current playtest

The nine-step vertical slice has been manually playtested and feels good. The
current soak test is to leave the game running while all four producing
buildings keep going, then observe movement and interaction with many units on
screen. Units now arrive twice as fast as they did from the bays alone, so this
is worth re-running.

Before optimizing, measure the actual failure mode. Likely scaling pressure
points are:

- Unit separation currently compares every unit with every other unit each
  frame (`O(n²)`). Introduce a spatial hash or uniform grid only when the soak
  test shows this becoming material.
- Every GLB instance has its own `AnimationMixer`, which is appropriate for
  independent state but may eventually need animation throttling for distant or
  off-screen units.
- Every Rigwalker currently remains active indefinitely; there is intentionally
  no population cap yet.
- Local steering is lightweight rather than full pathfinding. Dense crowds may
  reveal oscillation or congestion around building footprints.

Do not change the established WASD/wheel camera controls or the production
cadence as part of performance work. The 20-second interval, the split of
production across two buildings, and each building's order (`SWORD_ORDER` and
`HURLER_ORDER` in `production.ts`) are the user's calls, not tuning knobs.
Preserve left-click selection,
drag-box multi-selection, right-click orders, per-building rally points, and the
Blender-model fallback behavior unless playtest evidence calls for a specific
change.

The production build has a non-blocking Vite warning because the core Three.js
chunk exceeds 500 kB. GLTF loading and skeleton cloning are already split into
lazy chunks. Treat the remaining warning as informational until load-time data
shows it is worth further bundling work.

## Combat animation validation

Treat combat animation as a rendered, time-varying result rather than validating
only code or one pose.

- Imported Blender bones may have non-zero or pi-valued rest rotations after GLB
  conversion. Capture each imported bone’s rest quaternion and apply procedural
  combat rotations as local quaternion offsets. Do not reset imported arm or leg
  bones to zero Euler rotations.
- Validate at least five representative phases: ready, wind-up, cut/contact,
  guard/reaction, and recovery. Render them as a contact sheet at approximately
  the gameplay camera angle; a single attractive frame is insufficient.
- Run a duel simulation across the whole fight and sample the actual imported
  GLB, not a substitute primitive rig. Check opponent facing, attack staggering,
  weapon visibility, hand-to-grip separation, arm height, foot-height drift, and
  clean return to the normal post-combat pose.
- Coordinate shoulders, elbows, wrists, torso twist, hips, and knees. Use
  opposing hip/knee offsets for visible weight transfer while keeping foot
  height nearly constant. Keep the weapon parented to the hand and let it inherit
  the wrist chain instead of independently positioning it each frame.
- Judge motion at RTS viewing scale. If consecutive rendered phases are barely
  distinguishable, increase the motion envelope and rerun both geometry and
  multi-frame visual checks.
- The arm chain mirrors with `attackSide`: X is side-independent, Y and Z flip.
  A pose that breaks that rule with hand-tuned per-side values will look
  plausible on one side and wrong on the other. The impact wrist did exactly
  this, rolling sword-side cuts back over the attacker's own shoulder.
- Where a strike lands is measurable, so measure it instead of eyeballing the
  pose. `contacts=1` reports the percussion point relative to the opponent; a
  swing that resolves with less reach than the gap between fighters is landing
  on nobody, and its sparks will appear to come off the wrong fighter.

## The combat sim

`sim.html` (`src/sim.ts`) is the workbench for combat. It stages a matchup on an
empty arena, drives the same `BattleRuntime` the game does, and shows what the
director is deciding: each fighter's temperament, plan, action, phase, and
distance, plus a timestamped event log and an outcome tally.

- Sword matchups are `1v1`, `2v2`, `3v2`, `3v3`, and `5v5`. Hurler matchups are
  `1h v 1` (the whole unit in one fight: it opens at maximum range and is walked
  down through all three throws), `1h v 1h`, `2h+2 v 4`, and `2h v 3`. Two more
  stage the close fight rather than waiting fifteen seconds for it: `1h in close`
  starts a hurler inside stone reach, and `1h v 2 close` crowds it from two sides,
  which is what puts both forearms up. Both set `setback: 0` — a hurler normally
  starts three and a half metres behind its own line, so one put on the line at
  three metres still opens six and a half away. All seeded, so a fight replays —
  see "What a seed is worth" below for what that does and does not survive.
- A matchup carries its own starting standoff and zoom. A hurler works from
  sixteen metres, which needs both a longer approach and a wider view than two
  swordsmen walking into each other; `zoom` in the URL still overrides it.
- `Space` pauses, `.` steps one frame, `R` restarts, `1`-`9` pick a matchup,
  `WASD` pans, the left and right arrows swing the view round the fight, the up
  and down arrows raise and lower it, `P` swaps the projection, and the wheel
  zooms. Panning is in the camera's own frame, so `W` still walks away from the
  eye once the view has been turned.
- URL parameters: `matchup`, `seed`, `speed`, `zoom`, `hud=0`, `t`,
  `yaw` and `pitch` — degrees swung from the default three-quarter view, since
  a headless capture cannot press an arrow key — `camera=perspective` and
  `fov`, and `contacts=1`, which logs where each strike throws its sparks in
  the attacker's own frame: reach toward the opponent, side, and height.
- `camera=perspective` draws the same fight through a perspective projection.
  The game is orthographic and the visual direction says so, but orthographic
  means nothing changes size with distance, which reads as reverse perspective
  at a low angle: a distant fighter holds its size while the ground shrinks
  around it. The toggle is how that choice gets questioned rather than argued.
  The default `fov` frames exactly what the orthographic view frames at the
  focus, so a swap holds the framing and changes only depth; a wider `fov`
  comes in closer for the same framing and reads as deeper. The status line
  reports which projection is drawing, and for perspective the lens and how far
  out the eye ended up.
- Zoom is spent differently by the two. Orthographic narrows its frustum where
  it stands. Perspective leaves the lens alone and walks the eye in until the
  focus is framed the same, because magnifying by narrowing is what a telephoto
  does and a telephoto flattens depth: at the sim's usual 3.2× that was a
  fourteen-degree lens sixty-six metres out, which is orthographic in all but
  name and made the toggle look like it did nothing.

`t` is the headless capture mode: the page steps a fixed timestep fight to that
exact sim time in one synchronous burst, renders one frame, and freezes. It
skips the intermediate draws, so a whole fight is capturable in a second.
`tools/capture_sim.sh` wraps it:

```sh
npm run dev
tools/capture_sim.sh /tmp/sheet 3v2 5 3 6 9 12
```

Chromium renders it with SwiftShader in `--headless=new`. Screenshots need the
page to keep redrawing, which capture mode does deliberately: a canvas rendered
once is empty by the time the screenshot is taken. `--dump-dom` returns the
event log as text, which is often more useful than the picture.

Do not point a capture past the end of a fight with auto-restart on; capture
mode turns it off, because a restart would reset the clock the capture waits on.

### What a seed is worth

A seed fixes the fight. It does not fix anything a unit reads from outside the
seeded streams, and one thing used to leak in: each Rigwalker's own beat — its
separation angle, how often it re-reads the distance, the phase of its combat
step — was read off `group.id`, which is three.js's **global object counter**.
Every mesh, light, rock, and camera constructed before the units moved it. A
second camera in the sim shifted every id by one and moved every fighter in
every seed by about half a metre at six seconds, with an event log and a damage
tally that matched exactly. A capture sheet compared against that looks like a
pose regression and is not one.

It now comes off the seeded spawn stream instead (`variation` in
`createRigwalker`), and `src/rigwalker.test.ts` replays a fight across a shifted
object counter to keep it that way. `combatId` is still `group.id`, which is
fine: it is only ever compared and keyed, never counted on.

The rule this leaves: **anything that changes how a unit moves must come from an
injected random stream**, never from an id, a counter, an array index, or the
wall clock. Any of those turns a scenery change into a combat change.

## The animation tool

`anim.html` (`src/anim.ts`) is the sim with the fight taken out: one Rigwalker,
one motion, and a phase held still. A fight is the wrong instrument for a pose —
the frame worth looking at goes past in a tenth of a second, never comes back at
the same value, and the director decides when. Here the phase is a slider.

It is **not** a keyframe editor for the GLB. The combat poses are not in the
model; they are written as offsets from the rest pose, driven by beats. What it
edits is `src/pose-tuning.ts`.

- Motions: the three throws, `aim`, the `ready` stance a hurler holds between
  throws, `cut`, `guard` and `struck` on the sword for comparison, and the close
  fight — `hammer`, `swing`, `jab`, `punch`, and the two guards `ward` and
  `cover`. There are more of them than there are number keys: `1`-`9` reach the
  first nine and the rest are a click on the bar. `Space` plays, `,` and `.` step
  one frame *of that motion* and ten under shift, `Home` and `End` go to the
  ends, `[` and `]` jump between arm keys. The camera keys are the sim's,
  unchanged.
- A motion may carry its own `mark` distance. The role is not enough any more:
  the same unit throws from sixteen metres and fights with the stone from under
  three, and a strike has to have its opponent in frame to be judged.
- **Every slider carries a mark at the value in the file**, and double-clicking
  the row goes back to it — one number at a time, where `Revert` is all of them
  at once. The mark only moves when the file is written, so it is what an edit is
  judged against rather than a record of what has been touched. The slider is
  styled all the way down for this: the mark has to line up with the thumb, which
  means knowing how wide the thumb is, and a default thumb is whatever the
  platform says. Arm keys lose their marks while the arc is a different length
  from the one on disk, because adding or dropping a key makes every index past
  it a different pose, and a mark that is quietly wrong is worse than one that is
  missing.
- **A slider does not own the keyboard.** Only the number fields and the line
  picker do, because they are typed into. Bailing out of the keydown handler on
  any focused input meant that touching one slider killed every shortcut on the
  page and turned the arrow keys into an editor for the value last dragged —
  which is the opposite of what an arrow key does everywhere else here. Drag a
  value, then step through the frames it changed, is the loop the tool is for.
  Fine adjustment belongs to the number field, where an arrow nudges by the step.
- The rig is posed by handing the real `Rigwalker.update` a hand-written cue
  with `movement: "plant"`, so what is on screen has been through
  `applyThrowPose`, the balance layer and the model offset. **It is the same
  instrument as `capture_sim.sh`, not a fourth opinion** — the Blender tools
  stop after the first of those three layers and never match the game.
- The mark it faces exists because a pose needs a target: `Rigwalker.update`
  only reaches its combat poses when the cue names somebody. It stands at the
  motion's own fighting distance, so a cut has its opponent in frame and a throw
  does not.
- The readout is live, after every pose layer: engagement, the step's forward
  and drop, the rock's height off the ground, the free arm's clearance, and the
  same feet string `feet=1` prints in the sim, from the same `describeFeet`.
- **The free arm is editable and its clearance is measured, together.** The one
  pose fault a picture cannot show you is this arm going *through* the chest
  rather than round it — it is drawn in front of the torso either way, and the
  difference is a few centimetres of one Euler angle. So the readout ports
  `inside_torso` from the Blender tool, sign flipped so bigger is safer, and
  turns red when the elbow, forearm or hand is inside the body. Verified against
  that tool to the millimetre: 0.259 m clear at phase 0, 0.345 at 0.40, and 0.069
  at 0.92, which is the tightest moment of a hurl and the first number to go
  negative if this arm is pushed around.
- The throwing arm is keyed and the free arm is summed, and that is not an
  inconsistency: the throwing arm traces an arc through a narrow band of Euler
  angles a sum walks out of, and the free arm has no arc to trace. Its editor is
  one row per joint, one slider per beat, showing only the drives that throw
  actually has — a pitch has no aim and a toss has no wind, and a slider that
  multiplies zero is a slider that lies about doing something.
- The timeline draws every beat as a band where it fades in and out, the arm
  keys as ticks, and the release phase as a dashed marker. Dragging it scrubs.
- The balance layer is a damped spring, so a scrub takes a moment to settle.
  What it settles to is the pose; the swing on the way there is not.

`Save` writes `src/pose-tuning.ts` through a dev-only Vite route
(`/__anim/pose-tuning`), replacing only what is below the marker at the foot of
that file, so the prose above it survives. It goes through the server because
this page is meant to be opened from another machine — `http://10.0.0.102:5173`
is not a secure context, and `navigator.clipboard` does not exist in one. The
serialized text is also in the panel to be copied by hand.

Two consequences of saving worth knowing:

- **A save reloads the page**, because it writes a module the page imports. That
  is the right thing — it proves what is on disk is what is on screen — so the
  tool keeps the motion, phase and camera in the URL and comes back to the same
  frame, and carries the confirmation across in `saved=`.
- **`Revert` means "back to what this page loaded with"**, which after a save is
  the saved values. To undo a save, use git.

`window.__anim` exposes the scene, the subject, the phase and the clearance
function, the way the sim exposes `__simCapture`, so a headless check can read a
measurement instead of scraping the panel.

`src/pose-tuning.test.ts` pins that `serializePoseTuning()` emits exactly what is
checked in, so a save with nothing edited cannot rewrite the file, and that every
arm key stays strictly inside the arc — a key at phase 0 or 1 would shadow the
one shared ready pose both ends of every arc are read from.

The numbers are still hand-ported into `tools/render_rigwalker_throw.py`. That
port does not read this file, so anything saved here has to be copied across or
the two instruments start describing different animations.

## Combat effects validation

Sparks, flashes, trails, and rings are not covered by the Blender duel tool,
which validates skeleton poses only. Judge them in the combat sim, which
renders them at gameplay scale under the real camera.

- Size particles in world units against the orthographic camera. There is no
  perspective divide, so `gl_PointSize` needs an explicit world-to-pixel
  uniform computed from the framebuffer height and `camera.zoom`.
- Never derive pixel sizes from `window.innerHeight`; a device pixel ratio
  above one will halve them.
- With `vertexColors`, leave `material.color` white. Tinting both squares the
  channels.
- Combat presentation reads `CombatFrame.events`, never per-frame cue diffs, so
  a swing resolving inside one frame produces exactly one spark and one sound.
- A fighter committing to a plan is a `plan` event on the same stream as the
  contacts, never a cue diff. It draws a small accent ring and makes no sound:
  the ring flashing as a fighter changes its mind reads well, but a tone on
  every plan buried the contacts it was supposed to sit under.
- Plans and ripostes are seen and not heard. Both draw a ring; both were
  playtested with a telephone keypad tone and both lost. A fight wants its
  sound spent on contact, and announcing decisions as often as fighters make
  them buries the clangs the tone was meant to punctuate.
- `audio.ts` keeps the keypad tones (`playKey`, `STRATEGY_KEYS`, `keyTones`,
  pinned by `src/audio.test.ts`) for interface sounds, where one press per
  press is the point. Nothing on the battlefield plays them.
- Additive effects over bright Martian ground blow out fast. A weapon trail at
  full accent strength reads as an opaque wedge covering the fighter rather
  than a swept smear of light; keep its leading edge well under 1.

## The Hurler and ranged combat

The Rigwalker Hurler throws rocks. It has one job — stand off and be deadly at
the top of its range — and one weakness, which is everything that happens once
somebody crosses that range.

Everything below is the *ranged* half of the unit. What it does once somebody has
crossed that range is "The hurler's close fight", further down.

Its bands are stated in the units the model itself defines, in `combat.ts`:

| throw | band | speed | damage | motion | releases at |
| --- | --- | --- | --- | --- | --- |
| `hurl` | up to 12 shoulder widths (16.08 m) | 32.5 m/s | 38 | 1.15 s | phase 0.58 |
| `pitch` | up to twice sword reach (8.6 m) | 17 m/s | 19 | 0.62 s | phase 0.44 |
| `toss` | inside sword reach (4.3 m) | 11 m/s | 8 | 0.30 s | phase 0.32 |

`SHOULDER_WIDTH` is 1.34 m, the span between the arm bones in
`create_rigwalker.py`. Both the long and medium ranges are derived, not typed
in, so moving `ATTACK_RANGE` or rebuilding the model moves them too.

- **Most effective at maximum range** is a measured claim, not a comment.
  `hurler.test.ts` holds a hurler at each band for thirty seconds and compares
  damage per second; long beats medium beats short by at least a fifth each,
  and the long throw is the most accurate as well as the hardest.
- **The gap picks the throw, and only while the hurler is still aiming.** Once
  the motion starts it is committed, the way a real thrower is. A swordsman
  walking a hurler down therefore visibly degrades it from hurl to pitch to
  toss, and then out of throwing altogether, which is the fight the unit exists
  to produce.
- **The toss band is what is left of sword reach once stone reach is taken out
  of the bottom of it** — 3.2 m to 4.3 m. Close enough to be worth a pebble, far
  enough that nobody has actually reached the thrower. A hurler does not throw at
  a body standing inside `STONE_RANGE`; it hits it with the rock instead, and
  `throwTarget` rejects anything that close.
- **A hurler never walks into a mutual duel, but it is charged into one.** At
  throwing range it gets a one-sided `ranged` encounter, is never promoted into a
  trade, and never picks up a sword plan. Inside `STONE_RANGE` that changes: the
  rock in its hand becomes a weapon and the pair is an ordinary trade, with
  ripostes and blocks and everything else. See "The hurler's close fight".
- A swordsman attacking a hurler **out at range** does not defer to it: a hurler
  is permanently mid-throw at somebody else, and treating that as "busy" left
  swordsmen standing next to one watching it work. A hurler in a *stone*
  exchange is genuinely busy and is deferred to like anyone else, which falls out
  of the deference test reading `isThrow` rather than the role.
- **The strike is resolved at release and replayed on arrival.** The `throw`
  event carries speed, flight time, and the already-rolled outcome, so
  presentation launches a rock that lands on the exact frame the director
  applies the damage. The exchange's recovery is extended to outlast the
  flight, or a rock still in the air would be re-planned out from under.
- Movement: a fighter with a long way to close runs it (`COMBAT_RUN_DISTANCE`)
  rather than shuffling, and a hurler backpedals slower than it is walked at.
  Without both, a hurler and its pursuer cross the map in step and nobody wins.
- Sparks for a thrown strike come off the **defender**, not the attacker's hand.
  Reading the attacker for a landing twelve metres away puts the whole shower
  on the wrong fighter.
- Rock size was set from the rendered result, like the sparks: under about a
  quarter of a metre it is a three-pixel speck and the throw reads as mime.
- Arc height is drawn from how *slow* a throw is, not from ballistics. All
  three are thrown far harder than their distance needs, so honest physics
  gives three flat lines; looping the slow ones is what makes the speed
  difference visible. `ROCK_REFERENCE_SPEED` is a fixed reference rather than
  the fastest throw: the hurl is thrown past it and sits pinned at the flat
  base, and raising it to match would loop the other two more.
- **A killing rock knocks its target down along its own line.** Damage carries
  `sourceId` and `thrown`, presentation turns those into a world direction, and
  the corpse tips its up-axis onto that line and is carried a little way down
  it. A cut has no line worth carrying — it lands from a fighter standing right
  there — so it keeps the sideways roll off `side`. Before this every rock kill
  in the game toppled the same way, because `planThrow` has no side to give and
  hardcodes `1`.

## The hurler's close fight

Once somebody crosses the standoff, the rock stops being ammunition and becomes a
weight in the hand. The hurler plans and reacts the way a swordsman does — it is
not a static animation played back — and it fights with four strikes and its
forearms. `src/stone.test.ts` pins all of it.

The strikes mirror how a weight in the hand is actually fought with. Power comes
from the ground up: the rear foot drives, the hips come round ahead of the
shoulders, and the arm arrives last. That sequence is slow and somebody has to
give you the time for it, which is the whole of the decision.

| strike | needs | motion | recovery | damage | reads as |
| --- | --- | --- | --- | --- | --- |
| `hammer` | most warning | 1.22 s | 0.68 s | 38 | both hands, overhead, straight down |
| `swing` | a window | 1.02 s | 0.54 s | 28 | the whole body, horizontal, arm last |
| `jab` | a moment | 0.56 s | 0.28 s | 14 | a thrust straight from the shoulder |
| `punch` | nothing | 0.36 s | 0.20 s | 9 | the fist the rock happens to be in |

- **The strike is chosen from how much time there is, and that reading is real.**
  `readIncoming` walks every encounter each frame and files what is *committed* —
  a blade past its measure, a rock already in the air — under the fighter it is
  arriving at, with how many seconds are left. `STONE_PROFILES.load` is what each
  strike costs out of that. A punch costs nothing, so there is always something
  left to throw. A riposte is planned with no room at all and therefore always
  comes out as a punch.
- **A rock still being wound up twelve metres away is not pressure.** It can be
  re-aimed and may never be thrown. Only committed strikes count, and that
  distinction is the whole value of the reading: it is what a fighter could
  actually see coming.
- **One arm against one blow, both against two from different bearings.**
  `isCovering` compares the bearings of the enemies working a fighter; far enough
  apart and one guard cannot answer both, so the cue carries `doubleGuard` and
  the pose puts up a boxer's high cover. It is worth something mechanically as
  well as visually — `STONE_COVER_RECOVERY` buys back most of the penalty a
  hurler pays for defending with arms rather than steel. Two swords still kill a
  hurler in every seed at a median of 7.6 s; the cover makes it defend itself,
  not survive.
- **The `doubleGuard` pass runs after every encounter has written its cue.**
  Which fighters are being worked by two enemies cannot be known mid-walk,
  because the second one may not have written yet.
- **A cover is a posture, not a flinch, and three things had to be right before
  it was one.** Reported from play as only ever being seen on a corpse — which
  is literally what was happening, since a defeated fighter keeps whatever pose
  it was last given and `update` returns before posing once health hits zero. It
  was up for about one per cent of a crowded fight. All three:
  - **The arc has to be reachable.** Two swordsmen on one target at fighting
    distance are held apart by the clearance floor and subtend about 39°, or
    about 51° as a flanking pair. Written at 50°, the common case never
    qualified. `STONE_COVER_ARC` is 0.5 rad — what two bodies genuinely on
    different sides of you comes to. One attacker can never reach it; two
    stacked on the same line do not either.
  - **Who is working you and what lands soonest are different questions.**
    `Incoming.bearings` is filed from every melee encounter within reach whether
    or not it has committed — a supporter circling for an opening is why the
    guard stays up. `Incoming.urgency` stays strict, because that one is about
    whether there is time to load a swing. Sharing one window between them meant
    each attacker only counted for the ~44% of its cycle it was committed, and
    two coinciding was rare.
  - **It is held on every frame the fighter is not swinging**, not only on the
    ones a blow lands. It reads as up about 70% of a two-on-one now, dropped
    only to strike, and eased in and out by a damped blend in `rigwalker.ts` —
    the condition flickers as attackers circle, and switched straight through,
    the arm strobes.
- **A hurler is charged into a duel; it never walks into one.** Two ways in, and
  neither is redundant. The promotion pass turns a swordsman's support encounter
  into a trade once the charger is inside `STONE_RANGE`. The mutual-candidate
  pass pairs a hurler with an enemy already that close — needed because a hurler
  does not throw at a body standing on top of it, so it may have no encounter to
  be promoted out of, and with nothing published nobody would ever engage it.
- **A defensive plan hands the attack to the other fighter, so a swordsman may
  not choose one against a hurler.** `react` and `distance-trap` made the hurler
  the attacker of a *sword* exchange: a fighter cutting with a weapon it does not
  carry, announcing plans it could not execute. Sizing one up is still fine —
  that leaves the attack where it was.
- **A duel involving a hurler is held together only to stone reach**
  (`releaseRange`), not to a hurler's throwing awareness. Left on the throwing
  range, a promoted pair stayed a "duel" fifteen metres apart with the hurler
  walking at the swordsman. A charge on a hurler still reaches as far as the
  hurler throws, because crossing that ground is the fight.
- **A hurler in a stone duel is out of its team's battery.** Left in, it dragged
  the focus onto the body standing in its own melee and had its teammates
  throwing rocks into it. `primaryParticipants` is what the battery pass reads,
  which is why the mutual-candidate pass has to add to it — it did not, and a
  hurler that paired off there was handed a second, ranged encounter on the same
  frame and drove both.

### The poses, and the measurement they are all built on

**The grip only reaches about 1.65 m in front of the fighter.** Measured on the
rig, not assumed. A blade is 2.65 m of steel and a hurler has an arm; two
Rigwalkers may not stand closer than `MIN_FIGHT_DISTANCE` without merging into
one silhouette. So the arm alone cannot cross the gap, and everything follows
from that:

- **A stone strike lunges**, and the legs stride under it. `STONE_LUNGE` is a
  model offset like the hurl's, and `stoneLegs` opens the stance to match —
  travel the legs do not make is a foot sliding along the ground. Measured at the
  frame the director resolves on, the hammer and the swing put the stone within
  0.1 m of the opponent's torso; the punch, which reaches least, sits at 0.44 m.
- **`STONE_FIGHT_DISTANCE` sits all but on the floor of the readable band** for
  the same reason, and that is not taste. Any further out and the stone resolves
  in the air between them.
- **The torso numbers are a quarter of what they first looked like they should
  be.** The root and the spine carry the arm with them, so a fold that reads as
  modest is a metre at the end of a reach: authored at four times a swordsman's
  cutting values, the jab's stone arrived at the opponent's knees and the swing
  crossed a metre and a half past the centre line. The sword's whole cut is 0.1
  rad of spine. Read `STONE_BODY` against that.
- **The arcs are keyed, not summed**, for the reason written on
  `POSE_TUNING.armKeys` — and both throws and strikes now go through one
  `keyedArmPose`, whose two ends are the single pose the fighter waits in.
- **The free arm's Z mirrors the striking arm's.** On the left arm negative Z is
  *across* the chest. The swing's counterweight was authored driving across
  through the whip and put the elbow 0.16 m inside the torso for a fifth of the
  strike — invisible in a silhouette, and the same fault `HURL_OPEN` exists to
  avoid one throw over. `stone.test.ts` now measures both arms against the torso
  box at twenty phases of every strike.
- **The stance is deliberately nothing like the throwing stance**: rock cocked at
  the shoulder rather than hanging at the hip, free hand forward as a lead. It is
  what tells a player at a glance which fight this hurler thinks it is in, and
  because it is held for most of a fight it is the pose most worth getting right.
  Two faults in it were reported from play and both are measurable:
  - **A cocked wrist swings the rock back along the forearm.** The rock rides the
    wrist bone at `ROCK_IN_HAND`, so `handX` moves it. At the 0.72 rad the stance
    first carried, the stone sat at 0.80 of the way from elbow to fist — behind
    the hand, lying on the arm. The number to watch is that ratio; 1.0 is in the
    fist, and it is worth checking on every key, not just the stance.
  - **A guard folded across the chest reads as a fighter hugging itself.** Solved
    for a hand in front of the sternum it crossed 0.12 m past the centre line with
    the forearm over the ribs. A lead hand — forward, a little across, mostly its
    own side — reads as a guard.
  - **Solve the elbow as well as the grip.** Given only a grip to hit, the
    solver abducted the shoulder 1.15 rad to reach it and left the elbow winged
    out 0.69 m to the side and 0.30 m below the shoulder. Where the elbow rides
    is half of what a guard reads as — the same stone in the same place is
    carried very differently on an arm tucked at the ribs. It hangs 0.68 m below
    the shoulder now, near the throwing stance's 0.75, with the forearm folded to
    carry the rock back up.
- **The rock has to clear the fist, and it is bigger than the fist.** The stone is
  0.56 m across, the hand is 0.28 m, and the hand mesh is centred on the wrist
  bone itself, so at `ROCK_IN_HAND` = 0.2 m the rock's near face sat 0.08 m
  *behind* the wrist and swallowed the whole hand. This was always true and only
  became visible with the close fight, because a throwing hurler carries that hand
  down at its hip where the rock is half hidden against the body. It is 0.32 m
  now. **`tools/render_rigwalker_throw.py` has the same constant and measures
  every release height from it**, so the two move together or the tool starts
  validating a rock the game does not draw.
- **Which pose runs is decided by the gap, not by the cue** — `closeFight` in
  `rigwalker.ts`. A defender's cue carries the *attacker's* plan, so a stance
  keyed off the cue's strategy would flicker several times an exchange. Throwing
  is exclusive of it: without that second rule, a hurler tossing a pebble at
  something three metres off was posed swinging a rock it was about to let go of.
- **The stone gets a trail.** `sampleBlade` offers the forearm-to-rock segment
  while a stone strike is running, so a heavy swing draws a smear and a block's
  sparks land on the arm that caught it. Only while striking: a rock being wound
  up to be thrown is not a weapon travelling through anything.

The strikes are not tunable in the animation tool, the way the sword's poses are
not: their numbers are constants in `rigwalker.ts` rather than in
`pose-tuning.ts`. They scrub there, which is what a pose needs.

## Throw animation validation

`tools/render_rigwalker_throw.py` is to the throws what the duel tool is to the
sword. It ports `applyThrowPose` onto the real imported GLB, measures, and only
then renders. **Keep the port in step with `src/rigwalker.ts`.**

**It is the wrong instrument for a stance.** The port stops at
`applyThrowPose`; the game runs `applyBalancePose` after it. So the tool is
authoritative about the arm and about what the throw asks the legs for, and it
is not authoritative about where a foot lands on screen — it once passed a
foot-drift check at 0.195 m while the shipped rear foot floated 0.41 m. For
anything about feet, weight or silhouette, measure the renderer that draws it:

```sh
EXTRA='zoom=6&on=HR1&feet=1' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.95
```

`on=` rides one fighter by label, `feet=1` prints each foot in that fighter's
own frame after every layer, and the script echoes every URL it builds — so the
frame in the screenshot and the frame in someone's browser are the same frame,
and can be pointed at rather than described.

```sh
blender --background --python tools/render_rigwalker_throw.py
```

It fails the build rather than producing a pretty picture when a throw is
wrong, and it checks things that were each caught by it in practice:

- the rock ends up in front of the body at release, not behind it;
- the wind-up actually travels (1.5 m for a hurl, 0.5 m for a toss);
- the rock comes over the top of the head, and the elbow stays above the
  shoulder from the moment the rock clears it until the release — that pair is
  what "overhand" means as a claim about the whole arc rather than one pose;
- release heights fall off with the throw: hurl, then pitch, then toss;
- feet stay near the ground (a thrower's rear heel lifts, so the limit is
  looser than the sword's, but they may not leave it);
- release heights fall off with the throw, which is also what catches a hurl
  crouched too deep into its own stride;
- consecutive phases are distinguishable at RTS scale;
- the pose settles back to the ready stance;
- a hurl is a **step**: the hurler waits with the trailing leg behind it and its
  weight on the throwing-side foot, releases over a lead foot that is in front
  of the other one, and does not skate that foot while it is planted;
- the free arm goes **round** the body rather than through it, checked against
  the torso's own box at a hundred phases of each throw.

`FEET=1` prints a hurl foot by foot across fifty phases, and `MEASURE=1` stops
before the renders, which are most of the runtime. A stance question is usually
`FEET=1 MEASURE=1` and ten seconds.

Three traps worth knowing before touching it:

- **Blender's Euler `XYZ` is not Three.js's.** Three.js composes its default
  XYZ as `qx*qy*qz`; Blender calls that order `ZYX`. All three Blender tools
  pose with `'ZYX'` for that reason. Get this wrong and any bone carrying two
  non-zero angles is validated and drawn in a pose the game never renders —
  which is what happened, silently, until it was caught.
- **Bone axis signs are measured, not guessed.** They are listed in the comment
  above `applyThrowPose`; the Z-up to Y-up conversion moves them, and the
  Euler order means a shoulder's abduction changes what its elevation does.
  When a pose fights back, measure a single axis at a time rather than reason.
- **The throwing arm is keyed, not summed.** The body runs on beats, but the
  arm runs on `THROW_ARM_KEYS`, because the shoulder only holds the arm above
  shoulder height through a narrow band of angles and a sum of beats walks out
  of that band between two good poses. Adding a beat term to the throwing arm
  reintroduces the dropped elbow the keys exist to avoid. The aiming arm has
  the same problem for a smaller reason — draw and stride overlap — so it runs
  on the larger of the two rather than their sum.
- **A leg swung back takes its foot up with it.** There is no IK: the pose is
  bone rotations over a body whose height comes from the terrain. So the hurl's
  step splits the stance and then pays for it, and `hurlStep` returns a `drop`
  alongside its `forward` for exactly that. Widen a stance without it and the
  feet float; overpay and the front sole goes under the ground and the release
  height sinks below the pitch's. Three things lift that rear foot, in order of
  size: **the folded knee**, the root pitch, and the hip sweep. A bent knee
  behind the body is worth more than the whole sweep. That is only a bill when
  the leg in question is the one being stood on: `drop` follows the *lower*
  foot, so once the lead foot is planted the rear knee may fold as much as the
  drive wants — and it should, because a foot has to be off the ground before it
  travels or it skates. Fold the knee of the leg holding the fighter up and the
  crouch that pays for it costs release height the throws are ordered by.
- **A limb has to be clear of the body before it swings through where the body
  is.** The free arm folds across the chest as a counterweight and then drives
  down and back, and riding the whip for the opening is too late — the whip *is*
  the swing. Held across through it, the elbow sat a quarter of a metre inside
  the torso for a fifth of the motion. `HURL_OPEN` gets it out first. This is
  the same rule as `HURL_TUCK` one limb up, and it is invisible in a silhouette:
  it took measuring the arm against the torso's own box to find, which the tool
  now does for all three throws.
- **The legs have their own beats, not the body's four.** `HURL_TUCK`,
  `HURL_SWING`, `HURL_STEP`, `HURL_HEEL`, `HURL_DRIVE` and `HURL_HOME` exist
  because each foot has to leave the ground slightly before it travels and land
  slightly before it takes weight, and none of draw/stride/whip/follow start
  where a foot needs to. Hanging a foot on a body beat is what makes it skate.
- **The coil drags the planted foot, and the lead leg has to cancel it.** The
  root's yaw turns the whole skeleton about a point on the ground, so the hips
  opening through the release sweeps the foot the fighter is standing on round
  with them — a quarter of a metre of it, measured. `hurlLegs` therefore takes a
  term off `hurlHips`. Nothing in `hurlStep`'s arithmetic can see this: it is
  planar, and this is a rotation about the vertical. It was found by measuring.
- **The root bone sits on the ground, not at the hips.** Pitching it forward is
  not bending at the waist: it swings the whole skeleton about the fighter's
  soles, and the rear foot, being behind that pivot, goes up. Bend the spine and
  the chest instead — they pivot where a spine does. Half of "standing on its
  toes" was a root pitch of 0.3 rad.
- **Only one layer can own the legs.** `applyBalancePose` runs on top of the
  throw pose, and its crouch and recovery steps are authored for a fighter that
  is only standing. Layered onto a stride they lifted the rear foot 0.17 m and
  closed the split back up, so `hurlStep` reports an `engagement` and the
  balance layer's leg authority is `1 - engagement`. Its lean and hit reaction
  are never scaled — those are the body's, whatever the feet were told to do.
- **A hurler stands bladed, not square, with the throwing-side leg forward.**
  The throw is under a second of a cycle over two seconds long, so the stance it
  waits in *is* the unit as far as anyone watching is concerned. `HURLER_STANCE`
  is in all three branches, held through the hurl and given back as the two
  shorter throws plant to square. Which leg is forward is not a coin toss: a
  hurl is a step, and standing with the trailing leg already in front leaves
  nowhere to step to, so the wind-up reads as a knee lifted on the spot.
  `HURLER_LOAD` gives the weighted leg the deeper knee, which is the whole of
  "weight on that leg" as far as the rig is concerned — and because `drop`
  follows the lower foot, it is also what puts that foot on the ground.
  All four branches have to agree on it to the decimal, or every throw opens
  with a foot jumping to a new spot.
- **Clear the imported animation data before rendering.** The GLB carries
  Idle, Walk and CombatIdle, and Blender re-applies whichever is assigned every
  time it renders a frame. Miss this and the measurements are right while every
  picture shows a unit standing still.

## Combat spacing

Spacing is a presentation constraint as much as a tactical one. Two Rigwalkers
closer than about 2.6 m merge into a single silhouette at RTS viewing scale and
the fight stops reading, whatever the poses are doing.

- `MIN_FIGHT_DISTANCE`, `MAX_FIGHT_DISTANCE`, and `BASE_FIGHT_DISTANCE` in
  `combat.ts` set the band a pair settles at. `ATTACK_RANGE` must stay clear of
  the top of that band or the exchange rewinds every frame.
- Fighters decide from a deliberately stale distance reading, which is what
  makes spacing look unrehearsed. The step itself is clamped against the real
  gap, so a decision made on old information cannot walk a unit through its
  opponent.
- Steering separation is not enough on its own. Several units converging on one
  target push inward faster than the separation drift pushes back, so
  `rigwalker.ts` also applies a positional clearance floor each frame.
- `src/rigwalker.test.ts` drives movement and planning together, without
  rendering, and pins the spacing a real fight settles at.

## Hysteresis, or the stutter step

A crowd is never quite still, so anything a unit decides by testing one
threshold against its neighbours every frame will be decided both ways, at
frame rate. It looks like a unit stepping on the spot, and it has shown up
twice in play. Both times the fix was a band rather than a line, and both are
pinned by tests that count how often a unit changes its mind.

- **Making room.** A standing unit steps away from a crowd at
  `SEPARATION_NUDGE` and keeps stepping until `SEPARATION_CLEAR`. With one
  threshold it walked and stopped every frame, half-blended through the 0.16 s
  crossfade into the walk clip. The nudge figure sits deliberately above the
  crowding a pair resolved by the clearance floor reads, so the common resting
  state is standing still rather than shuffling.
- **Noticing an enemy.** `ACQUIRE_SLACK` must stay below `RELEASE_SLACK` in
  `combat.ts`. They were both 1.35, which for a hurler meant acquiring and
  forgetting a target at the same 21.7 m: a hurler jostled on that line took
  the same encounter thirty times a second, and every one of them announced a
  plan. Sword and support encounters already had a band; only the ranged
  acquire did not.
- A plan event is a ring under the fighter, so an encounter that churns strobes.
  Watch the plan rate, not just the movement, when something looks wrong: at
  21.7 m that hurler was not moving at all and never threw a rock.

## Arriving at a waypoint

A waypoint is a point and a crowd cannot stand on one. Every unit a building
makes is sent to that building's single rally point, so the clearance floor
holds all but the first of them a body's width off it. Against an exact
arrival test they never arrive, and they shove at the point for as long as the
game runs — visible in play as units that will not settle down after a fight,
because a fight is what puts them all back on the road at once.

- Arrival is therefore two tests. Standing on the point
  (`ARRIVAL_DISTANCE`) still counts, and so does being stopped: no ground made
  up for `CROWD_ARRIVAL_SECONDS`, somebody within `CROWD_BLOCK_DISTANCE`
  standing between the unit and the point, and enough bodies already nearer the
  point to fill the ground still to cover.
- The fullness test is what keeps it honest. Bodies pack about a clearance
  apart, so the ground arrived units cover grows with the root of their number;
  comparing that against the distance left to walk distinguishes a full rally
  point from a merely busy one.
- Being stalled and crowded is not enough on its own, and reading it that way
  is the failure to watch for. A batch walking abreast to one rally point
  converges as it goes, and funnelling costs it a moment's ground with a
  neighbour right alongside — units that call that arrival stop a walk short of
  where they were sent. `src/rigwalker.test.ts` pins both directions.
- A unit leaving combat starts a fresh approach. Judged against the ground it
  had made before the fight, it would give up before setting off.
