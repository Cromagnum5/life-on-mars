import * as THREE from "three";
import type { RigwalkerAsset } from "./rigwalker-assets";

export type Rigwalker = {
  group: THREE.Group;
  corporation: string;
  health: number;
  attack: number;
  isAlive: boolean;
  receiveDamage: (damage: number) => void;
  prepareDefense: (attackVariant: number) => void;
  moveTo: (destination: THREE.Vector3) => void;
  setSelected: (selected: boolean) => void;
  update: (
    delta: number,
    elapsed: number,
    terrainHeightAt: (x: number, z: number) => number,
    nearbyUnits: readonly Rigwalker[],
    obstacles: readonly NavigationObstacle[],
  ) => void;
};

export type NavigationObstacle = {
  center: THREE.Vector2;
  radius: number;
};

const MOVE_SPEED = 3.6;
const SEPARATION_SPEED = 1.1;
const SEPARATION_RADIUS = 1.25;
const OBSTACLE_LOOKAHEAD = 1.4;
const WALK_CYCLE_SPEED = 8.4;
const MAX_HEALTH = 100;
const ATTACK_DAMAGE = 18;
const AWARENESS_RANGE = 8.5;
const FIGHT_DISTANCE = 2.65;
const ATTACK_RANGE = 3.15;
const ATTACK_DURATION = 1.05;
const ATTACK_RECOVERY = 0.46;
const ATTACK_RECOVERY_JITTER = 0.22;
const INITIAL_ATTACK_DELAY = 0.08;
const INITIAL_ATTACK_STAGGER = 0.55;
const COMBAT_SHUFFLE_SPEED = 2.25;
const WALK_ANIMATION_SPEED = 1.72;

type CombatBones = {
  root: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  upperArmL: THREE.Bone;
  lowerArmL: THREE.Bone;
  handL: THREE.Bone;
  upperArmR: THREE.Bone;
  lowerArmR: THREE.Bone;
  handR: THREE.Bone;
  upperLegL: THREE.Bone;
  lowerLegL: THREE.Bone;
  footL: THREE.Bone;
  upperLegR: THREE.Bone;
  lowerLegR: THREE.Bone;
  footR: THREE.Bone;
  armRest: Record<"upperArmL" | "lowerArmL" | "handL" | "upperArmR" | "lowerArmR" | "handR", THREE.Quaternion>;
  legRest: Record<
    "upperLegL" | "lowerLegL" | "footL" | "upperLegR" | "lowerLegR" | "footR",
    THREE.Quaternion
  >;
};

function smoothRange(value: number, start: number, end: number): number {
  return THREE.MathUtils.smoothstep(value, start, end);
}

function findCombatBones(model: THREE.Object3D): CombatBones | null {
  const bone = (name: string) =>
    (model.getObjectByName(name) ?? model.getObjectByName(name.replaceAll(".", ""))) as
      | THREE.Bone
      | undefined;
  const result = {
    root: bone("root"), spine: bone("spine"), chest: bone("chest"),
    neck: bone("neck"), head: bone("head"),
    upperArmL: bone("upper_arm.L"), lowerArmL: bone("lower_arm.L"),
    handL: bone("hand.L"),
    upperArmR: bone("upper_arm.R"), lowerArmR: bone("lower_arm.R"),
    handR: bone("hand.R"),
    upperLegL: bone("upper_leg.L"), lowerLegL: bone("lower_leg.L"),
    footL: bone("foot.L"),
    upperLegR: bone("upper_leg.R"), lowerLegR: bone("lower_leg.R"),
    footR: bone("foot.R"),
  };
  const armRest = {
    upperArmL: result.upperArmL?.quaternion.clone(), lowerArmL: result.lowerArmL?.quaternion.clone(),
    handL: result.handL?.quaternion.clone(), upperArmR: result.upperArmR?.quaternion.clone(),
    lowerArmR: result.lowerArmR?.quaternion.clone(), handR: result.handR?.quaternion.clone(),
  };
  const legRest = {
    upperLegL: result.upperLegL?.quaternion.clone(), lowerLegL: result.lowerLegL?.quaternion.clone(),
    footL: result.footL?.quaternion.clone(),
    upperLegR: result.upperLegR?.quaternion.clone(), lowerLegR: result.lowerLegR?.quaternion.clone(),
    footR: result.footR?.quaternion.clone(),
  };
  Object.assign(result, { armRest, legRest });
  return Object.values(result).every(Boolean) && Object.values(armRest).every(Boolean) && Object.values(legRest).every(Boolean) ? result as CombatBones : null;
}

