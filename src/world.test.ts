import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createCameraOrbit,
  createTabletopCamera,
  orbitBy,
  orbitOffset,
  panFocus,
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
