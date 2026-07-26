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
- Two entry points: `index.html` for the game and `sim.html` for the combat sim.
  Both are listed in `vite.config.ts`; a new page needs an entry there.
- `src/world.ts` owns terrain, lighting, and the camera; `src/battle.ts` owns one
  frame of fighting end to end. The game and the sim share both, so a change
  seen in the sim is a change the player gets.

Current camera controls are intentionally minimal after playtesting:

- `WASD` pans the camera.
- Mouse wheel zooms.
- Do not add edge scrolling, arrow-key panning, or mouse-drag panning unless the
  user asks for them; those controls were tested and removed.

## Initial game vocabulary

- Power building: **Reactor**
- Robot production building: **Assembly Bay**
- Mining building: **Extractor**
- Initial robot unit: **Rigwalker**

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

The initial slice has a small bounded Martian map and three pre-placed
buildings. The Assembly Bay produces one Rigwalker every 30 seconds. Units come
out through its spawn door, can be selected with left click, and receive move
orders with right click. The Reactor and Extractor initially generate simple
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
Bay, Extractor, and Rigwalker. The Rigwalker has an articulated procedural walk
cycle, can be selected with left click, and accepts terrain movement orders with
right click. It turns smoothly, follows the terrain, and returns to idle on
arrival. The Assembly Bay produces a new independently controllable Rigwalker
every 30 seconds: its shutter opens, the unit walks from inside to a clear rally
point, and the shutter closes. Selected units show an orange ring, movement
orders pulse on the terrain, and the operations HUD reports power, ore, unit
count, selection, and Assembly Bay progress. Units support single-click and
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
stages seeded 1v1 through 5v5 matchups against the same runtime, with a
per-fighter readout and an event log, and renders headlessly for review.

## Current playtest

The nine-step vertical slice has been manually playtested and feels good. The
current soak test is to leave the game running while the Assembly Bay produces
one Rigwalker every 30 seconds, then observe movement and interaction with many
units on screen.

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

Do not change the established WASD/wheel camera controls or the 30-second
production interval as part of performance work. Preserve left-click selection,
drag-box multi-selection, right-click orders, randomized rally points, and the
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

- Matchups are `1v1`, `2v2`, `3v2`, `3v3`, and `5v5`. Seeded, so a fight
  replays.
- `Space` pauses, `.` steps one frame, `R` restarts, `1`-`5` pick a matchup,
  `WASD` pans, wheel zooms.
- URL parameters: `matchup`, `seed`, `speed`, `zoom`, `hud=0`, `t`, and
  `contacts=1`, which logs where each strike throws its sparks in the
  attacker's own frame: reach toward the opponent, side, and height.

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
- Additive effects over bright Martian ground blow out fast. A weapon trail at
  full accent strength reads as an opaque wedge covering the fighter rather
  than a swept smear of light; keep its leading edge well under 1.

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