const boneOffsetEuler = new THREE.Euler();
const boneOffsetQuaternion = new THREE.Quaternion();

function setBoneOffset(bone: THREE.Bone, rest: THREE.Quaternion, x: number, y: number, z: number): void {
  boneOffsetEuler.set(x, y, z);
  boneOffsetQuaternion.setFromEuler(boneOffsetEuler);
  bone.quaternion.copy(rest).multiply(boneOffsetQuaternion);
}

function applyCombatPose(
  bones: CombatBones, attackPhase: number, attackVariant: number,
  defensePhase: number, defenseSide: number, hitPhase: number, combatStep: number,
): void {
  const attacking = attackPhase >= 0;
  const winding = attacking ? smoothRange(attackPhase, 0, 0.28) * (1 - smoothRange(attackPhase, 0.28, 0.58)) : 0;
  const cutting = attacking ? smoothRange(attackPhase, 0.28, 0.56) * (1 - smoothRange(attackPhase, 0.68, 1)) : 0;
  const impact = attacking ? smoothRange(attackPhase, 0.38, 0.54) * (1 - smoothRange(attackPhase, 0.62, 0.82)) : 0;
  const followThrough = attacking ? smoothRange(attackPhase, 0.54, 0.7) * (1 - smoothRange(attackPhase, 0.82, 1)) : 0;
  const attackSide = attackVariant === 1 ? -1 : 1;
  const guarding = defensePhase >= 0 ? smoothRange(defensePhase, 0, 0.22) * (1 - smoothRange(defensePhase, 0.68, 1)) : 0;
  const hitShock = hitPhase >= 0 ? Math.sin(Math.min(1, hitPhase) * Math.PI) : 0;
  const torsoTwist = attackSide * (winding * -0.58 + impact * 0.76 + followThrough * 0.28) + defenseSide * guarding * 0.2;

  bones.root.rotation.set(0, torsoTwist * 0.28, 0);
  bones.spine.rotation.set(0.04 + cutting * 0.1 - hitShock * 0.12, torsoTwist * 0.52, attackSide * (winding - cutting) * 0.08);
  bones.chest.rotation.set(0.03 + cutting * 0.12 - hitShock * 0.14, torsoTwist * 0.72, attackSide * (winding - cutting) * 0.13);
  bones.neck.rotation.set(0.08 + cutting * 0.08 - hitShock * 0.12, -torsoTwist * 0.46, defenseSide * guarding * 0.08);
  bones.head.rotation.set(-0.03 + hitShock * 0.1, -torsoTwist * 0.34, -defenseSide * guarding * 0.1);

  // One-handed compass cut: the hilt loads near the sword-side ear, the
  // elbow stays bent, and the shoulder carries the blade through a compact arc.
  const rightShoulderForward = -0.3 - winding * 0.72 - impact * 0.2 + followThrough * 0.16 - guarding * 0.22;
  const rightElbowBend = -0.5 - winding * 0.68 + impact * 0.3 + followThrough * 0.16 - guarding * 0.24;
  setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
    rightShoulderForward + hitShock * 0.08,
    attackSide * (0.1 + winding * 0.22 - impact * 0.38 - followThrough * 0.22) - defenseSide * guarding * 0.18,
    attackSide * (-0.05 - winding * 0.18 + impact * 0.26 + followThrough * 0.14),
  );
  setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
    rightElbowBend + hitShock * 0.08,
    attackSide * (winding * 0.18 - impact * 0.28 - followThrough * 0.14),
    attackSide * (0.04 + winding * 0.08 - impact * 0.1 + guarding * 0.08),
  );
  setBoneOffset(bones.handR, bones.armRest.handR,
    -0.1 - winding * 0.22 + impact * 0.98 + followThrough * 0.38,
    attackSide * (-0.12 - winding * 0.26 - impact * 0.72 - followThrough * 0.3),
    attackSide * (0.12 + winding * 0.18 + impact * 0.28 + followThrough * 0.12),
  );

  // The free arm remains relaxed and separate from the one-handed grip. It
  // counterbalances the torso slightly but never flies across the weapon line.
  setBoneOffset(bones.upperArmL, bones.armRest.upperArmL,
    -0.24 - guarding * 0.28 + hitShock * 0.1,
    -attackSide * (0.08 + winding * 0.1 - impact * 0.08) + defenseSide * guarding * 0.24,
    -attackSide * (0.04 + winding * 0.06),
  );
  setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL,
    -0.38 - guarding * 0.26 + hitShock * 0.1,
    -attackSide * (0.06 + winding * 0.08 - impact * 0.06) + defenseSide * guarding * 0.14,
    -attackSide * (0.03 + guarding * 0.05),
  );
  setBoneOffset(bones.handL, bones.armRest.handL,
    -0.06 + guarding * 0.12,
    -attackSide * 0.06,
    -attackSide * 0.06 + defenseSide * guarding * 0.1,
  );

  // Keep a low, mechanically braced stance and counter-rotate each ankle.
  const stance = 0.11;
  const kneeBend = 0.22;
  const legDrive = impact * 0.24 + followThrough * 0.08 - winding * 0.16 + guarding * 0.08 - hitShock * 0.04;
  const lead = attackSide * legDrive;
  const upperL = stance - lead + combatStep;
  const lowerL = kneeBend + lead + Math.max(0, -combatStep) * 0.65;
  const upperR = -stance + lead - combatStep;
  const lowerR = kneeBend - lead + Math.max(0, combatStep) * 0.65;
  setBoneOffset(bones.upperLegL, bones.legRest.upperLegL, upperL, 0, guarding * 0.025);
  setBoneOffset(bones.lowerLegL, bones.legRest.lowerLegL, lowerL, 0, 0);
  setBoneOffset(bones.footL, bones.legRest.footL, -(upperL + lowerL), 0, -guarding * 0.025);
  setBoneOffset(bones.upperLegR, bones.legRest.upperLegR, upperR, 0, -guarding * 0.025);
  setBoneOffset(bones.lowerLegR, bones.legRest.lowerLegR, lowerR, 0, 0);
  setBoneOffset(bones.footR, bones.legRest.footR, -(upperR + lowerR), 0, guarding * 0.025);
}

