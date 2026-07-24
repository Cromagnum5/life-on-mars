import * as THREE from "three";
import { BUILDING_OBSTACLES } from "./buildings";
import { createRigwalker, type Rigwalker } from "./rigwalker";

const PRODUCTION_SECONDS = 30;
const DOOR_SPEED = 1.4;
const DOOR_HEIGHT = 2.9;
const OPEN_DOOR_SCALE = 0.12;
const EXIT_SECONDS = 2.2;
const ASSEMBLY_BAY_X = 10;
const SPAWN_Z = -3.8;
const RALLY_MIN_X = -18;
const RALLY_MAX_X = 34;
const RALLY_MIN_Z = 1;
const RALLY_MAX_Z = 28;
const UNIT_CLEARANCE = 2.2;

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
  private phase: ProductionPhase = "producing";
  private productionElapsed = 0;
  private phaseElapsed = 0;
  private doorOpen = 0;

  constructor(
    scene: THREE.Scene,
    door: THREE.Group,
    units: Rigwalker[],
    terrainHeightAt: (x: number, z: number) => number,
  ) {
    this.scene = scene;
    this.door = door;
    this.units = units;
    this.terrainHeightAt = terrainHeightAt;
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

  private applyDoorPose(): void {
    const scale = THREE.MathUtils.lerp(1, OPEN_DOOR_SCALE, this.doorOpen);
    this.door.scale.y = scale;
    this.door.position.y =
      this.closedDoorY + (DOOR_HEIGHT / 2) * (1 - scale);
  }

  private spawnRigwalker(): void {
    const rigwalker = createRigwalker();
    rigwalker.group.position.set(
      ASSEMBLY_BAY_X,
      this.terrainHeightAt(ASSEMBLY_BAY_X, SPAWN_Z) + 0.2,
      SPAWN_Z,
    );

    rigwalker.moveTo(this.chooseRallyPoint());
    this.units.push(rigwalker);
    this.scene.add(rigwalker.group);
  }

  private chooseRallyPoint(): THREE.Vector3 {
    let candidate = new THREE.Vector3(ASSEMBLY_BAY_X, 0, 3);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      candidate = new THREE.Vector3(
        THREE.MathUtils.lerp(RALLY_MIN_X, RALLY_MAX_X, Math.random()),
        0,
        THREE.MathUtils.lerp(RALLY_MIN_Z, RALLY_MAX_Z, Math.random()),
      );
      const candidate2D = new THREE.Vector2(candidate.x, candidate.z);
      const clearOfBuildings = BUILDING_OBSTACLES.every(
        (building) =>
          building.center.distanceTo(candidate2D) >= building.radius + 1.2,
      );
      const clearOfUnits = this.units.every(
        (unit) => unit.group.position.distanceTo(candidate) >= UNIT_CLEARANCE,
      );

      if (clearOfBuildings && clearOfUnits) {
        break;
      }
    }

    return candidate;
  }
}
