import * as THREE from "three";
import {
  BUILDING_OBSTACLES,
  BUILDING_SITES,
  createBuildings,
} from "./buildings";
import { MovementMarkers } from "./feedback";
import { AssemblyBayProduction } from "./production";
import { createRigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
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
scene.background = new THREE.Color(0x1b0e0a);
scene.fog = new THREE.FogExp2(0x3b1710, 0.008);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const camera = new THREE.OrthographicCamera();
camera.position.set(36, 42, 36);
camera.zoom = 1.35;
camera.updateProjectionMatrix();

const cameraTarget = new THREE.Vector3(0, 0, 0);
const cameraOffset = camera.position.clone().sub(cameraTarget);

const hemisphereLight = new THREE.HemisphereLight(0xffc899, 0x32100b, 1.8);
scene.add(hemisphereLight);

const sun = new THREE.DirectionalLight(0xffd3a4, 3.2);
sun.position.set(-45, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 180;
scene.add(sun);

function pseudoRandom(index: number): number {
  const value = Math.sin(index * 91.3458) * 47453.5453;
  return value - Math.floor(value);
}

function terrainHeightAt(x: number, z: number): number {
  const localY = -z;
  return (
    Math.sin(x * 0.075) * 0.7 +
    Math.cos(localY * 0.064) * 0.55 +
    Math.sin((x + localY) * 0.035) * 0.85
  );
}

function createTerrain(): THREE.Mesh {
  const segments = 128;
  const geometry = new THREE.PlaneGeometry(
    MAP_SIZE,
    MAP_SIZE,
    segments,
    segments,
  );
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  const low = new THREE.Color(0x7f2919);
  const high = new THREE.Color(0xb94d2c);
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const broad =
      Math.sin(x * 0.075) * 0.7 +
      Math.cos(y * 0.064) * 0.55 +
      Math.sin((x + y) * 0.035) * 0.85;
    const grit = (pseudoRandom(index) - 0.5) * 0.34;
    const height = broad + grit;

    positions.setZ(index, height);
    color.lerpColors(low, high, THREE.MathUtils.clamp((height + 2) / 4, 0, 1));
    color.offsetHSL(0, 0, (pseudoRandom(index + 517) - 0.5) * 0.045);
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  return terrain;
}

function createRocks(): THREE.Group {
  const rocks = new THREE.Group();
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x542017,
    roughness: 0.94,
  });

  for (let index = 0; index < 70; index += 1) {
    const scale = 0.25 + pseudoRandom(index + 300) * 1.6;
    const x = (pseudoRandom(index + 100) - 0.5) * (MAP_SIZE - 10);
    const z = (pseudoRandom(index + 200) - 0.5) * (MAP_SIZE - 10);

    if (BUILDING_SITES.some((site) => site.distanceTo(new THREE.Vector2(x, z)) < 8)) {
      continue;
    }

    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(x, terrainHeightAt(x, z) + scale * 0.48, z);
    rock.rotation.set(
      pseudoRandom(index + 400) * Math.PI,
      pseudoRandom(index + 500) * Math.PI,
      pseudoRandom(index + 600) * Math.PI,
    );
    rock.scale.set(scale, scale * (0.55 + pseudoRandom(index + 700)), scale);
    rock.castShadow = true;
    rock.receiveShadow = true;
    rocks.add(rock);
  }

  return rocks;
}

const terrain = createTerrain();
const corporateBases = createBuildings(terrainHeightAt);
scene.add(terrain, createRocks(), ...corporateBases.map((base) => base.group));

const units = corporateBases.map((base) => {
  const rigwalker = createRigwalker(rigwalkerAsset, base.accent);
  rigwalker.group.position.set(
    base.spawnPosition.x,
    terrainHeightAt(base.spawnPosition.x, base.spawnPosition.y) + 0.2,
    base.spawnPosition.y,
  );
  rigwalker.moveTo(new THREE.Vector3(0, 0, 0));
  scene.add(rigwalker.group);
  return rigwalker;
});
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
  ),
);
const movementMarkers = new MovementMarkers(scene);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedRigwalkers: (typeof units)[number][] = [];
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
  for (const unit of selectedRigwalkers) {
    unit.setSelected(true);
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
    selectRigwalkers(selected ? [selected] : []);
  }

  selectionDragStart = null;
  selectionDragging = false;
  selectionBox!.style.display = "none";
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();

  if (selectedRigwalkers.length === 0) {
    return;
  }

  updatePointer(event);
  const terrainHit = raycaster.intersectObject(terrain, false)[0];
  if (terrainHit) {
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
  const width = window.innerWidth;
  const height = window.innerHeight;
  const viewHeight = 52;
  const viewWidth = viewHeight * (width / height);

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
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
    selectedRigwalkers.length === 0
      ? "None"
      : selectedRigwalkers.length === 1
        ? "Rigwalker"
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
  for (const unit of units) {
    unit.update(
      delta,
      clock.elapsedTime,
      terrainHeightAt,
      units,
      BUILDING_OBSTACLES,
    );
  }
  updateHud(clock.elapsedTime);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