function resetCombatPose(bones: CombatBones): void {
  bones.root.rotation.set(0, 0, 0);
  bones.spine.rotation.set(0, 0, 0);
  bones.chest.rotation.set(0, 0, 0);
  bones.neck.rotation.set(0, 0, 0);
  bones.head.rotation.set(0, 0, 0);
  bones.upperArmL.quaternion.copy(bones.armRest.upperArmL);
  bones.lowerArmL.quaternion.copy(bones.armRest.lowerArmL);
  bones.handL.quaternion.copy(bones.armRest.handL);
  bones.upperArmR.quaternion.copy(bones.armRest.upperArmR);
  bones.lowerArmR.quaternion.copy(bones.armRest.lowerArmR);
  bones.handR.quaternion.copy(bones.armRest.handR);
  bones.upperLegL.quaternion.copy(bones.legRest.upperLegL);
  bones.lowerLegL.quaternion.copy(bones.legRest.lowerLegL);
  bones.footL.quaternion.copy(bones.legRest.footL);
  bones.upperLegR.quaternion.copy(bones.legRest.upperLegR);
  bones.lowerLegR.quaternion.copy(bones.legRest.lowerLegR);
  bones.footR.quaternion.copy(bones.legRest.footR);
}

const armor = new THREE.MeshStandardMaterial({
  color: 0x596266,
  metalness: 0.72,
  roughness: 0.44,
});
const darkMetal = new THREE.MeshStandardMaterial({
  color: 0x252b2d,
  metalness: 0.82,
  roughness: 0.4,
});
const jointMaterial = new THREE.MeshStandardMaterial({
  color: 0x858d8f,
  metalness: 0.9,
  roughness: 0.3,
});
const orange = new THREE.MeshStandardMaterial({
  color: 0xf29a3f,
  emissive: 0x8c3b0d,
  emissiveIntensity: 0.75,
  metalness: 0.4,
  roughness: 0.35,
});
const visor = new THREE.MeshStandardMaterial({
  color: 0x8ce7f0,
  emissive: 0x46c9dc,
  emissiveIntensity: 2.4,
  metalness: 0.2,
  roughness: 0.18,
});

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createLeg(side: -1 | 1, accent: THREE.Material): {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
} {
  const hip = new THREE.Group();
  hip.position.set(side * 0.28, 1.55, 0);

  addMesh(
    hip,
    new THREE.SphereGeometry(0.15, 8, 6),
    jointMaterial,
    [0, 0, 0],
  );
  addMesh(
    hip,
    new THREE.BoxGeometry(0.23, 0.72, 0.27),
    armor,
    [0, -0.42, 0],
  );

  const knee = new THREE.Group();
  knee.position.y = -0.8;
  hip.add(knee);
  addMesh(
    knee,
    new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8),
    accent,
    [0, 0, 0],
  ).rotation.z = Math.PI / 2;
  addMesh(
    knee,
    new THREE.BoxGeometry(0.21, 0.72, 0.24),
    darkMetal,
    [0, -0.43, 0.02],
  );

  const ankle = new THREE.Group();
  ankle.position.y = -0.82;
  knee.add(ankle);
  addMesh(
    ankle,
    new THREE.BoxGeometry(0.34, 0.18, 0.55),
    armor,
    [0, -0.06, 0.13],
  );
  addMesh(
    ankle,
    new THREE.BoxGeometry(0.23, 0.08, 0.18),
    accent,
    [0, 0.06, 0.44],
  );

  return { hip, knee, ankle };
}

