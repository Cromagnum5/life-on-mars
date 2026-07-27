import * as THREE from "three";
import { createRigwalker, type Rigwalker } from "./rigwalker";
import type { CombatRole } from "./combat";
import type { RigwalkerAsset } from "./rigwalker-assets";

const PRODUCTION_SECONDS = 20;
/** What comes out of a door, one entry per opening, repeating. */
export type ProductionOrder = readonly (readonly CombatRole[])[];
/** The Assembly Bay's: three swords abreast, every opening. */
export const SWORD_ORDER: ProductionOrder = [["melee", "melee", "melee"]];
/**
 * The Stoneworks': one Hurler, every opening. The mix that used to alternate
 * out of a single door now comes out of two doors at once, so the swords are
 * still three to a rock and no longer arrive a cycle apart from it.
 */
export const HURLER_ORDER: ProductionOrder = [["hurler"]];
/**
 * How far apart a batch stands as it comes out, across the line it walks. Wider
 * than the separation radius, so a batch is not shoving itself apart on the
 * doorstep, and three abreast is 3 m of it — well inside the 5.5 m door.
 */
const ABREAST_SPACING = 1.5;
const DOOR_SPEED = 1.4;
const DOOR_HEIGHT = 2.9;
const OPEN_DOOR_SCALE = 0.12;
const EXIT_SECONDS = 2.2;

type ProductionPhase = "producing" | "opening" | "exiting" | "closing";

export type ProductionStatus = {
  label: "Fabricating" | "Deploying";
  progress: number;
  secondsRemaining: number;
};

export type ProductionOptions = {
  scene: THREE.Scene;
  door: THREE.Group;
  units: Rigwalker[];
  terrainHeightAt: (x: number, z: number) => number;
  rigwalkerAsset: RigwalkerAsset | null;
  spawnPosition: THREE.Vector2;
  rallyPoint: THREE.Vector3;
  accent: number;
  corporation: string;
  order: ProductionOrder;
};

/** One building's timer, door, and repeating order of what walks out of it. */
export class BuildingProduction {
  readonly units: Rigwalker[];

  private readonly scene: THREE.Scene;
  private readonly door: THREE.Group;
  private readonly terrainHeightAt: (x: number, z: number) => number;
  private readonly closedDoorY: number;
  private readonly rigwalkerAsset: RigwalkerAsset | null;
  private readonly spawnPosition: THREE.Vector2;
  private readonly rallyPoint: THREE.Vector3;
  private readonly accent: number;
  private readonly corporation: string;
  private readonly order: ProductionOrder;
  private batch = 0;
  private phase: ProductionPhase = "producing";
  private productionElapsed = 0;
  private phaseElapsed = 0;
  private doorOpen = 0;

  constructor(options: ProductionOptions) {
    this.scene = options.scene;
    this.door = options.door;
    this.units = options.units;
    this.terrainHeightAt = options.terrainHeightAt;
    this.rigwalkerAsset = options.rigwalkerAsset;
    this.spawnPosition = options.spawnPosition;
    this.rallyPoint = options.rallyPoint;
    this.accent = options.accent;
    this.corporation = options.corporation;
    this.order = options.order;
    this.closedDoorY = options.door.position.y;
  }

  update(delta: number): void {
    this.phaseElapsed += delta;

    if (this.phase === "producing") {
      this.productionElapsed += delta;
      if (this.productionElapsed >= PRODUCTION_SECONDS) {
        this.phase = "opening";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.phase === "opening") {
      this.doorOpen = Math.min(1, this.doorOpen + DOOR_SPEED * delta);
      this.applyDoorPose();
      if (this.doorOpen >= 1) {
        this.spawnBatch();
        this.phase = "exiting";
        this.phaseElapsed = 0;
        this.productionElapsed = 0;
      }
      return;
    }

    this.productionElapsed += delta;

    if (this.phase === "exiting") {
      if (this.phaseElapsed >= EXIT_SECONDS) {
        this.phase = "closing";
        this.phaseElapsed = 0;
      }
      return;
    }

    this.doorOpen = Math.max(0, this.doorOpen - DOOR_SPEED * delta);
    this.applyDoorPose();
    if (this.doorOpen <= 0) {
      this.phase = "producing";
      this.phaseElapsed = 0;
    }
  }

  getStatus(): ProductionStatus {
    return {
      label: this.phase === "producing" ? "Fabricating" : "Deploying",
      progress:
        this.phase === "producing"
          ? Math.min(1, this.productionElapsed / PRODUCTION_SECONDS)
          : 1,
      secondsRemaining: Math.max(
        0,
        Math.ceil(PRODUCTION_SECONDS - this.productionElapsed),
      ),
    };
  }

  setRallyPoint(position: THREE.Vector3): void {
    this.rallyPoint.copy(position);
  }

  private applyDoorPose(): void {
    const scale = THREE.MathUtils.lerp(1, OPEN_DOOR_SCALE, this.doorOpen);
    this.door.scale.y = scale;
    this.door.position.y =
      this.closedDoorY + (DOOR_HEIGHT / 2) * (1 - scale);
  }

  /** Everything this opening of the door is for: one entry of the order. */
  private spawnBatch(): void {
    const roles = this.order[this.batch % this.order.length];
    this.batch += 1;
    // Abreast of each other rather than stacked, laid out across the way they
    // are about to walk, so a batch comes out of the bay together.
    const across = this.exitLine();
    for (const [index, role] of roles.entries()) {
      const offset = (index - (roles.length - 1) / 2) * ABREAST_SPACING;
      const x = this.spawnPosition.x + across.x * offset;
      const z = this.spawnPosition.y + across.y * offset;
      const rigwalker = createRigwalker(
        this.rigwalkerAsset, this.accent, this.corporation, Math.random, { role },
      );
      rigwalker.group.position.set(x, this.terrainHeightAt(x, z) + 0.2, z);
      rigwalker.moveTo(this.rallyPoint);
      this.units.push(rigwalker);
      this.scene.add(rigwalker.group);
    }
  }

  /**
   * The direction across the walk out of the door, on the ground plane. A rally
   * point sitting on the spawn leaves nothing to be across of, so that falls
   * back to world X rather than dividing by zero.
   */
  private exitLine(): THREE.Vector2 {
    const forward = new THREE.Vector2(
      this.rallyPoint.x - this.spawnPosition.x,
      this.rallyPoint.z - this.spawnPosition.y,
    );
    if (forward.lengthSq() < 1e-6) return new THREE.Vector2(1, 0);
    forward.normalize();
    return new THREE.Vector2(-forward.y, forward.x);
  }
}
