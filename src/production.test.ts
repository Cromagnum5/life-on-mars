import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BuildingProduction,
  HURLER_ORDER,
  SWORD_ORDER,
  type ProductionOrder,
} from "./production";
import type { Rigwalker } from "./rigwalker";

/**
 * A producing building is a timer with a door on it, and what comes through
 * the door is a repeating order rather than one unit. Both halves are worth
 * pinning: a cadence that drifts and a mix that quietly stops matching its
 * building both look like nothing at all until a fight is already lopsided.
 */

const STEP = 1 / 60;

function flat(): number {
  return 0;
}

/** The tightest space between any two of them, which is where jamming shows. */
function narrowestGap(units: Rigwalker[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (const [index, unit] of units.entries()) {
    for (const other of units.slice(index + 1)) {
      closest = Math.min(closest, unit.group.position.distanceTo(other.group.position));
    }
  }
  return closest;
}

/** Runs one building for a while and reports what came out, in order. */
function runBuilding(
  seconds: number,
  order: ProductionOrder = SWORD_ORDER,
): { units: Rigwalker[]; roles: string[] } {
  const scene = new THREE.Scene();
  const door = new THREE.Group();
  door.position.set(0, 2.25, 3.54);
  scene.add(door);
  const units: Rigwalker[] = [];
  const production = new BuildingProduction({
    scene, door, units, terrainHeightAt: flat, rigwalkerAsset: null,
    spawnPosition: new THREE.Vector2(10, -1.8),
    rallyPoint: new THREE.Vector3(0, 0, 0),
    accent: 0xffffff, corporation: "Helios", order,
  });
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    production.update(STEP);
  }
  return { units, roles: units.map((unit) => unit.role) };
}

/**
 * One batch every twenty seconds plus the door's opening swing. Only the swing
 * is on top: the bay counts the exit and the door closing again against the
 * next twenty, so those do not stack up over a match.
 */
const CYCLE_SECONDS = 20 + 1 / 1.4;

describe("building production", () => {
  it("sends three swords out of the Assembly Bay every opening", () => {
    const { roles } = runBuilding(140, SWORD_ORDER);
    expect(roles.length).toBeGreaterThanOrEqual(12);
    expect(roles.every((role) => role === "melee")).toBe(true);
    expect(roles.length % 3).toBe(0);
  });

  it("sends one hurler out of the Stoneworks every opening", () => {
    // The mix the game fields is now two buildings running side by side rather
    // than one door alternating, so the ratio is only right if the Stoneworks
    // turns out exactly one rock-thrower per opening of its own.
    const { roles } = runBuilding(140, HURLER_ORDER);
    expect(roles.length).toBeGreaterThanOrEqual(4);
    expect(roles.every((role) => role === "hurler")).toBe(true);
    expect(roles).toHaveLength(runBuilding(140, SWORD_ORDER).roles.length / 3);
  });

  it("opens the door about every twenty seconds", () => {
    expect(runBuilding(CYCLE_SECONDS * 3 + 1, HURLER_ORDER).units).toHaveLength(3);
    expect(runBuilding(CYCLE_SECONDS * 4 + 1, HURLER_ORDER).units).toHaveLength(4);
    expect(runBuilding(CYCLE_SECONDS * 3 + 1, SWORD_ORDER).units).toHaveLength(9);
    // Nothing arrives before the first cycle is up, and the swing is real:
    // twenty seconds in, the door is still opening.
    expect(runBuilding(20).units).toHaveLength(0);
    expect(runBuilding(CYCLE_SECONDS - 0.1).units).toHaveLength(0);
  });

  it("walks a trio clear of the door instead of jamming it", () => {
    // The risk in spawning three at once is the batch shoving itself apart on
    // the doorstep and nobody getting anywhere, so this runs them.
    const { units } = runBuilding(30);
    expect(units).toHaveLength(3);
    const rally = new THREE.Vector3(0, 0, 0);
    const start = units.map((unit) => unit.group.position.distanceTo(rally));
    let closest = Number.POSITIVE_INFINITY;
    for (let elapsed = 0; elapsed < 4; elapsed += STEP) {
      for (const unit of units) {
        unit.update(STEP, elapsed, flat, units, [], new THREE.Quaternion());
      }
      closest = Math.min(closest, narrowestGap(units));
    }
    units.forEach((unit, index) => {
      expect(unit.group.position.distanceTo(rally)).toBeLessThan(start[index] - 2);
    });
    expect(closest).toBeGreaterThan(1);
  });

  it("stands a trio abreast rather than on top of each other", () => {
    const { units } = runBuilding(30);
    expect(units).toHaveLength(3);
    const gap = narrowestGap(units);
    // Far enough apart not to be shoving on the doorstep, close enough to read
    // as one batch leaving together.
    expect(gap).toBeGreaterThan(1.25);
    expect(gap).toBeLessThan(2.5);
    // Abreast means across the walk, not one behind the other: measured along
    // the way they are headed, all three stand on the same line. Straight-line
    // distance to the rally point would not say this — the middle of a row of
    // three is nearer to it than the ends are, while still being abreast.
    const forward = new THREE.Vector2(0 - 10, 0 - -1.8).normalize();
    const along = units.map(
      (unit) => forward.x * unit.group.position.x + forward.y * unit.group.position.z,
    );
    for (const distance of along.slice(1)) {
      expect(distance).toBeCloseTo(along[0], 5);
    }
  });
});
