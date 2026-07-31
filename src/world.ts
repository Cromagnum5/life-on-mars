import * as THREE from "three";

/**
 * The Martian surface and the way it is lit and framed. Both the game and the
 * combat sim build their scene from here so a fight looks the same in each,
 * and so tuning the light or the camera angle is a single edit.
 */

/** Height of the fixed three-quarter view in world units. */
export const VIEW_HEIGHT = 52;

const SUN_DIRECTION = new THREE.Vector3(-45, 70, 25);

export function pseudoRandom(index: number): number {
  const value = Math.sin(index * 91.3458) * 47453.5453;
  return value - Math.floor(value);
}

/**
 * The terrain surface. `PlaneGeometry` is authored in XY and then rotated, so
 * the plane's local Y runs opposite world Z; the mapping is done here once
 * rather than at every call site.
 */
export function terrainHeightAt(x: number, z: number): number {
  const localY = -z;
  return (
    Math.sin(x * 0.075) * 0.7 +
    Math.cos(localY * 0.064) * 0.55 +
    Math.sin((x + localY) * 0.035) * 0.85
  );
}

export function createTerrain(size: number, segments = 128): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
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

  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );
  terrain.name = "Mars surface";
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  return terrain;
}

/**
 * The scattered surface rocks, all of them in one draw.
 *
 * They were a mesh apiece, which is seventy draws in the game and forty in the
 * sim — and then again in the shadow pass — for a boulder field that never
 * moves and is one geometry and one material throughout. Nothing about where
 * they are placed has changed: the same `pseudoRandom` sequence is walked in
 * the same order, so the same rocks stand in the same places as before.
 */
export function createRocks(
  size: number,
  count = 70,
  keepClearOf: readonly THREE.Vector2[] = [],
  clearance = 8,
): THREE.InstancedMesh {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x542017, roughness: 0.94 });
  // Allocated for the whole draw and then trimmed: how many survive the
  // clearance test is not known until they have all been tried, and a few
  // unused slots are cheaper than counting them twice.
  const rocks = new THREE.InstancedMesh(geometry, material, count);
  rocks.name = "Rocks";
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const site = new THREE.Vector2();
  const rock = new THREE.Object3D();
  let placed = 0;

  for (let index = 0; index < count; index += 1) {
    const scale = 0.25 + pseudoRandom(index + 300) * 1.6;
    const x = (pseudoRandom(index + 100) - 0.5) * (size - 10);
    const z = (pseudoRandom(index + 200) - 0.5) * (size - 10);

    site.set(x, z);
    if (keepClearOf.some((center) => center.distanceTo(site) < clearance)) {
      continue;
    }

    rock.position.set(x, terrainHeightAt(x, z) + scale * 0.48, z);
    rock.rotation.set(
      pseudoRandom(index + 400) * Math.PI,
      pseudoRandom(index + 500) * Math.PI,
      pseudoRandom(index + 600) * Math.PI,
    );
    rock.scale.set(scale, scale * (0.55 + pseudoRandom(index + 700)), scale);
    rock.updateMatrix();
    rocks.setMatrixAt(placed, rock.matrix);
    placed += 1;
  }

  rocks.count = placed;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  return rocks;
}

export function applyMarsAtmosphere(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x1b0e0a);
  scene.fog = new THREE.FogExp2(0x3b1710, 0.008);
}

/**
 * Warm key light with a wide shadow frustum. `shadowRadius` sizes that frustum
 * to the area actually occupied: a sim arena is far smaller than the map, and a
 * tighter frustum spends the same shadow map on far more detail.
 */
export function addMarsLighting(scene: THREE.Scene, shadowRadius = 70): void {
  scene.add(new THREE.HemisphereLight(0xffc899, 0x32100b, 1.8));

  const sun = new THREE.DirectionalLight(0xffd3a4, 3.2);
  sun.position.copy(SUN_DIRECTION);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -shadowRadius;
  sun.shadow.camera.right = shadowRadius;
  sun.shadow.camera.top = shadowRadius;
  sun.shadow.camera.bottom = -shadowRadius;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  scene.add(sun);
}

export function createMarsRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
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
  // The renderer clears its own counters between the shadow pass and the colour
  // pass, so a page reading them afterwards is told about half its frame. The
  // shadow pass draws every caster a second time and is worth roughly as much
  // as the pass that follows it; a draw count leaving it out would have said a
  // crowded frame was half the size it is. So the pages reset it themselves,
  // once, at the end of the frame.
  renderer.info.autoReset = false;
  return renderer;
}

/** Where the default three-quarter view sits, as an offset from what it watches. */
const DEFAULT_EYE = new THREE.Vector3(36, 42, 36);

/** How far the view may be tipped. Level with the ground reads as nothing, and
 * straight down leaves `lookAt` with no way to tell which way is north. */
const MIN_PITCH = THREE.MathUtils.degToRad(6);
const MAX_PITCH = THREE.MathUtils.degToRad(84);

