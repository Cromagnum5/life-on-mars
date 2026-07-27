import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AssemblyBayProduction } from "./production";
import type { Rigwalker } from "./rigwalker";

/**
 * The Assembly Bay is a timer with a door on it, and what comes through the
 * door is a repeating order rather than one unit. Both halves are worth
 * pinning: a cadence that drifts and a mix that quietly stops alternating
 * both look like nothing at all until a fight is already lopsided.
 */

const STEP = 1 / 60;

function flat(): number {
  return 0;
}

/** Runs a bay for a while and reports what came out, in order. */
function runBay(seconds: number): { units: Rigwalker[]; roles: string[] } {
  const scene = new THREE.Scene();
  const door = new THREE.Group();
  door.position.set(0, 2.25, 3.54);
  scene.add(door);
  const units: Rigwalker[] = [];
  const production = new AssemblyBayProduction(
    scene, door, units, flat, null,
    new THREE.Vector2(10, -1.8), new THREE.Vector3(0, 0, 0), 0xffffff, "Helios",
  );
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

describe("assembly bay production", () => {
  it("alternates a pair of swords with a single hurler", () => {
    const { roles } = runBay(140);
    expect(roles.length).toBeGreaterThanOrEqual(9);
    // Two, then one, then two, then one: read back as batches rather than as a
    // flat list, because that is the shape the order is written in.
    const expected = ["melee", "melee", "hurler"];
    roles.forEach((role, index) => {
      expect(role).toBe(expected[index % expected.length]);
    });
  });

  it("opens the door about every twenty seconds", () => {
    // Counted in units rather than openings, because the batches are uneven:
    // three openings is a pair, a hurler and a pair, which is five units.
    expect(runBay(CYCLE_SECONDS * 3 + 1).units).toHaveLength(5);
    expect(runBay(CYCLE_SECONDS * 4 + 1).units).toHaveLength(6);
    // Nothing arrives before the first cycle is up, and the swing is real:
    // twenty seconds in, the door is still opening.
    expect(runBay(20).units).toHaveLength(0);
    expect(runBay(CYCLE_SECONDS - 0.1).units).toHaveLength(0);
  });

  it("walks a pair clear of the door instead of jamming it", () => {
    // The risk in spawning two at once is the pair shoving each other on the
    // doorstep and neither getting anywhere, so this runs them.
    const { units } = runBay(30);
    expect(units).toHaveLength(2);
    const rally = new THREE.Vector3(0, 0, 0);
    const start = units.map((unit) => unit.group.position.distanceTo(rally));
    let closest = Number.POSITIVE_INFINITY;
    for (let elapsed = 0; elapsed < 4; elapsed += STEP) {
      for (const unit of units) {
        unit.update(STEP, elapsed, flat, units, [], new THREE.Quaternion());
      }
      closest = Math.min(closest, units[0].group.position.distanceTo(units[1].group.position));
    }
    units.forEach((unit, index) => {
      expect(unit.group.position.distanceTo(rally)).toBeLessThan(start[index] - 2);
    });
    expect(closest).toBeGreaterThan(1);
  });

  it("stands a pair abreast rather than on top of each other", () => {
    const { units } = runBay(30);
    expect(units).toHaveLength(2);
    const [left, right] = units;
    const gap = left.group.position.distanceTo(right.group.position);
    // Far enough apart not to be shoving on the doorstep, close enough to read
    // as one pair leaving together.
    expect(gap).toBeGreaterThan(1.25);
    expect(gap).toBeLessThan(2.5);
    // Abreast means across the walk, not one in front of the other: both start
    // the same distance from where they are headed.
    const rally = new THREE.Vector3(0, 0, 0);
    expect(left.group.position.distanceTo(rally))
      .toBeCloseTo(right.group.position.distanceTo(rally), 5);
  });
});