function createArm(side: -1 | 1, accent: THREE.Material): {
  shoulder: THREE.Group;
  elbow: THREE.Group;
} {
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.68, 2.72, 0);

  addMesh(
    shoulder,
    new THREE.SphereGeometry(0.19, 8, 6),
    accent,
    [0, 0, 0],
  );
  addMesh(
    shoulder,
    new THREE.BoxGeometry(0.24, 0.72, 0.27),
    armor,
    [0, -0.44, 0],
  );

  const elbow = new THREE.Group();
  elbow.position.y = -0.85;
  shoulder.add(elbow);
  addMesh(
    elbow,
    new THREE.SphereGeometry(0.13, 8, 6),
    jointMaterial,
    [0, 0, 0],
  );
  addMesh(
    elbow,
    new THREE.BoxGeometry(0.21, 0.62, 0.24),
    darkMetal,
    [0, -0.39, 0],
  );
  addMesh(
    elbow,
    new THREE.BoxGeometry(0.29, 0.24, 0.3),
    armor,
    [0, -0.76, 0.03],
  );

  return { shoulder, elbow };
}

function createFallbackVisual(accentColor: number): {
  root: THREE.Group;
  update: (delta: number, elapsed: number, moving: boolean) => void;
} {
  const root = new THREE.Group();
  root.name = "Primitive Rigwalker fallback";
  const accent = orange.clone();
  accent.color.setHex(accentColor);
  accent.emissive.setHex(accentColor);
  const leftLeg = createLeg(-1, accent);
  const rightLeg = createLeg(1, accent);
  root.add(leftLeg.hip, rightLeg.hip);

  addMesh(root, new THREE.BoxGeometry(0.72, 0.38, 0.52), darkMetal, [0, 1.65, 0]);
  addMesh(root, new THREE.BoxGeometry(1.08, 1.12, 0.62), armor, [0, 2.35, 0]);
  addMesh(root, new THREE.BoxGeometry(0.92, 0.16, 0.68), accent, [0, 2.68, 0.03]);
  addMesh(root, new THREE.BoxGeometry(0.62, 0.86, 0.28), darkMetal, [0, 2.28, -0.56]);

  const leftArm = createArm(-1, accent);
  const rightArm = createArm(1, accent);
  root.add(leftArm.shoulder, rightArm.shoulder);

  const head = new THREE.Group();
  head.position.y = 3.15;
  root.add(head);
  addMesh(head, new THREE.BoxGeometry(0.58, 0.52, 0.52), darkMetal, [0, 0, 0]);
  addMesh(head, new THREE.BoxGeometry(0.46, 0.14, 0.07), visor, [0, 0.06, 0.295]);
  addMesh(head, new THREE.BoxGeometry(0.13, 0.21, 0.15), accent, [0.28, 0.18, -0.04]);
  addMesh(
    root,
    new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6),
    jointMaterial,
    [0.38, 3.65, -0.16],
  );
  addMesh(root, new THREE.SphereGeometry(0.09, 8, 6), visor, [0.38, 4.03, -0.16]);

  let walkCycle = 0;
  let walkBlend = 0;

  function update(delta: number, elapsed: number, moving: boolean): void {
    walkBlend = THREE.MathUtils.damp(walkBlend, moving ? 1 : 0, 10, delta);
    walkCycle += delta * WALK_CYCLE_SPEED * walkBlend;
    const stride = Math.sin(walkCycle) * walkBlend;
    const oppositeStride = -stride;
    const stepLift = Math.abs(Math.cos(walkCycle)) * walkBlend;

    leftLeg.hip.rotation.x = stride * 0.52;
    rightLeg.hip.rotation.x = oppositeStride * 0.52;
    leftLeg.knee.rotation.x = Math.max(0, -stride) * 0.72;
    rightLeg.knee.rotation.x = Math.max(0, stride) * 0.72;
    leftLeg.ankle.rotation.x = -leftLeg.hip.rotation.x * 0.35;
    rightLeg.ankle.rotation.x = -rightLeg.hip.rotation.x * 0.35;
    leftArm.shoulder.rotation.x = oppositeStride * 0.42;
    rightArm.shoulder.rotation.x = stride * 0.42;
    leftArm.elbow.rotation.x = -0.25 - Math.max(0, stride) * 0.3;
    rightArm.elbow.rotation.x = -0.25 - Math.max(0, -stride) * 0.3;
    root.position.y =
      0.07 + stepLift * 0.08 + Math.sin(elapsed * 1.8) * 0.012;
    root.rotation.z = stride * 0.025;
    head.rotation.y = Math.sin(elapsed * 1.1) * 0.07;
  }

  return { root, update };
}