/**
 * The orbit the camera hangs on: an eye held at `radius` from the focus, turned
 * `yaw` about the vertical and lifted `pitch` above the ground. The default is
 * the three-quarter view the game has always used; the game and the sim both
 * let the player swing it, because the shape of a fight is not yet decided and
 * the answer is easier to see from a few angles than to argue from one.
 */
export interface CameraOrbit {
  /** Rotation about the vertical, in radians. Zero looks along +z. */
  yaw: number;
  /** Elevation above the ground plane, in radians. */
  pitch: number;
  /** Distance from the focus to the eye. */
  radius: number;
}

export function createCameraOrbit(): CameraOrbit {
  return {
    yaw: Math.atan2(DEFAULT_EYE.x, DEFAULT_EYE.z),
    pitch: Math.atan2(DEFAULT_EYE.y, Math.hypot(DEFAULT_EYE.x, DEFAULT_EYE.z)),
    radius: DEFAULT_EYE.length(),
  };
}

/** Turns the orbit and tips it, keeping the elevation inside its limits. */
export function orbitBy(orbit: CameraOrbit, yaw: number, pitch: number): void {
  orbit.yaw += yaw;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + pitch, MIN_PITCH, MAX_PITCH);
}

/** Writes the orbit into `offset`: the vector from the focus out to the eye. */
export function orbitOffset(orbit: CameraOrbit, offset: THREE.Vector3): THREE.Vector3 {
  const ground = Math.cos(orbit.pitch) * orbit.radius;
  return offset.set(
    Math.sin(orbit.yaw) * ground,
    Math.sin(orbit.pitch) * orbit.radius,
    Math.cos(orbit.yaw) * ground,
  );
}

/**
 * Moves the focus across the ground in the camera's own frame, so panning still
 * means what the screen says it means once the view has been swung round.
 * `forward` runs away from the eye, `right` runs to screen right.
 */
export function panFocus(
  orbit: CameraOrbit,
  focus: THREE.Vector3,
  forward: number,
  right: number,
  distance: number,
): void {
  const sin = Math.sin(orbit.yaw);
  const cos = Math.cos(orbit.yaw);
  focus.x += (cos * right - sin * forward) * distance;
  focus.z += (-sin * right - cos * forward) * distance;
}

/**
 * Either projection the scene can be drawn through. The game is orthographic
 * and the visual direction says so; the sim can be switched to perspective to
 * ask whether it should be, so everything downstream of the camera — the audio
 * listener, the spark sizing — takes the pair rather than the one.
 */
export type TabletopCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

/** The three-quarter orthographic view. Zoom and the orbit are its variables. */
export function createTabletopCamera(zoom = 1.35): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera();
  camera.position.copy(DEFAULT_EYE);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * The same view with a perspective divide. The default `fov` is the one that
 * frames exactly `VIEW_HEIGHT` at the default orbit radius, so switching a
 * still scene between the two projections leaves whatever is at the focus the
 * size it already was and changes only what depth does to everything else.
 */
export const DEFAULT_FOV = THREE.MathUtils.radToDeg(
  2 * Math.atan(VIEW_HEIGHT / 2 / DEFAULT_EYE.length()),
);

export function createPerspectiveCamera(zoom = 1.35, fov = DEFAULT_FOV): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 400);
  camera.position.copy(DEFAULT_EYE);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * How far back the eye must sit for `fov` to frame `VIEW_HEIGHT` at the focus.
 * A wider lens comes in closer for the same framing, which is the whole of what
 * makes one perspective view read as deeper than another.
 */
export function radiusForFov(fov: number, viewHeight = VIEW_HEIGHT): number {
  return viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
}

/**
 * World units visible from top to bottom of the frame, at `distance` from the
 * eye. Orthographic ignores the distance, which is the whole difference.
 */
export function viewSpan(camera: TabletopCamera, distance: number): number {
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(perspective.fov);
    return (2 * Math.tan(fov / 2) * distance) / perspective.zoom;
  }
  const orthographic = camera as THREE.OrthographicCamera;
  return (orthographic.top - orthographic.bottom) / orthographic.zoom;
}

/** Fits the frustum to the viewport and resizes the framebuffer. */
export function fitCameraToViewport(
  camera: TabletopCamera,
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  viewHeight = VIEW_HEIGHT,
): void {
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    // Vertical fov is fixed and the aspect widens, which is how the
    // orthographic view already behaves: height is the constant, width follows.
    (camera as THREE.PerspectiveCamera).aspect = width / height;
  } else {
    const orthographic = camera as THREE.OrthographicCamera;
    const viewWidth = viewHeight * (width / height);
    orthographic.left = -viewWidth / 2;
    orthographic.right = viewWidth / 2;
    orthographic.top = viewHeight / 2;
    orthographic.bottom = -viewHeight / 2;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
