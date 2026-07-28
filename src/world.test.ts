import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOV,
  VIEW_HEIGHT,
  createCameraOrbit,
  createPerspectiveCamera,
  createTabletopCamera,
  orbitBy,
  orbitOffset,
  panFocus,
  radiusForFov,
  viewSpan,
} from "./world";

describe("camera orbit", () => {
  it("starts on the three-quarter view the camera has always used", () => {
    const offset = orbitOffset(createCameraOrbit(), new THREE.Vector3());
    expect(offset.x).toBeCloseTo(36);
    expect(offset.y).toBeCloseTo(42);
    expect(offset.z).toBeCloseTo(36);
    expect(offset.distanceTo(createTabletopCamera().position)).toBeCloseTo(0);
  });

  it("swings round the focus without changing how far away it is", () => {
    const orbit = createCameraOrbit();
    const start = orbitOffset(orbit, new THREE.Vector3());
    orbitBy(orbit, Math.PI / 2, 0);
    const turned = orbitOffset(orbit, new THREE.Vector3());
    expect(turned.length()).toBeCloseTo(start.length());
    expect(turned.y).toBeCloseTo(start.y);
    // A quarter turn about the vertical: what was north is now east.
    expect(turned.x).toBeCloseTo(start.z);
    expect(turned.z).toBeCloseTo(-start.x);
  });

  it("keeps the elevation off the ground and out of the vertical", () => {
    const orbit = createCameraOrbit();
    orbitBy(orbit, 0, -Math.PI);
    expect(orbitOffset(orbit, new THREE.Vector3()).y).toBeGreaterThan(0);
    orbitBy(orbit, 0, Math.PI);
    const overhead = orbitOffset(orbit, new THREE.Vector3());
    expect(overhead.y).toBeGreaterThan(0);
    expect(Math.hypot(overhead.x, overhead.z)).toBeGreaterThan(0.5);
  });

  it("pans in the camera's frame, so forward always runs away from the eye", () => {
    const orbit = createCameraOrbit();
    for (const turn of [0, 1, 2.5, -0.7]) {
      orbitBy(orbit, turn, 0);
      const eye = orbitOffset(orbit, new THREE.Vector3());
      const focus = new THREE.Vector3();
      panFocus(orbit, focus, 1, 0, 5);
      expect(focus.length()).toBeCloseTo(5);
      // Moving forward moves the focus directly away from the eye on the ground.
      expect(focus.x).toBeCloseTo((-eye.x / Math.hypot(eye.x, eye.z)) * 5);
      expect(focus.z).toBeCloseTo((-eye.z / Math.hypot(eye.x, eye.z)) * 5);

      // Right is a quarter turn clockwise from forward, seen from above.
      const right = new THREE.Vector3();
      panFocus(orbit, right, 0, 1, 5);
      expect(right.dot(focus)).toBeCloseTo(0);
      expect(focus.x * right.z - focus.z * right.x).toBeGreaterThan(0);
    }
  });
});

/** Screen height in pixels of a thing `metres` tall standing `z` from the focus. */
function screenHeight(
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  z: number,
  metres: number,
  pixels: number,
): number {
  camera.updateMatrixWorld(true);
  const foot = new THREE.Vector3(0, 0, z).project(camera);
  const head = new THREE.Vector3(0, metres, z).project(camera);
  return Math.abs(head.y - foot.y) * 0.5 * pixels;
}

describe("projection", () => {
  const pixels = 860;

  function aim(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera): void {
    const orbit = createCameraOrbit();
    orbit.radius = radiusForFov(DEFAULT_FOV);
    camera.position.copy(orbitOffset(orbit, new THREE.Vector3()));
    camera.lookAt(0, 0, 0);
  }

  it("draws a thing the same size at every distance when orthographic", () => {
    const camera = createTabletopCamera(1);
    camera.top = VIEW_HEIGHT / 2;
    camera.bottom = -VIEW_HEIGHT / 2;
    camera.updateProjectionMatrix();
    aim(camera);
    const near = screenHeight(camera, -20, 2, pixels);
    expect(screenHeight(camera, 20, 2, pixels)).toBeCloseTo(near, 4);
  });

  it("shrinks a thing with distance when perspective", () => {
    const camera = createPerspectiveCamera(1);
    camera.aspect = 1280 / pixels;
    camera.updateProjectionMatrix();
    aim(camera);
    // Positive z is toward the eye at the default yaw, so -20 is further away.
    expect(screenHeight(camera, -20, 2, pixels))
      .toBeLessThan(screenHeight(camera, 20, 2, pixels));
  });

  it("frames the same thing at the focus through either projection", () => {
    const orthographic = createTabletopCamera(1);
    orthographic.top = VIEW_HEIGHT / 2;
    orthographic.bottom = -VIEW_HEIGHT / 2;
    orthographic.updateProjectionMatrix();
    aim(orthographic);

    const perspective = createPerspectiveCamera(1);
    perspective.aspect = 1280 / pixels;
    perspective.updateProjectionMatrix();
    aim(perspective);

    // The default fov is chosen for exactly this: at the focus distance both
    // frames hold the same span of world, whatever the distance is asked of it.
    expect(viewSpan(perspective, perspective.position.length())).toBeCloseTo(VIEW_HEIGHT, 4);
    expect(viewSpan(orthographic, 999)).toBeCloseTo(VIEW_HEIGHT, 4);

    // A body standing at the focus is within a couple of percent of the size it
    // was, not identical: the camera looks down on it, so its head is nearer
    // the eye than its feet and perspective magnifies the head. That residue is
    // the effect being asked about, so the test states it rather than hides it.
    const before = screenHeight(orthographic, 0, 2, pixels);
    const after = screenHeight(perspective, 0, 2, pixels);
    expect(Math.abs(after - before) / before).toBeLessThan(0.03);
  });

  it("brings a wider lens closer so it frames the same thing", () => {
    expect(radiusForFov(DEFAULT_FOV)).toBeCloseTo(createTabletopCamera().position.length(), 4);
    expect(radiusForFov(70)).toBeLessThan(radiusForFov(DEFAULT_FOV));
  });
});
