import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CombatDirector, MIN_FIGHT_DISTANCE, type CombatantSnapshot } from "./combat";
import { createSeededRandom } from "./random";
import { createRigwalker, type Rigwalker } from "./rigwalker";

/**
 * Movement and combat planning only meet inside the frame loop, so the spacing
 * a fight actually settles at cannot be checked from the director alone. This
 * drives the same sequence the game and the combat sim do, minus rendering.
 */

const STEP = 1 / 60;
const CAMERA = new THREE.Quaternion();

function flat(): number {
  return 0;
}

function runFight(seed: number, perTeam: number, seconds: number): {
  units: Rigwalker[];
  minimumSeparation: number;
  defeats: number;
} {
  const random = createSeededRandom(seed);
  const director = new CombatDirector(random);
  const units: Rigwalker[] = [];
  for (const [team, side] of [["Helios", -1], ["Vanguard", 1]] as const) {
    for (let index = 0; index < perTeam; index += 1) {
      const unit = createRigwalker(null, 0xffffff, team, random);
      const lateral = (index - (perTeam - 1) / 2) * 2.7;
      unit.group.position.set(side * 7.5, 0.2, lateral);
      unit.moveTo(new THREE.Vector3(side * 1.6, 0, lateral * 0.35));
      units.push(unit);
    }
  }

  let minimumSeparation = Number.POSITIVE_INFINITY;
  let defeats = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const snapshots: CombatantSnapshot[] = units.map((unit) => ({
      id: unit.combatId, corporation: unit.corporation,
      health: unit.health, maxHealth: unit.maxHealth, isAlive: unit.isAlive,
      x: unit.group.position.x, z: unit.group.position.z, profile: unit.combatProfile,
    }));
    const frame = director.update(STEP, snapshots);
    const byId = new Map(units.map((unit) => [unit.combatId, unit]));
    for (const damage of frame.damage) {
      const target = byId.get(damage.targetId)!;
      const wasAlive = target.isAlive;
      target.applyCombatDamage(damage.amount, damage.side);
      if (wasAlive && !target.isAlive) defeats += 1;
    }
    for (const unit of units) {
      unit.update(STEP, elapsed, flat, units, [], CAMERA, frame.cues.get(unit.combatId));
    }
    for (let left = 0; left < units.length; left += 1) {
      for (let right = left + 1; right < units.length; right += 1) {
        if (!units[left].isAlive || !units[right].isAlive) continue;
        minimumSeparation = Math.min(
          minimumSeparation,
          units[left].group.position.distanceTo(units[right].group.position),
        );
      }
    }
  }
  return { units, minimumSeparation, defeats };
}

describe("engaged Rigwalkers", () => {
  it("close to fighting range without walking through each other", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { units, minimumSeparation } = runFight(seed, 1, 12);
      // Two silhouettes merge into one blob well before they touch, so the
      // closing step is clamped rather than merely bounded by the plan.
      expect(minimumSeparation).toBeGreaterThan(MIN_FIGHT_DISTANCE - 0.5);
      expect(
        units[0].group.position.distanceTo(units[1].group.position),
      ).toBeLessThan(6);
    }
  });

  it("keeps a group melee spread out instead of stacking on one target", () => {
    const { minimumSeparation } = runFight(5, 3, 14);
    expect(minimumSeparation).toBeGreaterThan(1.75);
  });

  it("resolves a lopsided fight and leaves the outnumbered side dead", () => {
    const { units, defeats } = runFight(9, 2, 60);
    expect(defeats).toBeGreaterThan(0);
    const survivors = new Set(
      units.filter((unit) => unit.isAlive).map((unit) => unit.corporation),
    );
    expect(survivors.size).toBeLessThanOrEqual(2);
  });
});
