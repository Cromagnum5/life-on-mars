import * as THREE from "three";
import { BattleRuntime } from "./battle";
import {
  BUILDING_OBSTACLES,
  BUILDING_SITES,
  createBuildings,
  type ProducerBuilding,
  type StarterBase,
} from "./buildings";
import { MovementMarkers } from "./feedback";
import { STRATEGY_LABELS } from "./combat";
import {
  BuildingProduction,
  HURLER_ORDER,
  SWORD_ORDER,
  type ProductionOrder,
} from "./production";
import { createRigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
import {
  addMarsLighting,
  applyMarsAtmosphere,
  DEFAULT_FOV,
  VIEW_HEIGHT,
  createCameraOrbit,
  createMarsRenderer,
  createPerspectiveCamera,
  createRocks,
  createTabletopCamera,
  createTerrain,
  fitCameraToViewport,
  orbitBy,
  orbitOffset,
  panFocus,
  radiusForFov,
  terrainHeightAt,
  type TabletopCamera,
} from "./world";
import "./style.css";

const MAP_SIZE = 180;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3.2;
/** How fast the arrow keys swing the view, in radians a second. */
const ORBIT_SPEED = THREE.MathUtils.degToRad(70);
const rigwalkerAsset = await loadRigwalkerAsset("/models/rigwalker.glb");

const canvas = document.querySelector<HTMLCanvasElement>("#game");

if (!canvas) {
  throw new Error("Game canvas is missing.");
}

const scene = new THREE.Scene();
applyMarsAtmosphere(scene);
addMarsLighting(scene);

const renderer = createMarsRenderer(canvas);
/**
 * The game is orthographic and the visual direction says so, but that choice is
 * still open while the game is being decided, and it is the one thing you
 * cannot judge from a still: orthographic holds a unit's size at any distance,
 * which at a low camera angle reads as a giant standing at the horizon. `P`
 * swaps the projection so the two can be compared on the same view.
 */
const params = new URLSearchParams(window.location.search);
const fov = Number(params.get("fov") ?? DEFAULT_FOV);
const orthographicCamera = createTabletopCamera();
const perspectiveCamera = createPerspectiveCamera(1, fov);
let camera: TabletopCamera = params.get("camera") === "perspective"
  ? perspectiveCamera
  : orthographicCamera;
/** Magnification, held here because the two projections spend it differently. */
let zoomLevel = orthographicCamera.zoom;
const cameraTarget = new THREE.Vector3(0, 0, 0);
const cameraOrbit = createCameraOrbit();
// A headless capture cannot press a key, so the angle is a parameter too.
orbitBy(
  cameraOrbit,
  THREE.MathUtils.degToRad(Number(params.get("yaw") ?? 0)),
  THREE.MathUtils.degToRad(Number(params.get("pitch") ?? 0)),
);
const cameraOffset = new THREE.Vector3();

/**
 * Spends the zoom on whichever projection is drawing. Orthographic scales its
 * frustum on the spot. Perspective leaves the lens alone and walks the eye in,
 * because magnifying by narrowing the lens is what a telephoto does and a
 * telephoto flattens the depth the projection was chosen for.
 */
function applyZoom(): void {
  if (camera === perspectiveCamera) {
    perspectiveCamera.zoom = 1;
    cameraOrbit.radius = radiusForFov(fov, VIEW_HEIGHT / zoomLevel);
  } else {
    orthographicCamera.zoom = zoomLevel;
    cameraOrbit.radius = radiusForFov(fov);
  }
  camera.updateProjectionMatrix();
}

const terrain = createTerrain(MAP_SIZE);
const corporateBases = createBuildings(terrainHeightAt);
scene.add(
  terrain,
  createRocks(MAP_SIZE, 70, BUILDING_SITES),
  ...corporateBases.map((base) => base.group),
);

const accentByCorporation = new Map(
  corporateBases.map((base) => [base.corporation, base.accent]),
);
const battle = new BattleRuntime(scene, {
  accentOf: (corporation) => accentByCorporation.get(corporation) ?? 0xffb35d,
});
const units = battle.units;
for (const base of corporateBases) {
  const spawn = base.assemblyBay.spawnPosition;
  const rigwalker = createRigwalker(rigwalkerAsset, base.accent, base.corporation);
  rigwalker.group.position.set(
    spawn.x,
    terrainHeightAt(spawn.x, spawn.y) + 0.2,
    spawn.y,
  );
  rigwalker.moveTo(new THREE.Vector3(0, 0, 0));
  battle.spawn(rigwalker);
}

/** A building that produces, with the rally point the player set for it. */
type Producer = {
  corporation: string;
  building: ProducerBuilding;
  production: BuildingProduction;
  rallyMarker: THREE.Mesh;
};

function createProducer(
  base: StarterBase,
  building: ProducerBuilding,
  order: ProductionOrder,
): Producer {
  const rallyMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.65, 0.82, 32),
    new THREE.MeshBasicMaterial({
      color: base.accent,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  rallyMarker.rotation.x = -Math.PI / 2;
  rallyMarker.visible = false;
  scene.add(rallyMarker);
  return {
    corporation: base.corporation,
    building,
    rallyMarker,
    production: new BuildingProduction({
      scene,
      door: building.door,
      units,
      terrainHeightAt,
      rigwalkerAsset,
      spawnPosition: building.spawnPosition,
      // Every building starts sending its units to the middle of the map, and
      // each one is moved from there on its own.
      rallyPoint: new THREE.Vector3(0, 0, 0),
      accent: base.accent,
      corporation: base.corporation,
      order,
    }),
  };
}

const producers = corporateBases.flatMap((base) => [
  createProducer(base, base.assemblyBay, SWORD_ORDER),
  createProducer(base, base.stoneworks, HURLER_ORDER),
]);
battle.audio.installUnlockHandlers();
const movementMarkers = new MovementMarkers(scene);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedRigwalkers: (typeof units)[number][] = [];
let selectedProducerIndex: number | null = null;
let selectionDragStart: THREE.Vector2 | null = null;
let selectionDragging = false;

const powerValue = document.querySelector<HTMLElement>("#power-value");
const resourceValue = document.querySelector<HTMLElement>("#resource-value");
const productionValue = document.querySelector<HTMLElement>("#production-value");
const productionBar = document.querySelector<HTMLElement>("#production-bar");
const unitValue = document.querySelector<HTMLElement>("#unit-value");
const selectionValue = document.querySelector<HTMLElement>("#selection-value");
const selectionBox = document.querySelector<HTMLElement>("#selection-box");

if (
  !powerValue ||
  !resourceValue ||
  !productionValue ||
  !productionBar ||
  !unitValue ||
  !selectionValue ||
  !selectionBox
) {
  throw new Error("Operations HUD is incomplete.");
}

function selectRigwalkers(
  nextSelection: (typeof units)[number][],
): void {
  for (const unit of selectedRigwalkers) {
    unit.setSelected(false);
  }
  selectedRigwalkers = nextSelection;
  if (nextSelection.length > 0) {
    selectProducer(null);
  }
  for (const unit of selectedRigwalkers) {
    unit.setSelected(true);
  }
}

function selectProducer(index: number | null): void {
  selectedProducerIndex = index;
  producers.forEach((producer, producerIndex) => {
    producer.building.selectionRing.visible = producerIndex === index;
  });
  if (index !== null) {
    selectRigwalkers([]);
  }
}

function updatePointer(event: PointerEvent): void {
  const bounds = canvas!.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function clearBuildingFootprints(position: THREE.Vector3): THREE.Vector3 {
  const adjusted = position.clone();

  for (const obstacle of BUILDING_OBSTACLES) {
    const offset = new THREE.Vector2(
      adjusted.x - obstacle.center.x,
      adjusted.z - obstacle.center.y,
    );
    const clearance = obstacle.radius + 0.8;
    if (offset.length() < clearance) {
      if (offset.lengthSq() < 0.001) {
        offset.set(0, 1);
      } else {
        offset.normalize();
      }
      adjusted.x = obstacle.center.x + offset.x * clearance;
      adjusted.z = obstacle.center.y + offset.y * clearance;
      adjusted.y = terrainHeightAt(adjusted.x, adjusted.z);
    }
  }

  return adjusted;
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  selectionDragStart = new THREE.Vector2(event.clientX, event.clientY);
  selectionDragging = false;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!selectionDragStart) {
    return;
  }

  const distance = selectionDragStart.distanceTo(
    new THREE.Vector2(event.clientX, event.clientY),
  );
  if (distance > 5) {
    selectionDragging = true;
  }
  if (!selectionDragging) {
    return;
  }

  const left = Math.min(selectionDragStart.x, event.clientX);
  const top = Math.min(selectionDragStart.y, event.clientY);
  selectionBox!.style.display = "block";
  selectionBox!.style.left = `${left}px`;
  selectionBox!.style.top = `${top}px`;
  selectionBox!.style.width = `${Math.abs(event.clientX - selectionDragStart.x)}px`;
  selectionBox!.style.height = `${Math.abs(event.clientY - selectionDragStart.y)}px`;
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button !== 0 || !selectionDragStart) {
    return;
  }

  if (selectionDragging) {
    const bounds = canvas.getBoundingClientRect();
    const left = Math.min(selectionDragStart.x, event.clientX);
    const right = Math.max(selectionDragStart.x, event.clientX);
    const top = Math.min(selectionDragStart.y, event.clientY);
    const bottom = Math.max(selectionDragStart.y, event.clientY);
    const projected = new THREE.Vector3();
    selectProducer(null);
    selectRigwalkers(
      units.filter((unit) => {
        projected.copy(unit.group.position).project(camera);
        const screenX = bounds.left + ((projected.x + 1) / 2) * bounds.width;
        const screenY = bounds.top + ((1 - projected.y) / 2) * bounds.height;
        return (
          projected.z >= -1 &&
          projected.z <= 1 &&
          screenX >= left &&
          screenX <= right &&
          screenY >= top &&
          screenY <= bottom
        );
      }),
    );
  } else {
    updatePointer(event);
    const selected = units.find(
      (unit) => raycaster.intersectObject(unit.group, true).length > 0,
    );
    if (selected) {
      selectRigwalkers([selected]);
    } else {
      const producerIndex = producers.findIndex((producer) =>
        raycaster
          .intersectObject(producer.building.group, true)
          .some((hit) => hit.object !== producer.building.selectionRing),
      );
      if (producerIndex >= 0) {
        selectProducer(producerIndex);
      } else {
        selectProducer(null);
        selectRigwalkers([]);
      }
    }
  }

  selectionDragStart = null;
  selectionDragging = false;
  selectionBox!.style.display = "none";
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();

  updatePointer(event);
  const terrainHit = raycaster.intersectObject(terrain, false)[0];
  if (terrainHit) {
    if (selectedRigwalkers.length === 0 && selectedProducerIndex !== null) {
      const destination = clearBuildingFootprints(terrainHit.point);
      const { production, rallyMarker } = producers[selectedProducerIndex];
      production.setRallyPoint(destination);
      rallyMarker.position.copy(destination);
      rallyMarker.position.y += 0.1;
      rallyMarker.visible = true;
      movementMarkers.add(destination);
      return;
    }

    if (selectedRigwalkers.length === 0) {
      return;
    }

    const columns = Math.ceil(Math.sqrt(selectedRigwalkers.length));
    const rows = Math.ceil(selectedRigwalkers.length / columns);
    const spacing = 1.55;
    selectedRigwalkers.forEach((unit, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const destination = terrainHit.point.clone();
      destination.x += (column - (columns - 1) / 2) * spacing;
      destination.z += (row - (rows - 1) / 2) * spacing;
      unit.moveTo(clearBuildingFootprints(destination));
    });
    movementMarkers.add(clearBuildingFootprints(terrainHit.point));
  }
});

