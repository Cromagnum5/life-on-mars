import * as THREE from "three";
import { createRigwalker, type Rigwalker } from "./rigwalker";
import type { RigwalkerAsset } from "./rigwalker-assets";

const PRODUCTION_SECONDS = 20;
/**
 * Every third Rigwalker off the line is a hurler. A mixed field is the point:
 * the swords walk in while the rocks come from behind them.
 */
const HURLER_EVERY = 3;
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

export class AssemblyBayProduction {
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
  private produced = 0;
  private phase: ProductionPhase = "producing";
  private productionElapsed = 0;
  private phaseElapsed = 0;
  private doorOpen = 0;

  constructor(
    scene: THREE.Scene,
    door: THREE.Group,
    units: Rigwalker[],
    terrainHeightAt: (x: number, z: number) => number,
    rigwalkerAsset: RigwalkerAsset | null,
    spawnPosition: THREE.Vector2,
    rallyPoint: THREE.Vector3,
    accent: number,
    corporation: string,
  ) {
    this.scene = scene;
    this.door = door;
    this.units = units;
    this.terrainHeightAt = terrainHeightAt;
    this.rigwalkerAsset = rigwalkerAsset;
    this.spawnPosition = spawnPosition;
    this.rallyPoint = rallyPoint;
    this.accent = accent;
    this.corporation = corporation;
    this.closedDoorY = door.position.y;
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
        this.spawnRigwalker();
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

  private spawnRigwalker(): void {
    this.produced += 1;
    const rigwalker = createRigwalker(
      this.rigwalkerAsset, this.accent, this.corporation, Math.random,
      { role: this.produced % HURLER_EVERY === 0 ? "hurler" : "melee" },
    );
    rigwalker.group.position.set(
      this.spawnPosition.x,
      this.terrainHeightAt(this.spawnPosition.x, this.spawnPosition.y) + 0.2,
      this.spawnPosition.y,
    );

    rigwalker.moveTo(this.rallyPoint);
    this.units.push(rigwalker);
    this.scene.add(rigwalker.group);
  }

}
