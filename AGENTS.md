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
8. Create the first Blender robot and validate the animated GLB pipeline. **Next.**
9. Replace placeholders while preserving gameplay behavior.

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
Step 8 should create the first Blender-authored robot and validate animated GLB
loading without changing unit gameplay behavior.