export function createRigwalker(
  asset: RigwalkerAsset | null = null,
  accentColor = 0xf29a3f,
  corporation = "Independent",
): Rigwalker {
  const group = new THREE.Group();
  group.name = "Rigwalker";

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 24),
    new THREE.MeshBasicMaterial({
      color: 0x170b08,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  contactShadow.name = "Rigwalker contact shadow";
  contactShadow.position.y = -0.17;
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.scale.set(0.78, 1.15, 1);
  group.add(contactShadow);

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.84, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffb35d,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  selectionRing.name = "Rigwalker selection ring";
  selectionRing.position.y = -0.14;
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  group.add(selectionRing);

  const healthBar = new THREE.Group();
  healthBar.position.y = 4.45;
  const healthBack = new THREE.Mesh(
    new THREE.PlaneGeometry(1.45, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x24100d, depthTest: false }),
  );
  const healthFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.38, 0.09),
    new THREE.MeshBasicMaterial({ color: accentColor, depthTest: false }),
  );
  healthFill.position.z = 0.01;
  healthBar.add(healthBack, healthFill);
  group.add(healthBar);

  const pipePivot = new THREE.Group();
  pipePivot.name = "Rigwalker weapon pivot";
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.085, 2.65, 8),
    new THREE.MeshStandardMaterial({ color: 0x697277, metalness: 0.88, roughness: 0.3 }),
  );
  pipe.name = "Rigwalker weapon";
  pipe.position.y = 1.15;
  pipe.castShadow = true;
  pipePivot.add(pipe);
  pipePivot.visible = !asset;
  group.add(pipePivot);

  const fallbackVisual = asset ? null : createFallbackVisual(accentColor);
  if (fallbackVisual) {
    group.add(fallbackVisual.root);
  }

  let mixer: THREE.AnimationMixer | null = null;
  let combatBones: CombatBones | null = null;
  let weaponVisual: THREE.Object3D | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let walkAction: THREE.AnimationAction | null = null;
  let combatAction: THREE.AnimationAction | null = null;
  let activeAction: THREE.AnimationAction | null = null;

  if (asset) {
    const model = asset.instantiate();
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && /Accent|Stripe|Shoulder|Knee|Toe/.test(object.name)) {
        const material = (object.material as THREE.MeshStandardMaterial).clone();
        material.color.setHex(accentColor);
        material.emissive?.setHex(accentColor);
        object.material = material;
      }
    });
    group.add(model);
    combatBones = findCombatBones(model);
    weaponVisual = model.getObjectByName("Broadsword") ?? null;
    if (weaponVisual) weaponVisual.visible = false;
    mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(asset.clips, "Idle");
    const walkClip = THREE.AnimationClip.findByName(asset.clips, "Walk");
    const combatClip = THREE.AnimationClip.findByName(asset.clips, "CombatIdle");
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
      activeAction = idleAction;
    }
    if (walkClip) {
      walkAction = mixer.clipAction(walkClip);
      walkAction.setEffectiveTimeScale(WALK_ANIMATION_SPEED);
    }
    if (combatClip) {
      combatAction = mixer.clipAction(combatClip);
    }
  }

  let destination: THREE.Vector3 | null = null;
  let health = MAX_HEALTH;
  let combatTarget: Rigwalker | null = null;
  let attackElapsed = -1;
  let attackCooldown = 0;
  const attackTimingOffset = Math.random();
  let attackVariant = 0;
  let damageApplied = false;
  let defenseElapsed = -1;
  let defenseSide = 1;
  let hitReactionElapsed = -1;
  let wasInCombat = false;
  const targetRotation = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const movement = new THREE.Vector3();
  const desiredMovement = new THREE.Vector3();
  const combatDirection = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const proposedPosition = new THREE.Vector3();

  function moveTo(nextDestination: THREE.Vector3): void {
    destination = nextDestination.clone();
    destination.y = 0;
  }

  function setSelected(selected: boolean): void {
    selectionRing.visible = selected;
  }

  function prepareDefense(incomingVariant: number): void {
    if (health <= 0 || attackElapsed >= 0) return;
    defenseElapsed = 0;
    defenseSide = incomingVariant === 1 ? -1 : 1;
    attackCooldown = Math.min(attackCooldown, ATTACK_DURATION * 0.72 + attackTimingOffset * 0.12);
  }

  function receiveDamage(damage: number): void {
    if (health <= 0) return;
    hitReactionElapsed = 0;
    health = Math.max(0, health - damage);
    healthFill.scale.x = health / MAX_HEALTH;
    healthFill.position.x = -0.69 * (1 - health / MAX_HEALTH);
    if (health === 0) {
      selectionRing.visible = false;
    }
  }

  function update(
    delta: number,
    elapsed: number,
    terrainHeightAt: (x: number, z: number) => number,
    nearbyUnits: readonly Rigwalker[],
    obstacles: readonly NavigationObstacle[],
  ): void {
    if (health <= 0) return;

    if (defenseElapsed >= 0) {
      defenseElapsed += delta;
      if (defenseElapsed >= ATTACK_DURATION) defenseElapsed = -1;
    }
    if (hitReactionElapsed >= 0) {
      hitReactionElapsed += delta;
      if (hitReactionElapsed >= 0.42) hitReactionElapsed = -1;
    }

    let moving = false;
    let travelSpeed = 0;
    separation.set(0, 0, 0);

    for (const other of nearbyUnits) {
      if (other === rigwalker) {
        continue;
      }

      radial.set(
        group.position.x - other.group.position.x,
        0,
        group.position.z - other.group.position.z,
      );
      const distance = radial.length();
      if (distance < SEPARATION_RADIUS) {
        if (distance < 0.001) {
          const angle = (group.id % 8) * (Math.PI / 4);
          radial.set(Math.cos(angle), 0, Math.sin(angle));
        } else {
          radial.divideScalar(distance);
        }
        separation.addScaledVector(
          radial,
          (SEPARATION_RADIUS - distance) / SEPARATION_RADIUS,
        );
      }
    }

    if (!combatTarget?.isAlive || combatTarget.corporation === corporation ||
        group.position.distanceTo(combatTarget.group.position) > AWARENESS_RANGE * 1.35) {
      combatTarget = null;
    }
    if (!combatTarget) {
      let nearestDistance = AWARENESS_RANGE;
      for (const other of nearbyUnits) {
        if (other === rigwalker || !other.isAlive || other.corporation === corporation) continue;
        const distance = group.position.distanceTo(other.group.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          combatTarget = other;
        }
      }
      if (combatTarget) {
        attackCooldown = Math.max(
          attackCooldown,
          INITIAL_ATTACK_DELAY + attackTimingOffset * INITIAL_ATTACK_STAGGER,
        );
      }
    }

    const inCombat = combatTarget !== null;
    if (!inCombat) {
      attackElapsed = -1;
      defenseElapsed = -1;
      hitReactionElapsed = -1;
      if (wasInCombat && combatBones) resetCombatPose(combatBones);
    }
    wasInCombat = inCombat;
    if (weaponVisual) weaponVisual.visible = inCombat;

    const enemyDistance = combatTarget
      ? group.position.distanceTo(combatTarget.group.position)
      : Number.POSITIVE_INFINITY;
    if (combatTarget) {
      combatDirection.set(
        combatTarget.group.position.x - group.position.x,
        0,
        combatTarget.group.position.z - group.position.z,
      ).normalize();
      if (enemyDistance > FIGHT_DISTANCE + 0.35) {
        movement.copy(combatDirection);
        moving = true;
      } else if (enemyDistance < FIGHT_DISTANCE - 0.3) {
        movement.copy(combatDirection).multiplyScalar(-1);
        moving = true;
      } else {
        // Hold ground once in striking distance instead of sliding in a stationary pose.
        movement.set(0, 0, 0);
      }
      travelSpeed = COMBAT_SHUFFLE_SPEED;
      desiredMovement.copy(movement);
    } else if (destination) {
      movement.set(
        destination.x - group.position.x,
        0,
        destination.z - group.position.z,
      );
      const distance = movement.length();

      if (distance > 0.08) {
        moving = true;
        travelSpeed = MOVE_SPEED;
        movement.normalize();
        desiredMovement.copy(movement);
      } else {
        destination = null;
      }
    }

    if (!moving && separation.lengthSq() > 0.001) {
      moving = true;
      travelSpeed = SEPARATION_SPEED;
      movement.copy(separation).normalize();
      desiredMovement.copy(movement);
    } else if (moving && separation.lengthSq() > 0.001) {
      movement.addScaledVector(separation, 1.35).normalize();
    }

    if (moving) {
      for (const obstacle of obstacles) {
        radial.set(
          group.position.x - obstacle.center.x,
          0,
          group.position.z - obstacle.center.y,
        );
        const distance = radial.length();

        if (
          distance >= obstacle.radius &&
          distance < obstacle.radius + OBSTACLE_LOOKAHEAD
        ) {
          radial.normalize();
          const headingTowardObstacle = movement.dot(radial) < 0;
          if (headingTowardObstacle) {
            const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
            if (tangent.dot(desiredMovement) < 0) {
              tangent.multiplyScalar(-1);
            }
            const proximity =
              1 - (distance - obstacle.radius) / OBSTACLE_LOOKAHEAD;
            movement
              .addScaledVector(tangent, proximity * 1.8)
              .addScaledVector(radial, proximity * 0.45)
              .normalize();
          }
        }

        proposedPosition
          .copy(group.position)
          .addScaledVector(movement, travelSpeed * delta);
        const proposedDistance = Math.hypot(
          proposedPosition.x - obstacle.center.x,
          proposedPosition.z - obstacle.center.y,
        );
        if (distance >= obstacle.radius && proposedDistance < obstacle.radius) {
          radial.normalize();
          movement.set(-radial.z, 0, radial.x);
          if (movement.dot(desiredMovement) < 0) {
            movement.multiplyScalar(-1);
          }
        }
      }

      const remainingDistance = destination && !combatTarget
        ? Math.hypot(
            destination.x - group.position.x,
            destination.z - group.position.z,
          )
        : Number.POSITIVE_INFINITY;
      const travel = Math.min(remainingDistance, travelSpeed * delta);
      group.position.addScaledVector(movement, travel);

      const targetAngle = combatTarget
        ? Math.atan2(combatDirection.x, combatDirection.z)
        : Math.atan2(movement.x, movement.z);
      targetRotation.setFromAxisAngle(upAxis, targetAngle);
      group.quaternion.slerp(targetRotation, 1 - Math.exp(-10 * delta));
    }

    attackCooldown = Math.max(0, attackCooldown - delta);
    if (combatTarget && enemyDistance <= ATTACK_RANGE && attackElapsed < 0 && attackCooldown <= 0) {
      attackElapsed = 0;
      attackVariant = Math.floor(Math.random() * 3);
      damageApplied = false;
      combatTarget.prepareDefense(attackVariant);
    }
    if (attackElapsed >= 0 && combatTarget) {
      attackElapsed += delta;
      const phase = Math.min(1, attackElapsed / ATTACK_DURATION);
      const strike = Math.sin(phase * Math.PI);
      const swing = smoothRange(phase, 0.18, 0.62);
      pipePivot.position.set(0.72, 1.65, 0.28);
      if (attackVariant === 0) {
        pipePivot.rotation.set(1.25 - swing * 0.65, 0.15, -1.05 + swing * 1.6);
      } else if (attackVariant === 1) {
        pipePivot.rotation.set(1.15 - swing * 0.55, -0.8 + swing * 1.6, 0.85 - swing * 1.4);
      } else {
        pipePivot.rotation.set(0.8 - strike * 0.18, -1.2 + swing * 2.4, -0.55);
      }
      if (!damageApplied && phase >= 0.54) {
        if (combatTarget?.isAlive && group.position.distanceTo(combatTarget.group.position) <= ATTACK_RANGE + 0.25) {
          combatTarget.receiveDamage(ATTACK_DAMAGE);
        }
        damageApplied = true;
      }
      if (phase >= 1) {
        attackElapsed = -1;
        attackCooldown =
          ATTACK_RECOVERY +
          (attackTimingOffset - 0.5) * ATTACK_RECOVERY_JITTER +
          Math.random() * ATTACK_RECOVERY_JITTER;
      }
    } else if (combatTarget) {
      pipePivot.position.set(0.72, 1.65, 0.28);
      if (defenseElapsed >= 0) {
        const guard = Math.sin(Math.min(1, defenseElapsed / ATTACK_DURATION) * Math.PI);
        pipePivot.rotation.set(1.25, defenseSide * 0.55, -0.45 + defenseSide * guard * 0.55);
      } else {
        pipePivot.rotation.set(0.65, 0.1, -0.9);
      }
    } else {
      pipePivot.position.set(0.52, 1.45, -0.42);
      pipePivot.rotation.set(0.12, 0, 0.2);
    }

    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      terrainHeightAt(group.position.x, group.position.z) + 0.2,
      12,
      delta,
    );

    fallbackVisual?.update(delta, elapsed, moving);

    if (mixer) {
      const nextAction = combatTarget ? combatAction ?? idleAction : moving ? walkAction : idleAction;
      if (nextAction && nextAction !== activeAction) {
        nextAction.reset().play();
        if (activeAction) {
          nextAction.crossFadeFrom(activeAction, 0.16, false);
        }
        activeAction = nextAction;
      }
      mixer.update(delta);
      if (combatBones && combatTarget) {
        applyCombatPose(
          combatBones,
          attackElapsed >= 0 ? Math.min(1, attackElapsed / ATTACK_DURATION) : -1,
          attackVariant,
          defenseElapsed >= 0 ? Math.min(1, defenseElapsed / ATTACK_DURATION) : -1,
          defenseSide,
          hitReactionElapsed >= 0 ? Math.min(1, hitReactionElapsed / 0.42) : -1,
          moving ? Math.sin(elapsed * 5.8 + group.id * 0.7) * 0.24 : 0,
        );
      }
    }
  }

  const rigwalker: Rigwalker = {
    group,
    corporation,
    get health() { return health; },
    attack: ATTACK_DAMAGE,
    get isAlive() { return health > 0; },
    receiveDamage,
    prepareDefense,
    moveTo,
    setSelected,
    update,
  };
  return rigwalker;
}
