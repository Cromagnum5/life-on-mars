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

/**
 * Drives the units through the director for a while and reports what the frame
 * loop did with them: how close they ever came to each other, how many went
 * down, and how far the survivors were still walking at the end.
 */
function drive(seed: number, units: Rigwalker[], seconds: number): {
  units: Rigwalker[];
  minimumSeparation: number;
  defeats: number;
  finalSecondWalk: number;
} {
  const director = new CombatDirector(createSeededRandom(seed));
  const previous = units.map((unit) => unit.group.position.clone());
  let minimumSeparation = Number.POSITIVE_INFINITY;
  let defeats = 0;
  let finalSecondWalk = 0;
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
    units.forEach((unit, index) => {
      if (unit.isAlive && elapsed > seconds - 1) {
        finalSecondWalk += unit.group.position.distanceTo(previous[index]);
      }
      previous[index].copy(unit.group.position);
    });
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
  return { units, minimumSeparation, defeats, finalSecondWalk };
}

function runFight(seed: number, perTeam: number, seconds: number) {
  const random = createSeededRandom(seed);
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
  return drive(seed, units, seconds);
}

/** One corporation, walking in from all sides to a single waypoint. */
function runMarch(seed: number, count: number, seconds: number) {
  const random = createSeededRandom(seed);
  const waypoint = new THREE.Vector3(0, 0, 0);
  const units: Rigwalker[] = [];
  for (let index = 0; index < count; index += 1) {
    const unit = createRigwalker(null, 0xffffff, "Helios", random);
    // The golden angle, so the ring they start on is not a tidy polygon.
    const angle = index * 2.399;
    unit.group.position.set(Math.cos(angle) * 9, 0.2, Math.sin(angle) * 9);
    unit.moveTo(waypoint);
    units.push(unit);
  }
  return { waypoint, ...drive(seed, units, seconds) };
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

  it("stands the survivors still once the fighting is over", () => {
    // Reported from play: after a fight, units walking back to where they were
    // sent kept shoving at each other and never stood up straight again. Each
    // side here is sent to one point, the way a building sends everything it
    // makes to its own rally point, and a fight happens on the way.
    for (const seed of [1, 4, 7, 11]) {
      const random = createSeededRandom(seed);
      const units: Rigwalker[] = [];
      for (const [team, side] of [["Helios", -1], ["Vanguard", 1]] as const) {
        const rally = new THREE.Vector3(side * 2.4, 0, 3);
        for (let index = 0; index < 3; index += 1) {
          const unit = createRigwalker(null, 0xffffff, team, random);
          unit.group.position.set(side * 7.5, 0.2, (index - 1) * 2.7);
          unit.moveTo(rally);
          units.push(unit);
        }
      }
      const { finalSecondWalk, defeats } = drive(seed, units, 90);
      expect(defeats).toBeGreaterThan(0);
      expect(finalSecondWalk).toBeLessThan(0.05);
    }
  });
});

describe("Rigwalkers sent to one waypoint", () => {
  it("settle rather than press into the point forever", () => {
    // A waypoint is a point and a crowd cannot stand on one, so arrival has to
    // mean the ground is taken rather than the point is reached.
    for (const count of [2, 6, 20]) {
      const { units, waypoint, finalSecondWalk, minimumSeparation } =
        runMarch(3, count, 30);
      expect(finalSecondWalk).toBeLessThan(0.05);
      // They stop where they got to, not short of the walk entirely.
      const nearest = Math.min(
        ...units.map((unit) => unit.group.position.distanceTo(waypoint)),
      );
      expect(nearest).toBeLessThan(1);
      expect(minimumSeparation).toBeGreaterThan(1);
    }
  });

  it("still walks the whole way when only a few are ahead of it", () => {
    // The failure this guards against is the opposite one: a batch converging
    // on a rally point funnels, and a moment's lost ground with a neighbour
    // alongside is not a crowd. Reading it as one stopped units a walk short.
    const { units, waypoint } = runMarch(3, 3, 6);
    for (const unit of units) {
      expect(unit.group.position.distanceTo(waypoint)).toBeLessThan(2.6);
    }
  });
});
