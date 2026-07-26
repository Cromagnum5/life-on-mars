import * as THREE from "three";
import { BattleRuntime } from "./battle";
import {
  BUILDING_OBSTACLES,
  BUILDING_SITES,
  createBuildings,
} from "./buildings";
import { MovementMarkers } from "./feedback";
import { STRATEGY_LABELS } from "./combat";
import { AssemblyBayProduction } from "./production";
import { createRigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
import {
  addMarsLighting,
  applyMarsAtmosphere,
  createMarsRenderer,
  createRocks,
  createTabletopCamera,
  createTerrain,
  fitCameraToViewport,
  terrainHeightAt,
} from "./world";
import "./style.css";

const MAP_SIZE = 180;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3.2;
const rigwalkerAsset = await loadRigwalkerAsset("/models/rigwalker.glb");

const canvas = document.querySelector<HTMLCanvasElement>("#game");

if (!canvas) {
  throw new Error("Game canvas is missing.");
}

const scene = new THREE.Scene();
applyMarsAtmosphere(scene);
addMarsLighting(scene);

const renderer = createMarsRenderer(canvas);
const camera = createTabletopCamera();
const cameraTarget = new THREE.Vector3(0, 0, 0);
const cameraOffset = camera.position.clone().sub(cameraTarget);

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
  const rigwalker = createRigwalker(rigwalkerAsset, base.accent, base.corporation);
  rigwalker.group.position.set(
    base.spawnPosition.x,
    terrainHeightAt(base.spawnPosition.x, base.spawnPosition.y) + 0.2,
    base.spawnPosition.y,
  );
  rigwalker.moveTo(new THREE.Vector3(0, 0, 0));
  battle.spawn(rigwalker);
}
const productions = corporateBases.map((base) =>
  new AssemblyBayProduction(
    scene,
    base.assemblyDoor,
    units,
    terrainHeightAt,
    rigwalkerAsset,
    base.spawnPosition,
    new THREE.Vector3(0, 0, 0),
    base.accent,
    base.corporation,
  ),
);
battle.audio.installUnlockHandlers();
const movementMarkers = new MovementMarkers(scene);
const rallyMarkers = corporateBases.map((base) => {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.65, 0.82, 32),
    new THREE.MeshBasicMaterial({
      color: base.accent,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);
  return marker;
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedRigwalkers: (typeof units)[number][] = [];
let selectedAssemblyIndex: number | null = null;
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
    selectAssembly(null);
  }
  for (const unit of selectedRigwalkers) {
    unit.setSelected(true);
  }
}

function selectAssembly(index: number | null): void {
  selectedAssemblyIndex = index;
  corporateBases.forEach((base, baseIndex) => {
    base.assemblySelectionRing.visible = baseIndex === index;
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
    selectAssembly(null);
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
      const assemblyIndex = corporateBases.findIndex((base) =>
        raycaster
          .intersectObject(base.assemblyBay, true)
          .some((hit) => hit.object !== base.assemblySelectionRing),
      );
      if (assemblyIndex >= 0) {
        selectAssembly(assemblyIndex);
      } else {
        selectAssembly(null);
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
    if (selectedRigwalkers.length === 0 && selectedAssemblyIndex !== null) {
      const destination = clearBuildingFootprints(terrainHit.point);
      productions[selectedAssemblyIndex].setRallyPoint(destination);
      const marker = rallyMarkers[selectedAssemblyIndex];
      marker.position.copy(destination);
      marker.position.y += 0.1;
      marker.visible = true;
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

window.addEventListener("keydown", (event) => keys.add(event.code));
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

canvas.addEventListener(
  "wheel",
  (event) => {
    camera.zoom = THREE.MathUtils.clamp(
      camera.zoom * Math.exp(-event.deltaY * 0.001),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    camera.updateProjectionMatrix();
    event.preventDefault();
  },
  { passive: false },
);

function resize(): void {
  fitCameraToViewport(camera, renderer, window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", resize);
resize();

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
    const speed = 23 / camera.zoom;
    cameraTarget.x += (direction.x + direction.y) * speed * delta;
    cameraTarget.z += (-direction.x + direction.y) * speed * delta;
  }

  const boundary = MAP_SIZE * 0.42;
  cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, -boundary, boundary);
  cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, -boundary, boundary);
  camera.position.copy(cameraTarget).add(cameraOffset);
  camera.lookAt(cameraTarget);
}

/** Surfaces the fighter's persistent temperament and its current plan. */
function describeRigwalker(unit: (typeof units)[number]): string {
  const temperament = unit.combatProfile.temperament;
  const readable = temperament[0].toUpperCase() + temperament.slice(1);
  const plan = unit.strategy ? ` · ${STRATEGY_LABELS[unit.strategy] ?? unit.strategy}` : "";
  return `Rigwalker · ${Math.ceil(unit.health)} HP · ${readable}${plan}`;
}

function updateHud(elapsed: number): void {
  const productionStatuses = productions.map((item) => item.getStatus());
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
    selectedAssemblyIndex !== null
      ? `${corporateBases[selectedAssemblyIndex].corporation} Assembly Bay · Set rally with right click`
      : selectedRigwalkers.length === 0
        ? "None"
      : selectedRigwalkers.length === 1
        ? describeRigwalker(selectedRigwalkers[0])
        : `${selectedRigwalkers.length} Rigwalkers`;
}

const clock = new THREE.Clock();

function animate(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateCamera(delta);
  for (const production of productions) {
    production.update(delta);
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
