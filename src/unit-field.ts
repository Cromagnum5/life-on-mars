import type { Rigwalker } from "./rigwalker";

/**
 * Where every living body is standing, indexed so a fighter can ask what is
 * beside it without reading the whole army.
 *
 * ## What was wrong
 *
 * Three of the things a Rigwalker does every frame walked the entire roster:
 * the separation drift, the clearance push, and finding the unit its combat cue
 * names. Each is a loop over `nearbyUnits`, and `nearbyUnits` was the roster. At
 * two a side that is nothing. At a hundred and twenty-eight a side it is
 * sixty-five thousand pairs a frame, three times over, and it measured like it:
 *
 * | bodies | `ai` | `physics` |
 * | --- | --- | --- |
 * | 64 | 0.25 ms | 1.3 ms |
 * | 128 | 0.58 ms | 5.7 ms |
 * | 256 | 3.0 ms | **38.0 ms** |
 *
 * Thirty-eight milliseconds is a sixty-hertz frame spent twice before anything
 * is drawn, and the shape of it is the giveaway: four times the pairs cost six
 * and a half times the milliseconds, because the roster stopped fitting in
 * cache. Nothing about a fight is quadratic. Two bodies thirty metres apart do
 * not push on each other, and the loop asked anyway.
 *
 * ## What this is
 *
 * A uniform grid, rebuilt once a frame. Every living body is filed under the
 * cell it stands in, and `forEachNear` visits only the cells a query circle
 * touches. Bodies pack about a clearance apart, so a cell holds two or three of
 * them and a separation query reads a dozen candidates rather than the army.
 *
 * ## Why it stays exact
 *
 * A grid is normally approximate because bodies move after it is built. This one
 * is not, and the reason is the order the frame runs in. `BattleRuntime` updates
 * units one at a time; a unit that has not been updated yet has not moved, so
 * the cell it was filed in is still the cell it is standing in, and a unit that
 * has been updated re-files itself on the way out. Every lookup therefore sees
 * live positions. That is worth the `refile` call: without it the index would
 * have to be padded against a frame's worth of drift, and a clearance push in a
 * dense crowd can be most of a metre.
 */

/**
 * How much ground a cell covers.
 *
 * The largest query anything makes is `COMBAT_SEPARATION_RADIUS`, 2.05 m, so a
 * cell a little wider than that is the balance point: smaller and a query walks
 * more cells than it saves in candidates, larger and it reads bodies too far off
 * to matter. `forEachNear` covers whatever circle it is given regardless, so
 * this is a tuning number and not a correctness one.
 */
const CELL_SIZE = 2.6;

/**
 * Packs a cell's coordinates into one number. Unique while a body stays within
 * about ten kilometres of the origin; the arena is a hundred and twelve metres
 * across, so this is not a limit anything can reach.
 */
function cellKey(cellX: number, cellZ: number): number {
  return cellX * 8192 + cellZ;
}

export class UnitField {
  private readonly cells = new Map<number, Rigwalker[]>();
  /** The cell each body is currently filed under, so it can be moved out of it. */
  private readonly filed = new Map<Rigwalker, number>();
  private readonly byId = new Map<number, Rigwalker>();
  private readonly alive: Rigwalker[] = [];

  /** Every living body, for the few questions that are genuinely about all of them. */
  get living(): readonly Rigwalker[] {
    return this.alive;
  }

  /**
   * Files this frame's roster. The cell arrays are emptied rather than dropped,
   * so a fight that has been running a while allocates nothing here.
   */
  rebuild(units: readonly Rigwalker[]): void {
    for (const bucket of this.cells.values()) bucket.length = 0;
    this.filed.clear();
    this.byId.clear();
    this.alive.length = 0;
    for (const unit of units) {
      if (!unit.isAlive) continue;
      this.alive.push(unit);
      this.byId.set(unit.combatId, unit);
      const key = this.keyAt(unit);
      this.bucket(key).push(unit);
      this.filed.set(unit, key);
    }
  }

  /**
   * Moves a body that has just finished its update into the cell it now stands
   * in, and drops one that died on the way. Cheap: a cell holds a handful of
   * bodies, and most frames a body has not crossed a cell edge at all.
   */
  refile(unit: Rigwalker): void {
    const previous = this.filed.get(unit);
    if (previous === undefined) return;
    if (!unit.isAlive) {
      this.remove(previous, unit);
      this.filed.delete(unit);
      this.byId.delete(unit.combatId);
      const index = this.alive.indexOf(unit);
      if (index >= 0) this.alive.splice(index, 1);
      return;
    }
    const key = this.keyAt(unit);
    if (key === previous) return;
    this.remove(previous, unit);
    this.bucket(key).push(unit);
    this.filed.set(unit, key);
  }

  /** The living body a combat cue names, or null once it is down. */
  byCombatId(combatId: number): Rigwalker | null {
    return this.byId.get(combatId) ?? null;
  }

  /**
   * Visits every living body whose cell the circle touches. Candidates outside
   * `radius` are still handed over — the caller is measuring the gap anyway, and
   * a second distance test here would only do the same work twice.
   */
  forEachNear(
    x: number, z: number, radius: number, visit: (unit: Rigwalker) => void,
  ): void {
    const minX = Math.floor((x - radius) / CELL_SIZE);
    const maxX = Math.floor((x + radius) / CELL_SIZE);
    const minZ = Math.floor((z - radius) / CELL_SIZE);
    const maxZ = Math.floor((z + radius) / CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        const bucket = this.cells.get(cellKey(cellX, cellZ));
        if (!bucket) continue;
        for (const unit of bucket) visit(unit);
      }
    }
  }

  private keyAt(unit: Rigwalker): number {
    return cellKey(
      Math.floor(unit.group.position.x / CELL_SIZE),
      Math.floor(unit.group.position.z / CELL_SIZE),
    );
  }

  private bucket(key: number): Rigwalker[] {
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    return bucket;
  }

  private remove(key: number, unit: Rigwalker): void {
    const bucket = this.cells.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(unit);
    if (index >= 0) bucket.splice(index, 1);
  }
}

/** A field holding just these units. For callers that stage a handful by hand. */
export function unitField(units: readonly Rigwalker[]): UnitField {
  const field = new UnitField();
  field.rebuild(units);
  return field;
}
