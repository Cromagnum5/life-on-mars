import { describe, expect, it } from "vitest";
import { BUILDING_OBSTACLES, createBuildings } from "./buildings";

/**
 * A base is laid out by hand, and the cost of a badly placed site is not a
 * crash: it is two footprints overlapping, or a batch materialising inside a
 * neighbour's footprint and being shoved out of it on its first frame. Both
 * read as a jam rather than as a mistake, so they are pinned here.
 */

const bases = createBuildings(() => 0);
const producers = bases.flatMap((base) => [base.assemblyBay, base.stoneworks]);
/** The margin unit orders are pushed out to, from `clearBuildingFootprints`. */
const CLEARANCE = 0.8;

describe("corporate bases", () => {
  it("gives every corporation a bay and a stoneworks", () => {
    expect(producers).toHaveLength(4);
    expect(producers.map((producer) => producer.label)).toEqual([
      "Assembly Bay", "Stoneworks", "Assembly Bay", "Stoneworks",
    ]);
  });

  it("keeps building footprints clear of each other", () => {
    for (const [index, obstacle] of BUILDING_OBSTACLES.entries()) {
      for (const other of BUILDING_OBSTACLES.slice(index + 1)) {
        expect(obstacle.center.distanceTo(other.center)).toBeGreaterThan(
          obstacle.radius + other.radius + CLEARANCE,
        );
      }
    }
  });

  it("stands each batch clear of every footprint but its own building's", () => {
    // A door sits inside its own building's circle by design — the batch walks
    // out through it — but standing one inside a *neighbour's* is a jam.
    for (const producer of producers) {
      const own = BUILDING_OBSTACLES.map((obstacle) =>
        producer.spawnPosition.distanceTo(obstacle.center) - obstacle.radius,
      ).sort((first, second) => first - second);
      expect(own[1]).toBeGreaterThan(CLEARANCE);
    }
  });
});