const keys = new Set<string>();

window.addEventListener("keydown", (event) => {
  // The arrows drive the camera, so they must not also scroll the page.
  if (event.code.startsWith("Arrow")) event.preventDefault();
  // A toggle, not a held key: it belongs on the edge, not in the frame loop.
  if (event.code === "KeyP" && !event.repeat) {
    camera = camera === orthographicCamera ? perspectiveCamera : orthographicCamera;
    applyZoom();
    resize();
    updateProjectionHint();
  }
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

canvas.addEventListener(
  "wheel",
  (event) => {
    zoomLevel = THREE.MathUtils.clamp(
      zoomLevel * Math.exp(-event.deltaY * 0.001),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    applyZoom();
    event.preventDefault();
  },
  { passive: false },
);

function resize(): void {
  fitCameraToViewport(camera, renderer, window.innerWidth, window.innerHeight);
}

/** Names the projection in the control hint, so pressing `P` confirms itself. */
function updateProjectionHint(): void {
  const label = document.querySelector("#projection-label");
  if (label) {
    label.textContent = camera === perspectiveCamera ? "Depth view" : "Flat view";
  }
}

window.addEventListener("resize", resize);
applyZoom();
resize();
updateProjectionHint();

function updateCamera(delta: number): void {
  const direction = new THREE.Vector2();

  if (keys.has("KeyA")) {
    direction.x -= 1;
  }
  if (keys.has("KeyD")) {
    direction.x += 1;
  }
  if (keys.has("KeyW")) {
    direction.y -= 1;
  }
  if (keys.has("KeyS")) {
    direction.y += 1;
  }

  if (direction.lengthSq() > 0) {
    direction.normalize();
    const speed = (23 * Math.SQRT2) / zoomLevel;
    // Panned in the camera's own frame, so W still walks the view away from the
    // player however far round the map has been swung.
    panFocus(cameraOrbit, cameraTarget, -direction.y, direction.x, speed * delta);
  }

  let yaw = 0;
  let pitch = 0;
  if (keys.has("ArrowLeft")) yaw -= 1;
  if (keys.has("ArrowRight")) yaw += 1;
  if (keys.has("ArrowUp")) pitch += 1;
  if (keys.has("ArrowDown")) pitch -= 1;
  if (yaw !== 0 || pitch !== 0) {
    orbitBy(cameraOrbit, yaw * ORBIT_SPEED * delta, pitch * ORBIT_SPEED * delta);
  }

  const boundary = MAP_SIZE * 0.42;
  cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, -boundary, boundary);
  cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, -boundary, boundary);
  camera.position.copy(cameraTarget).add(orbitOffset(cameraOrbit, cameraOffset));
  camera.lookAt(cameraTarget);
}

/** Surfaces the fighter's persistent temperament and its current plan. */
function describeRigwalker(unit: (typeof units)[number]): string {
  const temperament = unit.combatProfile.temperament;
  const readable = temperament[0].toUpperCase() + temperament.slice(1);
  const plan = unit.strategy ? ` · ${STRATEGY_LABELS[unit.strategy] ?? unit.strategy}` : "";
  const kind = unit.role === "hurler" ? "Rigwalker Hurler" : "Rigwalker";
  return `${kind} · ${Math.ceil(unit.health)} HP · ${readable}${plan}`;
}

function updateHud(elapsed: number): void {
  const productionStatuses = producers.map((producer) => producer.production.getStatus());
  const deploying = productionStatuses.some((status) => status.label === "Deploying");
  const secondsRemaining = Math.min(...productionStatuses.map((status) => status.secondsRemaining));
  powerValue!.textContent = `${120 + Math.floor(elapsed * 0.05)} MWh`;
  resourceValue!.textContent = `${250 + Math.floor(elapsed * 1.6)} t`;
  productionValue!.textContent =
    deploying
      ? "Deploying"
      : `00:${secondsRemaining.toString().padStart(2, "0")}`;
  productionBar!.style.width = `${Math.max(...productionStatuses.map((status) => status.progress)) * 100}%`;
  unitValue!.textContent = units.length.toString();
  selectionValue!.textContent =
    selectedProducerIndex !== null
      ? `${producers[selectedProducerIndex].corporation} ` +
        `${producers[selectedProducerIndex].building.label} · Set rally with right click`
      : selectedRigwalkers.length === 0
        ? "None"
      : selectedRigwalkers.length === 1
        ? describeRigwalker(selectedRigwalkers[0])
        : `${selectedRigwalkers.length} Rigwalkers · ` +
          `${selectedRigwalkers.filter((unit) => unit.role === "hurler").length} hurling`;
}

const clock = new THREE.Clock();

function animate(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateCamera(delta);
  for (const producer of producers) {
    producer.production.update(delta);
  }
  movementMarkers.update(delta);
  battle.update(delta, clock.elapsedTime, {
    camera,
    focus: cameraTarget,
    drawingBufferHeight: renderer.domElement.height,
    terrainHeightAt,
    obstacles: BUILDING_OBSTACLES,
  });
  selectedRigwalkers = selectedRigwalkers.filter((unit) => unit.isAlive);
  updateHud(clock.elapsedTime);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
