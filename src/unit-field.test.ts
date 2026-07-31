import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./random";
import { createRigwalker, type Rigwalker } from "./rigwalker";
import { UnitField, unitField } from "./unit-field";

/**
 * The index is only worth having if it answers exactly what the loop it replaced
 * answered. Every test here is that claim: what `forEachNear` visits, checked
 * against reading the whole roster.
 */

function army(count: number, seed: number): Rigwalker[] {
  const random = createSeededRandom(seed);
  const units: Rigwalker[] = [];
  for (let n = 0; n < count; n += 1) {
    const unit = createRigwalker(
      null, 0xffffff, n % 2 ? "Helios" : "Vanguard", random,
      { role: n % 4 === 3 ? "hurler" : "melee" },
    );
    unit.group.position.set((random() - 0.5) * 60, 0.2, (random() - 0.5) * 60);
    units.push(unit);
  }
  return units;
}

/** Everything within `radius`, the way the loops used to find it. */
function bruteForce(
  units: readonly Rigwalker[], x: number, z: number, radius: number,
): Set<number> {
  const found = new Set<number>();
  for (const unit of units) {
    if (!unit.isAlive) continue;
    if (Math.hypot(unit.group.position.x - x, unit.group.position.z - z) <= radius) {
      found.add(unit.combatId);
    }
  }
  return found;
}

/** Everything within `radius` that the field offers, after the caller's own gap test. */
function throughField(
  field: UnitField, x: number, z: number, radius: number,
): Set<number> {
  const found = new Set<number>();
  field.forEachNear(x, z, radius, (unit) => {
    if (Math.hypot(unit.group.position.x - x, unit.group.position.z - z) <= radius) {
      found.add(unit.combatId);
    }
  });
  return found;
}

describe("UnitField", () => {
  it("finds exactly what reading the whole roster finds", () => {
    // Every radius the game actually queries with, and one well past a cell.
    const radii = [1.15, 1.25, 1.85, 2.05, 6];
    for (let seed = 1; seed <= 6; seed += 1) {
      const units = army(120, seed);
      const field = unitField(units);
      for (const unit of units) {
        for (const radius of radii) {
          const { x, z } = unit.group.position;
          expect(throughField(field, x, z, radius)).toEqual(bruteForce(units, x, z, radius));
        }
      }
    }
  });

  it("answers for a point standing between cells, not only for a body in one", () => {
    const units = army(80, 11);
    const field = unitField(units);
    const random = createSeededRandom(99);
    for (let probe = 0; probe < 200; probe += 1) {
      const x = (random() - 0.5) * 70;
      const z = (random() - 0.5) * 70;
      expect(throughField(field, x, z, 2.05)).toEqual(bruteForce(units, x, z, 2.05));
    }
  });

  it("stays exact when a body is re-filed after moving", () => {
    const units = army(60, 3);
    const field = unitField(units);
    const random = createSeededRandom(7);
    for (let step = 0; step < 40; step += 1) {
      // Further in one go than a frame of walking or a clearance shove, so a
      // body crosses cells rather than drifting inside one.
      for (const unit of units) {
        unit.group.position.x += (random() - 0.5) * 4;
        unit.group.position.z += (random() - 0.5) * 4;
        field.refile(unit);
      }
      for (const unit of units) {
        const { x, z } = unit.group.position;
        expect(throughField(field, x, z, 2.05)).toEqual(bruteForce(units, x, z, 2.05));
      }
    }
  });

  it("holds only the living, and forgets one that goes down", () => {
    const units = army(24, 5);
    const field = unitField(units);
    const casualty = units[9];
    expect(field.byCombatId(casualty.combatId)).toBe(casualty);
    expect(field.living).toHaveLength(24);

    casualty.applyCombatDamage(casualty.maxHealth, 1);
    expect(casualty.isAlive).toBe(false);
    field.refile(casualty);

    expect(field.byCombatId(casualty.combatId)).toBeNull();
    expect(field.living).toHaveLength(23);
    expect(field.living).not.toContain(casualty);
    const { x, z } = casualty.group.position;
    expect(throughField(field, x, z, 3)).toEqual(bruteForce(units, x, z, 3));
  });

  it("leaves the dead out of a rebuild", () => {
    const units = army(24, 8);
    units[2].applyCombatDamage(units[2].maxHealth, 1);
    units[17].applyCombatDamage(units[17].maxHealth, 1);
    const field = unitField(units);
    expect(field.living).toHaveLength(22);
    expect(field.byCombatId(units[2].combatId)).toBeNull();
  });

  it("reuses its cell arrays across rebuilds rather than growing", () => {
    const units = army(90, 13);
    const field = new UnitField();
    field.rebuild(units);
    const first = new Set<number>();
    field.forEachNear(0, 0, 200, (unit) => first.add(unit.combatId));
    for (let frame = 0; frame < 20; frame += 1) field.rebuild(units);
    const later = new Set<number>();
    field.forEachNear(0, 0, 200, (unit) => later.add(unit.combatId));
    // A rebuild that emptied its buckets properly holds each body exactly once,
    // so the count is the roster and not twenty times it.
    expect(later.size).toBe(90);
    expect(later).toEqual(first);
    let visits = 0;
    field.forEachNear(0, 0, 200, () => { visits += 1; });
    expect(visits).toBe(90);
  });
});
