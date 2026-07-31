import * as THREE from "three";
import { BalanceController, type BalancePose } from "./balance";
import {
  POSE_TUNING,
  type Beat,
  type FreeArmAngle,
  type ThrowArmKey,
} from "./pose-tuning";
import type { RigwalkerAsset } from "./rigwalker-assets";
import {
  BASE_FIGHT_DISTANCE,
  HURLER_FIGHT_DISTANCE,
  STONE_RANGE,
  STONE_RELEASE_RANGE,
  createCombatProfile,
  isStoneStrike,
  isThrow,
  type AttackLine,
  type CombatCue,
  type CombatProfile,
  type CombatRole,
  type CombatStrategy,
  type StoneStrike,
  type ThrowType,
} from "./combat";

export type Rigwalker = {
  group: THREE.Group;
  corporation: string;
  combatId: number;
  combatProfile: CombatProfile;
  /** What this one does for a living. Hurlers throw rocks; the rest cut. */
  role: CombatRole;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  /** The plan currently being executed, for HUD readout. Null when idle. */
  strategy: CombatStrategy | null;
  canRemove: boolean;
  /** True while a swing is in flight, so the blade is worth trailing. */
  isSwinging: boolean;
  /**
   * World-space point a strike is thrown from: the blade's percussion point, or
   * the rock in a hurler's hand.
   */
  getContactPoint: (out: THREE.Vector3) => THREE.Vector3;
  /** World-space point on this unit's body that an incoming rock lands against. */
  getImpactPoint: (out: THREE.Vector3) => THREE.Vector3;
  /** Hides the held rock, because it is now in the air. Returns false if empty-handed. */
  releaseRock: () => boolean;
  /** World-space direction the blade is travelling this frame. */
  getBladeVelocity: (out: THREE.Vector3) => THREE.Vector3;
  /** Writes the blade's hilt and tip in world space; false when it has no weapon. */
  sampleBlade: (hilt: THREE.Vector3, tip: THREE.Vector3) => boolean;
  applyCombatDamage: (
    damage: number, side: -1 | 1, line?: THREE.Vector3 | null,
  ) => void;
  moveTo: (destination: THREE.Vector3) => void;
  setSelected: (selected: boolean) => void;
  update: (
    delta: number,
    elapsed: number,
    terrainHeightAt: (x: number, z: number) => number,
    nearbyUnits: readonly Rigwalker[],
    obstacles: readonly NavigationObstacle[],
    cameraQuaternion: THREE.Quaternion,
    combatCue?: CombatCue,
  ) => void;
};

export type NavigationObstacle = {
  center: THREE.Vector2;
  radius: number;
};

const footProbe = new THREE.Vector3();
const footFrame = new THREE.Quaternion();
const footTilt = new THREE.Quaternion();

/**
 * Where a fighter's feet actually are, in its own frame: +z is the way it is
 * facing, y is off the ground. Read off the posed skeleton after every layer
 * has been applied, which is the point — `applyThrowPose` is only the first of
 * three, and the Blender tools stop after it. A stance argued from those tools
 * is a stance nobody is looking at.
 *
 * Lives here rather than in either page so the sim's capture sheets and the
 * animation tool print the same numbers in the same format. A planted foot
 * reads about `h0.07`; compare against another fighter in the same frame rather
 * than against zero.
 */
export function describeFeet(unit: Rigwalker): string {
  const reach: number[] = [];
  const parts: string[] = [];
  for (const name of ["foot.L", "foot.R"]) {
    // The glTF conversion drops the dots from some exporters, so try both -
    // the same fallback `findCombatBones` uses.
    const bone = unit.group.getObjectByName(name) ??
      unit.group.getObjectByName(name.replaceAll(".", ""));
    if (!bone) return " · feet ?";
    footFrame.copy(unit.group.quaternion).invert();
    bone.getWorldPosition(footProbe).sub(unit.group.position).applyQuaternion(footFrame);
    const ankle = footProbe.clone();
    // Along the foot bone is toward the toe. A toe below the ankle is a heel
    // in the air, which is what "up on its toes" means as a number.
    bone.getWorldQuaternion(footTilt);
    footProbe.set(0, 1, 0).applyQuaternion(footTilt).applyQuaternion(footFrame);
    reach.push(ankle.z);
    parts.push(`${name.slice(-1)} ${ankle.z >= 0 ? "+" : ""}${ankle.z.toFixed(2)}` +
      ` h${ankle.y.toFixed(2)} toe${footProbe.y >= 0 ? "+" : ""}${footProbe.y.toFixed(2)}`);
  }
  const split = reach[0] - reach[1];
  return ` · feet ${parts.join("  ")}  split ${split >= 0 ? "+" : ""}${split.toFixed(2)}`;
}

const MOVE_SPEED = 3.6;
const SEPARATION_SPEED = 1.1;
const SEPARATION_RADIUS = 1.25;
/**
 * Fighters keep more room than marching units. Allies converging on one target
 * otherwise stand shoulder to shoulder, and the melee reads as a single blob
 * instead of several fighters working an opponent from different angles.
 */
const COMBAT_SEPARATION_RADIUS = 2.05;
/**
 * Crowding a standing unit will step away from, and the slacker figure it steps
 * until, as a fraction of the separation radius. One neighbour at the clearance
 * floor reads about 0.08, so a pair the floor has already resolved stands its
 * ground rather than shuffling apart on the spot.
 */
const SEPARATION_NUDGE = 0.12;
const SEPARATION_CLEAR = 0.02;
/**
 * Hard floor on how close two bodies may end a frame. Steering alone cannot
 * hold a crowd apart: several units converging on one target push inward
 * faster than the separation drift pushes back, and they end up occupying the
 * same spot. This resolves the remaining overlap positionally.
 */
const UNIT_CLEARANCE = 1.15;
const COMBAT_CLEARANCE = 1.85;
const OBSTACLE_LOOKAHEAD = 1.4;
/** Close enough to the waypoint to be standing on it. */
const ARRIVAL_DISTANCE = 0.08;
/**
 * A waypoint is a point, but a crowd cannot stand on one. Every unit a building
 * makes is sent to the same rally point, and the clearance floor holds all but
 * the first of them a body's width off it, so an exact arrival test leaves the
 * rest pressing into the pile for as long as the game runs. How long a unit
 * goes without getting closer before `isWaypointTakenByCrowd` is asked whether
 * that is because the ground is full.
 */
const CROWD_ARRIVAL_SECONDS = 0.45;
/** Ground made up over that window that counts as still closing. */
const CROWD_ARRIVAL_PROGRESS = 0.1;
/** How near a unit ahead has to be to be the reason for the hold-up. */
const CROWD_BLOCK_DISTANCE = UNIT_CLEARANCE + 0.35;
const WALK_CYCLE_SPEED = 8.4;
const MAX_HEALTH = 100;
const COMBAT_DISTANCE_DEAD_ZONE = 0.16;
const COMBAT_SHUFFLE_SPEED = 2.25;
const WALK_ANIMATION_SPEED = 1.72;
/**
 * A fighter with a long way to go runs it rather than shuffling. Without this a
 * swordsman closing on a hurler twelve metres away advances at the same speed
 * the hurler backs off at, and the two walk the length of the map in step.
 */
const COMBAT_RUN_DISTANCE = 6;
/** Backing away is slower than walking at something, which is what lets it be caught. */
const HURLER_BACKPEDAL_SPEED = 1.5;
/** How long a wreck stays on the battlefield, and its final sink. */
const CORPSE_SECONDS = 3.4;
const CORPSE_SINK_SECONDS = 0.8;
/**
 * How far a killing rock carries the body along its own line as it goes over.
 * Enough that the rock is visibly what put it down, short enough that the wreck
 * still lies inside the ground it was holding.
 */
const DEFEAT_KNOCKDOWN_DRIFT = 0.4;
/** A cut topples a fighter sideways, about its own forward axis. */
const DEFEAT_LOCAL_ROLL_AXIS = new THREE.Vector3(0, 0, 1);
/** Standing still: what every throw but the hurl does with its feet. */
const EMPTY_HURL_STEP: HurlStep = { forward: 0, drop: 0, engagement: 0 };
/** Fraction of an attack during which a feint shows its false line. */
const FEINT_REVEAL_PHASE = 0.3;

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
  bodyRest: Record<"root" | "spine" | "chest" | "neck" | "head", THREE.Quaternion>;
  armRest: Record<"upperArmL" | "lowerArmL" | "handL" | "upperArmR" | "lowerArmR" | "handR", THREE.Quaternion>;
  legRest: Record<
    "upperLegL" | "lowerLegL" | "footL" | "upperLegR" | "lowerLegR" | "footR",
    THREE.Quaternion
  >;
};

type CombatLineMotion = {
  attackSide: -1 | 1;
  guardLift: number;
  guardCross: number;
  hitPitch: number;
  hitRoll: number;
};

const COMBAT_LINE_MOTION: Record<AttackLine, CombatLineMotion> = {
  overhead: { attackSide: 1, guardLift: 1, guardCross: 0.25, hitPitch: 0.22, hitRoll: 0 },
  forehand: { attackSide: 1, guardLift: 0.45, guardCross: 0.8, hitPitch: 0.06, hitRoll: 0.2 },
  backhand: { attackSide: -1, guardLift: 0.5, guardCross: -0.8, hitPitch: 0.05, hitRoll: -0.22 },
  flank: { attackSide: 1, guardLift: 0.18, guardCross: 1, hitPitch: 0.02, hitRoll: 0.32 },
  rising: { attackSide: -1, guardLift: 0.65, guardCross: -0.45, hitPitch: -0.2, hitRoll: -0.12 },
};

function smoothRange(value: number, start: number, end: number): number {
  return THREE.MathUtils.smoothstep(value, start, end);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
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
  const bodyRest = {
    root: result.root?.quaternion.clone(), spine: result.spine?.quaternion.clone(),
    chest: result.chest?.quaternion.clone(), neck: result.neck?.quaternion.clone(),
    head: result.head?.quaternion.clone(),
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
  Object.assign(result, { bodyRest, armRest, legRest });
  return Object.values(result).every(Boolean) && Object.values(bodyRest).every(Boolean) && Object.values(armRest).every(Boolean) && Object.values(legRest).every(Boolean) ? result as CombatBones : null;
}

const boneOffsetEuler = new THREE.Euler();
const boneOffsetQuaternion = new THREE.Quaternion();

function setBoneOffset(bone: THREE.Bone, rest: THREE.Quaternion, x: number, y: number, z: number): void {
  boneOffsetEuler.set(x, y, z);
  boneOffsetQuaternion.setFromEuler(boneOffsetEuler);
  bone.quaternion.copy(rest).multiply(boneOffsetQuaternion);
}

function addBoneOffset(bone: THREE.Bone, x: number, y: number, z: number): void {
  boneOffsetEuler.set(x, y, z);
  boneOffsetQuaternion.setFromEuler(boneOffsetEuler);
  bone.quaternion.multiply(boneOffsetQuaternion);
}

/**
 * `legAuthority` is how much of the legs this layer still owns: 1 when the
 * fighter is only standing, down to 0 when a throw has authored the stance
 * itself. The lean and the hit reaction are never scaled — those are the
 * body's, whatever the feet have been told to do.
 */
function applyBalancePose(
  bones: CombatBones, pose: BalancePose, inCombat: boolean, legAuthority = 1,
): void {
  if (!inCombat) return;

  const authority = Math.max(0, Math.min(1, legAuthority));
  const leftStep = (pose.stepSide < 0 ? pose.step : 0) * authority;
  const rightStep = (pose.stepSide > 0 ? pose.step : 0) * authority;
  addBoneOffset(bones.root, pose.leanZ * 0.72, 0, -pose.leanX * 0.8);
  addBoneOffset(bones.spine, pose.leanZ * 0.34, 0, -pose.leanX * 0.28);
  addBoneOffset(bones.chest, -pose.leanZ * 0.16, 0, pose.leanX * 0.12);
  addBoneOffset(bones.neck, -pose.leanZ * 0.34, 0, pose.leanX * 0.38);
  addBoneOffset(bones.head, -pose.leanZ * 0.3, 0, pose.leanX * 0.3);
  const stance = pose.stance * 1.2 * authority;
  const crouch = (pose.crouch + pose.step * 0.05) * authority;
  addBoneOffset(bones.upperLegL, crouch - leftStep * 0.28, 0, stance + leftStep * 0.22);
  addBoneOffset(bones.lowerLegL, crouch * 1.45 + leftStep * 0.48, 0, 0);
  addBoneOffset(bones.footL, -crouch * 1.15 - leftStep * 0.2, 0, -stance * 0.8);
  addBoneOffset(bones.upperLegR, crouch - rightStep * 0.28, 0, -stance - rightStep * 0.22);
  addBoneOffset(bones.lowerLegR, crouch * 1.45 + rightStep * 0.48, 0, 0);
  addBoneOffset(bones.footR, -crouch * 1.15 - rightStep * 0.2, 0, stance * 0.8);
}

/**
 * Phases are normalized 0..1 progress through their own beat, or -1 when that
 * beat is not running. They come straight from the director's cue, so the
 * pose stays in step with a swing whose real duration varies by strategy.
 */
type CombatPoseInput = {
  attackPhase: number;
  /** The line the body is currently selling, which a feint changes mid-swing. */
  presentedLine: AttackLine;
  defensePhase: number;
  /**
   * 0..1 through a blow that is genuinely arriving, or -1. Separate from
   * `defensePhase`, which sizing up feeds too: a guard may go up whenever a
   * fighter feels like it, but a parry may only happen when there is something
   * to parry. See `PARRY_MEET`.
   */
  blockPhase: number;
  defenseSide: number;
  hitPhase: number;
  /** The line being received, used for guard and hit-reaction shaping. */
  line: AttackLine;
  intensity: number;
  deflected: boolean;
  combatStep: number;
};

/**
 * The two beats a block is made of, in the attacker's own phase, because that is
 * what the defender is given: the blow resolves at 0.46 and the sparks fly on
 * that frame.
 *
 * `PARRY_MEET` is the blade going out to meet the cut — 0.34 to 0.47 is about
 * 120 ms of the ~0.95 s swing, which is a reaction rather than a pose change.
 * `PARRY_JAR` is what comes back through the arms afterwards. Nothing here may
 * start before 0.34, because that is when the director first says `block`.
 */
const PARRY_MEET: Beat = [0.34, 0.47, 0.53, 0.74];
const PARRY_JAR: Beat = [0.47, 0.57, 0.64, 0.88];

/**
 * The sword arm at the moment the blades meet: shoulder driven up and across,
 * elbow all but straight, so the blade lies over the incoming cut instead of
 * standing upright beside the fighter's ear.
 *
 * Absolute angles rather than an offset, because this is the one pose in the
 * fight aimed at something outside the fighter. They were fitted against the
 * incoming percussion point measured on every line from both sides — the blade
 * passes within 0.21 m of it in all ten cases, canted 42° to 64° off vertical,
 * with the fighter's own head 0.76 m clear of its own edge.
 */
const PARRY_ARM = {
  shoulderPitch: -1.15,
  shoulderSwing: 1.23,
  shoulderRoll: -0.07,
  elbowPitch: -0.24,
  elbowSwing: 0,
  elbowRoll: 0.15,
} as const;

function applyCombatPose(bones: CombatBones, input: CombatPoseInput): void {
  const {
    attackPhase, presentedLine, defensePhase, blockPhase, defenseSide, hitPhase,
    line, intensity, deflected, combatStep,
  } = input;
  const attacking = attackPhase >= 0;
  const winding = attacking ? smoothRange(attackPhase, 0, 0.28) * (1 - smoothRange(attackPhase, 0.28, 0.58)) : 0;
  const cutting = attacking ? smoothRange(attackPhase, 0.28, 0.56) * (1 - smoothRange(attackPhase, 0.68, 1)) : 0;
  const impact = attacking ? smoothRange(attackPhase, 0.38, 0.54) * (1 - smoothRange(attackPhase, 0.62, 0.82)) : 0;
  const followThrough = attacking ? smoothRange(attackPhase, 0.54, 0.7) * (1 - smoothRange(attackPhase, 0.82, 1)) : 0;
  const lineMotion = COMBAT_LINE_MOTION[attacking ? presentedLine : line];
  const attackSide = lineMotion.attackSide;
  const guarding = defensePhase >= 0 ? smoothRange(defensePhase, 0, 0.22) * (1 - smoothRange(defensePhase, 0.68, 1)) : 0;
  /**
   * A guard is not a parry, and until this beat existed the fight only had the
   * former. Measured through a block, the defending blade stood still to the
   * centimetre from the moment it came up to the moment the exchange was over —
   * 17 degrees off vertical, and 1.6 m from where the sparks were flying. It was
   * reported from play as swords that stay vertical and sparks in mid-air, which
   * is exactly what one static near-vertical blade and a contact point on the
   * other fighter's sword look like.
   *
   * This is the beat that drives the blade out across the incoming cut and brings
   * it back; `PARRY_ARM` is where it goes.
   */
  const parrying = beat(blockPhase, PARRY_MEET);
  const parryJar = beat(blockPhase, PARRY_JAR);
  const hitShock = hitPhase >= 0 ? Math.sin(Math.min(1, hitPhase) * Math.PI) * intensity : 0;
  const deflection = deflected && attacking
    ? smoothRange(attackPhase, 0.46, 0.6) * (1 - smoothRange(attackPhase, 0.72, 0.96))
    : 0;
  const torsoTwist = attackSide * (winding * -0.58 + impact * 0.76 + followThrough * 0.28) +
    defenseSide * guarding * 0.2 + defenseSide * hitShock * 0.24 -
    attackSide * deflection * 0.34;

  // Meeting a cut is taken through the body, not just the arm: the fighter sets
  // into it as the blades meet and is rocked back by what comes through them.
  const brace = parrying * 0.05 - parryJar * 0.07;
  setBoneOffset(bones.root, bones.bodyRest.root, brace, torsoTwist * 0.28, 0);
  setBoneOffset(bones.spine, bones.bodyRest.spine, 0.04 + cutting * 0.1 - hitShock * lineMotion.hitPitch + brace * 0.8, torsoTwist * 0.52, attackSide * (winding - cutting) * 0.08 + hitShock * lineMotion.hitRoll * 0.45);
  setBoneOffset(bones.chest, bones.bodyRest.chest, 0.03 + cutting * 0.12 - hitShock * lineMotion.hitPitch * 1.15 + brace * 0.6, torsoTwist * 0.72, attackSide * (winding - cutting) * 0.13 + hitShock * lineMotion.hitRoll);
  setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08 + cutting * 0.08 - hitShock * 0.12, -torsoTwist * 0.46, defenseSide * guarding * 0.08);
  setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + hitShock * (0.08 + lineMotion.hitPitch * 0.6), -torsoTwist * 0.34, -defenseSide * guarding * 0.1 + hitShock * lineMotion.hitRoll * 0.7);

  // One-handed compass cut: the hilt loads near the sword-side ear, the
  // elbow stays bent, and the shoulder carries the blade through a compact arc.
  const rightShoulderForward = -0.3 - winding * 0.72 - impact * 0.2 + followThrough * 0.16 -
    guarding * (0.12 + lineMotion.guardLift * 0.24);
  const rightElbowBend = -0.5 - winding * 0.68 + impact * 0.3 + followThrough * 0.16 - guarding * 0.24;
  const shoulderPitch = rightShoulderForward + hitShock * 0.08;
  const shoulderSwing = attackSide * (0.1 + winding * 0.22 - impact * 0.38 - followThrough * 0.22) -
    defenseSide * guarding * (0.08 + Math.abs(lineMotion.guardCross) * 0.18) +
    attackSide * deflection * 0.28;
  const shoulderRoll = attackSide * (-0.05 - winding * 0.18 + impact * 0.26 + followThrough * 0.14);
  const elbowPitch = rightElbowBend + hitShock * 0.08;
  const elbowSwing = attackSide * (winding * 0.18 - impact * 0.28 - followThrough * 0.14);
  const elbowRoll = attackSide * (0.04 + winding * 0.08 - impact * 0.1 + guarding * 0.08);
  // The parry owns the sword arm for as long as it lasts, rather than adding to
  // whatever the guard was doing — the same rule the legs already follow, that
  // only one layer may own a limb. Added on top, it inherited the guard's own
  // `defenseSide` lean, which the arriving cut knows nothing about: a fighter
  // parrying from the far side of an exchange overshot by up to a metre while the
  // near side landed on 0.19 m. Blended to, one authored arm meets every line
  // from either side, all ten cases inside 0.21 m.
  //
  // The jar is pitch and nothing else. Given any of the cross-body angle to undo,
  // it drove the blade back through vertical while the parry was still decaying,
  // and the blade wobbled either side of upright on the way home instead of
  // settling: measured, 46° across the cut, then 2°, then 31° back the other way.
  // Recoil belongs in the joint the shock travels up.
  setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
    lerp(shoulderPitch, PARRY_ARM.shoulderPitch, parrying) - parryJar * 0.12,
    lerp(shoulderSwing, PARRY_ARM.shoulderSwing, parrying),
    lerp(shoulderRoll, PARRY_ARM.shoulderRoll, parrying),
  );
  setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
    lerp(elbowPitch, PARRY_ARM.elbowPitch, parrying) + parryJar * 0.22,
    lerp(elbowSwing, PARRY_ARM.elbowSwing, parrying),
    lerp(elbowRoll, PARRY_ARM.elbowRoll, parrying),
  );
  // The impact wrist mirrors with `attackSide`, like the rest of the arm chain.
  // The sword-side lines used to carry their own hand-tuned triple, which rolled
  // the blade back over the attacker's own shoulder at the moment of contact:
  // measured against the opponent, the percussion point sat 0.14 m *behind* the
  // attacker and 2 m out to the side, so sparks flew off the wrong fighter.
  const contactWristX = -1.2;
  const contactWristY = 0;
  const contactWristZ = -attackSide * 1.5;
  setBoneOffset(bones.handR, bones.armRest.handR,
    (-0.1 - winding * 0.22) * (1 - impact)  + contactWristX * impact + followThrough * 0.2 - deflection * 0.5,
    attackSide * (-0.12 - winding * 0.26) * (1 - impact) + contactWristY * impact - attackSide * followThrough * 0.12,
    attackSide * (0.12 + winding * 0.18) * (1 - impact)  + contactWristZ * impact + attackSide * followThrough * 0.3 - attackSide * deflection * 0.85,
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
  const legDrive = impact * 0.24 + followThrough * 0.08 - winding * 0.16 + guarding * 0.08 -
    hitShock * 0.04 + parrying * 0.06;
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

/**
 * Bone axes on the imported skeleton, measured rather than assumed. The Z-up to
 * Y-up conversion moves them, so every sign below was read off the rig by
 * applying one rotation at a time and recording where the hand ended up:
 *
 *   upper_arm/lower_arm  X−  swings the arm forward and up,  X+ back and up
 *   upper_arm            Z+  carries it across the body,     Z− out to the side
 *   lower_arm            X+  flexes the elbow, hand toward the shoulder
 *   root/spine/chest     Y+  coils away from the target,     Y− whips through
 *   root                 X+  pitches forward,                Z− leans right
 *   upper_leg            X+  takes the leg back,             X− strides it forward
 *   lower_leg            X+  bends the knee
 *
 * X reads the same on both arms; Y and Z mirror, which is the same rule the
 * sword lines follow.
 *
 * Those readings are one axis at a time. Two at once do not add up, because
 * these are Euler angles: `setBoneOffset` composes them in Three.js's default
 * XYZ order, so the later axes turn in a frame the earlier ones have already
 * moved. It matters most for the shoulder, where the arm is only ever above
 * the shoulder through a narrow band of angles — see `POSE_TUNING.armKeys`.
 */

type ThrowPoseInput = {
  throwType: ThrowType;
  /** 0..1 through the throwing motion, or -1 when no throw is running. */
  attackPhase: number;
  /** 0..1 through the aim that precedes it, or -1. */
  aimPhase: number;
  hitPhase: number;
  /** The line the incoming rock reads as, for the hit reaction. */
  line: AttackLine;
  intensity: number;
  combatStep: number;
};

function beat(phase: number, [inStart, inEnd, outStart, outEnd]: Beat): number {
  if (phase < 0) return 0;
  return smoothRange(phase, inStart, inEnd) * (1 - smoothRange(phase, outStart, outEnd));
}

/**
 * The drive behind every throw: coil away, open, whip through, follow through.
 * The three throws differ in when these land and how far they go, not in which
 * bones they use. When each one lands is `POSE_TUNING.throwBeats`.
 */
type ThrowDrive = { draw: number; stride: number; whip: number; follow: number };

const throwArmScratch: ThrowArmKey = { ...POSE_TUNING.ready };

/**
 * The arm pose partway between the two keys a phase falls between, where the
 * arc's two ends are the same `ready` pose: at phase 0 the arm is standing in
 * it, and at phase 1 it is back in it. Read rather than stored, so every arc a
 * fighter has starts and finishes in the one pose it waits in — two copies of it
 * would jump the arm whenever the fight called for a different motion.
 *
 * Shared by the throws and the stone strikes because the rule is the same one,
 * and it is the rule that matters: the shoulder only holds the arm above
 * shoulder height through a narrow band of Euler angles, so an arc has to be
 * keyed along its length rather than summed from beats.
 */
function keyedArmPose(
  keys: readonly ThrowArmKey[], ready: ThrowArmKey, phase: number, out: ThrowArmKey,
): ThrowArmKey {
  if (phase < 0) return Object.assign(out, ready);
  let index = 0;
  while (index < keys.length && phase > keys[index].at) index += 1;
  const from = index === 0 ? ready : keys[index - 1];
  const to = index === keys.length ? ready : keys[index];
  const blend = smoothRange(phase, index === 0 ? 0 : from.at, index === keys.length ? 1 : to.at);
  out.at = phase;
  out.upperX = from.upperX + (to.upperX - from.upperX) * blend;
  out.upperY = from.upperY + (to.upperY - from.upperY) * blend;
  out.upperZ = from.upperZ + (to.upperZ - from.upperZ) * blend;
  out.lowerX = from.lowerX + (to.lowerX - from.lowerX) * blend;
  out.handX = from.handX + (to.handX - from.handX) * blend;
  return out;
}

/** The throwing arm partway through one of the three throws. */
function throwArmPose(throwType: ThrowType, phase: number): ThrowArmKey {
  return keyedArmPose(
    POSE_TUNING.armKeys[throwType], POSE_TUNING.ready, phase, throwArmScratch,
  );
}

/**
 * One angle of the free arm: its own coefficients against the drives running
 * this frame. Unlike the throwing arm this one is a sum, and can be, because it
 * is a counterweight rather than an arc — see `FreeArmAngle` for which drives
 * each throw actually has, and for why the opening gets a beat of its own.
 */
function freeArmAngle(
  angle: FreeArmAngle,
  wind: number, whip: number, follow: number, aim: number, open: number,
): number {
  return angle.base + angle.wind * wind + angle.whip * whip +
    angle.follow * follow + angle.aim * aim + angle.open * open;
}

function throwDrive(throwType: ThrowType, phase: number): ThrowDrive {
  const beats = POSE_TUNING.throwBeats[throwType];
  return {
    draw: beat(phase, beats.draw),
    stride: beat(phase, beats.stride),
    whip: beat(phase, beats.whip),
    follow: beat(phase, beats.follow),
  };
}

/**
 * How far the hurler stands bladed: the **throwing-side** leg this far forward
 * of square and the other trailing that far behind it. A thrower waiting out a
 * gap stands across the line it throws on, and this is the pose it holds for
 * most of a fight — the throw itself is under a second of a cycle over two
 * seconds long. Standing square for the rest of it read as a fighter at
 * attention.
 *
 * Which leg is which is not a coin toss. A long throw is a step: the thrower
 * waits with its weight on the throwing-side leg and the other one behind, then
 * brings that trailing leg through and plants it as the rock goes. Standing
 * with the trailing leg already in front leaves nowhere to step to, and the
 * wind-up reads as a fighter lifting a knee on the spot.
 */
const HURLER_STANCE = 0.2;
/**
 * How much more knee the weighted leg carries than the free one. This is the
 * whole of "weight on the throwing-side leg" as far as the rig is concerned:
 * the loaded leg is the bent one, and because `drop` follows the lower foot,
 * bending it is also what puts that foot on the ground and lets the trailing
 * one hang light behind.
 */
const HURLER_LOAD = 0.1;
/** The two leg bones, read off the rig. What a reach costs is a fact about these. */
const THIGH_LENGTH = 0.79;
const SHIN_LENGTH = 0.72;
/** The knee every fighter stands with bent. */
const STANDING_KNEE = 0.24;
/**
 * The gather, separated out of the beats: the body leaning away from the target
 * and winding off it, given back the instant the stride starts down. `draw`
 * alone will not do it, because `draw` and `stride` overlap heavily and a lean
 * hung on `draw` is still there under a foot that has already planted.
 * Multiplying it out by the stride is what makes the gather a thing that ends.
 *
 * The legs used to ride this too and no longer do — they have their own beats,
 * for the reason given on `POSE_TUNING.hurlLegs`.
 */
function hurlGather(draw: number, stride: number): number {
  return draw * (1 - stride);
}

/**
 * Where the body goes during a hurl: forward along the throw, and down. Plus
 * how much of the fighter the throw currently owns, which is what tells the
 * balance controller to keep its hands off the legs.
 */
export type HurlStep = { forward: number; drop: number; engagement: number };

const hurlStepScratch: HurlStep = { forward: 0, drop: 0, engagement: 0 };

/**
 * How far the root pitches forward through a hurl, in radians.
 *
 * The root bone sits on the ground, not at the hips, so pitching it forward is
 * not bending at the waist — it swings the whole skeleton about the fighter's
 * feet, and the rear foot, being behind the pivot, goes up. The bend that reads
 * as bending lives in the spine and chest, which pivot where a spine does; this
 * only carries the hips through, which is a small thing.
 */
function hurlRootPitch(gather: number, stride: number, whip: number, follow: number): number {
  return -0.06 * gather + 0.04 * stride + 0.1 * whip + 0.14 * follow;
}

/**
 * How far the hips are wound off the target, in the units the root's yaw is
 * scaled from. Clockwise through the gather, then hard through square and on
 * into a left twist — the half that makes it a throw rather than a turn.
 *
 * Shared with the legs, which have to undo their share of it. The root turns
 * the whole skeleton about a point on the ground between the feet, so the hips
 * opening is also the planted foot being swept round, and only the leg can put
 * it back.
 */
function hurlHips(gather: number, stride: number, whip: number, follow: number): number {
  return 0.75 * gather + 0.3 * stride - 1.3 * whip - 0.4 * follow;
}

/** The four leg angles of a hurl, in radians. The left leg is the trailing one. */
type HurlLegs = { upperL: number; lowerL: number; upperR: number; lowerR: number };

const hurlLegsScratch: HurlLegs = { upperL: 0, lowerL: 0, upperR: 0, lowerR: 0 };

/**
 * The stance both hurl legs start and finish in, and which the two shorter
 * throws give back as they square up. Written as the pair the beats sum onto,
 * so a hurl at phase 0 and a hurler standing at phase −1 are the same pose —
 * otherwise every throw opens with a foot jumping to a new spot.
 */
const HURL_TRAIL_HIP = 0.06 + HURLER_STANCE;
const HURL_TRAIL_KNEE = STANDING_KNEE - HURLER_LOAD;
const HURL_SUPPORT_HIP = -0.06 - HURLER_STANCE;
const HURL_SUPPORT_KNEE = STANDING_KNEE + HURLER_LOAD;

/**
 * The legs of a hurl, shared between the pose and the hip drop that pays for
 * it. Written once because the drop is derived from these exact angles: two
 * copies would have the hips paying for a reach the legs are not making.
 *
 * The shape of it is a pitcher's, and it is a **step**. The fighter waits with
 * its weight on the throwing-side leg and the other trailing behind. That
 * trailing leg picks up, swings through under the body with the shin tucked —
 * the feet pass each other, which is what balances a body leaning back into its
 * wind — then reaches out and plants ahead of the fighter. The body travels
 * over that plant as the rock goes, and the leg it left behind extends and
 * lifts its heel driving it there. The recovery is the lead foot picking itself
 * up and stepping home.
 *
 * The tuck on the swinging knee is not decoration: it very nearly cancels the
 * hip lift above it, which is what leaves the shin hanging under the body
 * instead of sticking out in front of the fighter.
 */
function hurlLegs(phase: number, drive: ThrowDrive): HurlLegs {
  const out = hurlLegsScratch;
  // The legs have beats of their own, and `POSE_TUNING.hurlLegs` says why: a
  // foot must be off the ground before it travels, or it skates.
  const legBeats = POSE_TUNING.hurlLegs;
  const tuck = beat(phase, legBeats.tuck);
  const swing = beat(phase, legBeats.swing);
  const step = beat(phase, legBeats.step);
  const heel = beat(phase, legBeats.heel);
  const push = beat(phase, legBeats.drive);
  const home = beat(phase, legBeats.home);
  const { draw, stride, whip, follow } = drive;
  const hips = hurlHips(hurlGather(draw, stride), stride, whip, follow);
  // The trailing leg. Through behind → knee up under the body → planted out in
  // front, and then it holds, because the plant is the one thing in this motion
  // that is supposed to be still.
  //
  // The `hips` term is what holds it, and nothing in this file could have
  // predicted it. The root turns the whole skeleton about a point on the
  // ground, so the coil unwinding through the release sweeps the foot the
  // fighter is standing on round with it — a quarter of a metre of the lead
  // foot skating backwards, in a pose whose own arithmetic said it was planted.
  // The arithmetic here is planar and that is a rotation about the vertical.
  // It was found by measuring on the rig, and it is checked there.
  out.upperL = HURL_TRAIL_HIP -
    1.32 * swing - 0.62 * step + 0.11 * hips - 0.3 * home;
  out.lowerL = HURL_TRAIL_KNEE +
    0.45 * tuck + 1.25 * swing + 0.16 * step - 0.06 * whip + 0.6 * home;
  // The support leg. It holds the fighter up and does not move for the whole
  // wind — every centimetre it slides in that stretch is the one foot the
  // fighter is standing on skating. Then the plant takes the weight and this
  // one extends behind, heel first, and is allowed to drag: by then it is in
  // the air, and a trailing foot in the air is a drive rather than a slide.
  out.upperR = HURL_SUPPORT_HIP + 0.19 * step + 0.24 * push;
  out.lowerR = HURL_SUPPORT_KNEE - 0.1 * step + 0.2 * heel;
  return out;
}

/**
 * How far a leg at these angles carries its ankle up off the ground, and how
 * far back. Two bones swinging about a hip, worked out rather than approximated
 * with one: the knee is half the lift at a thrower's angles, and guessing it
 * away is what left the rear foot hanging.
 */
function ankleLift(upper: number, knee: number): number {
  return THIGH_LENGTH * (1 - Math.cos(upper)) + SHIN_LENGTH * (1 - Math.cos(upper + knee));
}

function ankleReach(upper: number, knee: number): number {
  return THIGH_LENGTH * Math.sin(upper) + SHIN_LENGTH * Math.sin(upper + knee);
}

/** What standing with that knee bent already costs, before any pose is asked for. */
const STANDING_LIFT = ankleLift(0.06, STANDING_KNEE);

/**
 * The step a hurl takes, in metres, and the hip drop that pays for it.
 *
 * The legs stride in angle, but angles alone leave a thrower rooted over one
 * spot and up on their toes — a long throw is thrown off the back leg through a
 * planted front foot, and the body has to actually go somewhere for that to
 * read. The director owns where a hurler stands, so this is carried as an
 * offset of the model inside its group rather than as movement.
 *
 * How far it can go is not a taste question. There is no IK here: the hips are
 * pinned to the terrain and the legs are two rigid bones, so a foot cannot
 * reach out and stay down — it travels an arc, and the only way to keep it on
 * the ground is to bring the hips to meet it.
 *
 * `drop` follows the **lower** of the two feet, which is the one standing on
 * the ground. That one rule covers the whole motion without a heel allowance to
 * hand-tune: through the wind the swinging foot is up around the knee and the
 * throwing-side leg is holding the fighter up, so the drop tracks that one;
 * from the plant on it is the lead foot that is down and the rear heel that is
 * in the air, so it tracks the lead. Whichever is lower is the one that must
 * not sink, and the other is free to fly.
 *
 * The bill is still why the travel is what it is. Ask for a step of much more
 * than this and the legs cannot hold either foot down through it, and the
 * crouch that buys it back releases lower than a pitch — which inverts the
 * ordering the three throws are read by.
 *
 * Everything is a pure function of the phase so `tools/render_rigwalker_throw.py`
 * can port it, and rides the same beats as the pose so the two cannot drift
 * apart. `hurlLegs.step` fades out by the end of the motion, so the body walks
 * itself back to the spot it holds while the lead foot steps home over it.
 *
 * Only the hurl travels: a pitch is thrown off a planted stance and a toss is
 * gone before the body has moved. The drop is not conditional, because the
 * bladed stance is not — it is owed whenever the hurler is standing in it.
 */
export function hurlStep(throwType: ThrowType, phase: number): HurlStep {
  const out = hurlStepScratch;
  const { draw, stride, whip, follow } = throwDrive(throwType, phase);
  const hurling = throwType === "hurl" && phase >= 0;
  // The body rides the same beat as the plant, because it is the plant: the
  // fighter travels over the foot it just put down. The whip is the last of it,
  // the hips going through as the rock leaves.
  out.forward = hurling ? 0.2 * beat(phase, POSE_TUNING.hurlLegs.step) + 0.1 * whip : 0;
  out.engagement = phase < 0 ? 0 : Math.max(draw, stride, whip, follow);
  const ready = 1 - out.engagement;
  const pitch = hurling ? hurlRootPitch(hurlGather(draw, stride), stride, whip, follow) : 0;
  // A pitch and a toss barely move their legs, and give the bladed stance back
  // as they throw, so the stance itself is what they owe for. It has to agree
  // with a hurl's phase 0 to the last decimal: this is the pose a hurler is
  // standing in the instant before a long throw starts.
  const legs = hurling
    ? hurlLegs(phase, { draw, stride, whip, follow })
    : Object.assign(hurlLegsScratch, {
      upperL: 0.06 + HURLER_STANCE * ready, lowerL: STANDING_KNEE - HURLER_LOAD * ready,
      upperR: -0.06 - HURLER_STANCE * ready, lowerR: STANDING_KNEE + HURLER_LOAD * ready,
    });
  // Each foot pays twice: the arc its own leg carries it up, and the arc the
  // root pitch swings it through, the rear foot being behind that pivot. Both
  // are measured against a leg already standing, or the crouch every fighter
  // stands in gets charged for twice.
  const standing = (upper: number, knee: number) =>
    ankleLift(upper, knee) - STANDING_LIFT + ankleReach(upper, knee) * Math.sin(pitch);
  out.drop = Math.min(
    standing(legs.upperL, legs.lowerL),
    standing(legs.upperR, legs.lowerR),
  );
  return out;
}

/**
 * A rock arriving is shaped like a cut arriving, so the reaction is shared with
 * the sword pose rather than rewritten. Added on top of a finished pose.
 */
function addHitReaction(
  bones: CombatBones, line: AttackLine, hitPhase: number, intensity: number,
): number {
  if (hitPhase < 0) return 0;
  const shock = Math.sin(Math.min(1, hitPhase) * Math.PI) * intensity;
  const motion = COMBAT_LINE_MOTION[line];
  addBoneOffset(bones.spine, -shock * motion.hitPitch, 0, shock * motion.hitRoll * 0.45);
  addBoneOffset(bones.chest, -shock * motion.hitPitch * 1.15, 0, shock * motion.hitRoll);
  addBoneOffset(bones.neck, -shock * 0.12, 0, 0);
  addBoneOffset(
    bones.head, shock * (0.08 + motion.hitPitch * 0.6), 0, shock * motion.hitRoll * 0.7,
  );
  addBoneOffset(bones.upperArmR, shock * 0.1, 0, 0);
  addBoneOffset(bones.upperArmL, shock * 0.1, 0, 0);
  return shock;
}

/**
 * The hurler's three throws. All three are the same overhand motion — the rock
 * goes back and up, the elbow leads it above the shoulder, the hand comes over
 * the top and lets go out in front and high, and the arm rides down across the
 * body — and they differ in how much of the fighter goes into it:
 *
 * - `hurl` is the whole body, and it is a spring rather than a swing — and a
 *   step. It waits with its weight on the throwing-side leg and the other one
 *   trailing behind. That trailing knee comes up and through with the shin
 *   tucked under while the body leans away and winds clockwise off the target;
 *   the feet pass each other, which is what balances the lean. Then that leg
 *   reaches out and plants ahead, the body travels over it, the hips open ahead
 *   of the shoulders, and everything unwinds straight through square and on
 *   into a left twist — a coil that only returns to neutral has spent itself
 *   stopping. The elbow folds to a right angle at the top of the wind and
 *   extends late, so the arm is one straight bar from shoulder to rock at
 *   release, with the wrist in line. It is slow, and it is why standing off is
 *   worth it.
 * - `pitch` is thrown off a planted stance: half the coil, no stride, no aiming
 *   arm, the arm doing the work.
 * - `toss` is a dart. The arm is up and gone before the body has moved, done
 *   before the wind-up of a hurl would have finished.
 *
 * The body runs on the four beats. The arm runs on `POSE_TUNING.armKeys`, for the
 * reason given there. Everything is written as an offset from the imported rest
 * pose, and every foot angle cancels the joints above it so the soles stay flat
 * on the ground.
 */
function applyThrowPose(bones: CombatBones, input: ThrowPoseInput): void {
  const { throwType, attackPhase, aimPhase, line, hitPhase, intensity, combatStep } = input;
  const { draw, stride, whip, follow } = throwDrive(throwType, attackPhase);
  // The aim settles rather than pulses: a hurler judging a gap is still.
  const aim = aimPhase >= 0 ? smoothRange(aimPhase, 0, 0.45) : 0;
  const ready = 1 - Math.max(draw, stride, whip, follow);

  const arm = throwArmPose(throwType, attackPhase);
  setBoneOffset(bones.upperArmR, bones.armRest.upperArmR, arm.upperX, arm.upperY, arm.upperZ);
  setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR, arm.lowerX, 0, 0);
  setBoneOffset(bones.handR, bones.armRest.handR, arm.handX, 0, 0);

  if (throwType === "hurl") {
    const gather = hurlGather(draw, stride);
    // The spring. Both wind clockwise away from the target and then unwind
    // straight through neutral into a left twist, which is the half that makes
    // it a throw rather than a turn: a body that only returns to square has
    // spent its coil stopping itself. The hips lead the shoulders out of the
    // gather, and the gap between these two is where the power is stored.
    const hip = hurlHips(gather, stride, whip, follow);
    const chest = 1 * gather + 0.7 * stride - 1.5 * whip - 0.5 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      hurlRootPitch(gather, stride, whip, follow),
      0.34 * hip,
      -0.1 * gather - 0.08 * stride + 0.08 * whip + 0.12 * follow);
    // Leans away over the gather and comes up straight through the release —
    // the wind-up is stored here, at joints that pivot where a spine does,
    // rather than at the root, which pivots at the soles.
    setBoneOffset(bones.spine, bones.bodyRest.spine,
      0.04 - 0.3 * gather + 0.1 * whip + 0.2 * follow,
      0.3 * chest, 0.06 * gather - 0.05 * follow);
    // Finishes bent over the front leg, the way a thrown-out arm ends.
    setBoneOffset(bones.chest, bones.bodyRest.chest,
      0.03 - 0.18 * gather + 0.12 * whip + 0.16 * follow,
      0.44 * chest, 0.05 * gather - 0.08 * follow);
    // The eyes stay on the target through the whole coil, both ways.
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08 - 0.06 * follow, -0.5 * chest, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + 0.08 * aim, -0.35 * chest, 0);

    // The counterweight arm. It lifts at the shoulder and carries the forearm
    // folded across the front of the chest, then drives down and open as the
    // body untwists — pulling that elbow down into the ribs is a good part of
    // what turns the shoulders through.
    //
    // The fold has to go *across*, not up. The elbow is what reads here: with
    // the upper arm low and the forearm cocked vertically the pose stops being
    // a counterweight and becomes a gesture, which is what it used to be. The
    // Z carries the whole arm over the centre line so the flexion lands the
    // hand in front of the sternum rather than beside the ear.
    //
    // Its coefficients are `POSE_TUNING.freeArm.hurl`, which is also where the
    // two traps behind them are written down: the wind is the *larger* of draw
    // and stride rather than their sum, and the opening leads the swing-back on
    // a beat of its own instead of riding the whip.
    setFreeArm(bones, "hurl",
      Math.max(draw, stride), whip, follow, aim, beat(attackPhase, POSE_TUNING.hurlLegs.open));

    const legs = hurlLegs(attackPhase, { draw, stride, whip, follow });
    setLegs(bones,
      legs.upperL + combatStep, legs.lowerL, legs.upperR - combatStep, legs.lowerR);
  } else if (throwType === "pitch") {
    const coil = 0.95 * draw + 0.7 * stride - 0.95 * whip - 0.4 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      -0.1 * draw + 0.18 * whip + 0.24 * follow, 0.16 * coil, -0.08 * draw + 0.1 * follow);
    setBoneOffset(bones.spine, bones.bodyRest.spine,
      0.04 + 0.05 * draw - 0.16 * follow, 0.17 * coil, 0);
    setBoneOffset(bones.chest, bones.bodyRest.chest,
      0.03 + 0.08 * draw - 0.22 * follow, 0.24 * coil, 0);
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08, -0.32 * coil, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + 0.06 * aim, -0.24 * coil, 0);

    // The free arm only counterbalances; there is no time to aim with it, and
    // its wind is the draw rather than a hurl's larger of two. Its elbow stays
    // loose for the same reason the hurl's does.
    //
    // The small `follow` on its Z is the same fault as the hurl's, caught by the
    // same check and a hundredth its size: without it the elbow grazes the torso
    // by 5 mm as the arm settles back into the guard.
    setFreeArm(bones, "pitch", draw, whip, follow, 0, 0);

    // Bladed while it waits, square once it throws: a pitch is thrown off a
    // planted stance, and its legs are authored for that. Carrying the stance
    // into the motion floats its trailing foot the way the hurl's used to. The
    // stance itself is the hurl's — throwing-side leg forward, weighted — so
    // that changing throw between two gaps does not change which foot is where.
    const upperL = 0.06 + HURLER_STANCE * ready +
      0.06 * draw - 0.1 * whip - 0.08 * follow + combatStep;
    const lowerL = STANDING_KNEE - HURLER_LOAD * ready +
      0.08 * draw + 0.06 * whip + 0.09 * follow;
    const upperR = -0.06 - HURLER_STANCE * ready +
      0.1 * draw + 0.08 * whip + 0.04 * follow - combatStep;
    const lowerR = STANDING_KNEE + HURLER_LOAD * ready +
      0.14 * draw + 0.13 * whip + 0.17 * follow;
    setLegs(bones, upperL, lowerL, upperR, lowerR);
  } else {
    const coil = 0.5 * draw - 0.45 * whip - 0.2 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      0.06 * draw + 0.12 * whip + 0.14 * follow, 0.1 * coil, 0);
    setBoneOffset(bones.spine, bones.bodyRest.spine,
      0.04 + 0.06 * draw - 0.08 * follow, 0.12 * coil, 0);
    setBoneOffset(bones.chest, bones.bodyRest.chest,
      0.03 + 0.05 * draw - 0.12 * follow, 0.16 * coil, 0);
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08, -0.2 * coil, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03, -0.16 * coil, 0);

    // A toss is gone before the body has moved, so its free arm has no wind and
    // nothing to aim with: it only gives a little back as the arm comes down.
    setFreeArm(bones, "toss", 0, whip, follow, 0, 0);

    const upperL = 0.06 + HURLER_STANCE * ready - 0.08 * whip + combatStep;
    const lowerL = STANDING_KNEE - HURLER_LOAD * ready + 0.14 * draw + 0.1 * whip;
    const upperR = -0.06 - HURLER_STANCE * ready + 0.08 * whip - combatStep;
    const lowerR = STANDING_KNEE + HURLER_LOAD * ready + 0.18 * draw + 0.14 * whip;
    setLegs(bones, upperL, lowerL, upperR, lowerR);
  }

  // Bladed and settled between throws: rock hand low at the hip, free hand up
  // across the chest, weight slightly back. Distinct at a glance from a
  // swordsman's guard, which is what tells the two units apart on the field.
  //
  // The free hand is carried up by the shoulder and across by its Z, not by
  // folding the elbow — a folded elbow at this height reads as a gesture rather
  // than a guard, and it is the pose a hurler holds for longest.
  if (ready > 0.001) {
    const readyArm = POSE_TUNING.readyArm;
    addBoneOffset(bones.root, 0, ready * 0.16, -ready * 0.05);
    addBoneOffset(bones.chest, 0, ready * 0.12, 0);
    addBoneOffset(bones.neck, 0, -ready * 0.16, 0);
    addBoneOffset(bones.upperArmL,
      ready * (readyArm.upperX + aim * readyArm.upperAim), 0, ready * readyArm.upperZ);
    addBoneOffset(bones.lowerArmL, ready * readyArm.lowerX, 0, 0);
  }

  addHitReaction(bones, line, hitPhase, intensity);
}

/**
 * The free arm, from the throw's own coefficients and the drives running this
 * frame. All three throws set the same three bones; only the numbers differ, and
 * they are all in `POSE_TUNING.freeArm` where the tool can reach them.
 */
function setFreeArm(
  bones: CombatBones, throwType: ThrowType,
  wind: number, whip: number, follow: number, aim: number, open: number,
): void {
  const pose = POSE_TUNING.freeArm[throwType];
  const angle = (name: "upperX" | "upperZ" | "lowerX") =>
    freeArmAngle(pose[name], wind, whip, follow, aim, open);
  setBoneOffset(bones.upperArmL, bones.armRest.upperArmL, angle("upperX"), 0, angle("upperZ"));
  setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL, angle("lowerX"), 0, pose.lowerZ);
  setBoneOffset(bones.handL, bones.armRest.handL, pose.handX, 0, 0);
}

/** Sets both legs and cancels each ankle, so the soles stay flat on the ground. */
function setLegs(
  bones: CombatBones, upperL: number, lowerL: number, upperR: number, lowerR: number,
): void {
  setBoneOffset(bones.upperLegL, bones.legRest.upperLegL, upperL, 0, 0.11);
  setBoneOffset(bones.lowerLegL, bones.legRest.lowerLegL, lowerL, 0, 0);
  setBoneOffset(bones.footL, bones.legRest.footL, -(upperL + lowerL), 0, -0.09);
  setBoneOffset(bones.upperLegR, bones.legRest.upperLegR, upperR, 0, -0.11);
  setBoneOffset(bones.lowerLegR, bones.legRest.lowerLegR, lowerR, 0, 0);
  setBoneOffset(bones.footR, bones.legRest.footR, -(upperR + lowerR), 0, 0.09);
}

/**
 * The close fight, when the rock in a hurler's hand stops being a missile.
 *
 * Every pose below was solved against the imported skeleton for a written-down
 * grip position, the same way the throw keys were, and the measurement that
 * shaped all of it is this: **the grip only reaches about 1.65 m in front of the
 * fighter.** A blade is 2.65 m of steel and a hurler has an arm. Two Rigwalkers
 * may not stand closer than `MIN_FIGHT_DISTANCE` without merging into one
 * silhouette, so the arm alone cannot cross the gap — which is why a stone strike
 * lunges, and why the four of them are ordered the way they are.
 *
 * They mirror how a weight in the hand is fought with:
 *
 * - `hammer` is the two-handed blow: both hands on the stone, up over the head,
 *   and straight down the centre line. Slowest, heaviest, and the one thing here
 *   that cannot be turned aside with an angle — it arrives from directly above.
 * - `swing` is the whole body. The stone loads out behind the right shoulder,
 *   the rear foot drives, the hips come round *ahead* of the shoulders, and the
 *   arm arrives last: the separation between hips and chest is where the power
 *   is, and it is the thing worth being able to see.
 * - `jab` is the patu's technique — a short thrust straight from the shoulder,
 *   which is what the Māori short clubs were actually used for and is unusual
 *   among clubs, most of which are swung like an axe. It commits to nothing.
 * - `punch` is what is left when there is no time to pick. The rock goes along
 *   for the ride.
 *
 * The free arm is the other half of it, and it is the same weapon the patu was
 * paired with: the off hand was wrapped in a thick woven mat and used to ward
 * blows off. Here it is a forearm, and it comes up alone against one blow and
 * alongside the other against two.
 */
const STONE_BEATS: Record<StoneStrike, {
  /** Coiling away, loading the weight. */
  load: Beat;
  /** The stone travelling. */
  drive: Beat;
  /** Arrival, which the director resolves between phase 0.46 and 0.54. */
  impact: Beat;
  /** What a heavy head does afterwards, which is most of why it costs anything. */
  recover: Beat;
}> = {
  hammer: {
    load: [0, 0.22, 0.3, 0.44], drive: [0.3, 0.5, 0.56, 0.7],
    impact: [0.36, 0.5, 0.56, 0.74], recover: [0.58, 0.76, 0.9, 1],
  },
  swing: {
    load: [0, 0.2, 0.28, 0.42], drive: [0.26, 0.46, 0.52, 0.66],
    impact: [0.34, 0.48, 0.54, 0.7], recover: [0.56, 0.74, 0.88, 1],
  },
  jab: {
    load: [0, 0.16, 0.22, 0.36], drive: [0.2, 0.42, 0.48, 0.62],
    impact: [0.3, 0.44, 0.5, 0.66], recover: [0.52, 0.7, 0.86, 1],
  },
  punch: {
    load: [0, 0.14, 0.18, 0.3], drive: [0.16, 0.38, 0.44, 0.58],
    impact: [0.28, 0.42, 0.48, 0.64], recover: [0.5, 0.66, 0.84, 1],
  },
};

/**
 * The stance the close fight is fought out of: the rock cocked at the shoulder
 * rather than hanging at the hip, and the free hand carried forward as a lead.
 * Both ends of every strike's arc, and the pose a hurler holds between them — so
 * it is what tells a player at a glance which fight this hurler thinks it is in,
 * and it is deliberately nothing like the throwing stance.
 *
 * Two things about it were reported from play and both are measurable, which is
 * why they are written down here rather than fixed by eye:
 *
 * - **The wrist is near neutral, and has to be.** The rock rides the wrist bone
 *   at `ROCK_IN_HAND`, so cocking the wrist swings the stone back along the
 *   forearm. At the 0.72 rad this used to carry, the rock sat at 0.80 of the way
 *   from elbow to fist — behind the hand, lying on the arm. The number to watch
 *   is that ratio: 1.0 is in the fist, and every strike's own keys are checked
 *   against it too.
 * - **The free hand stays on its own side.** Solved to a guard across the chest
 *   it ended up 0.12 m past the centre line with the forearm folded over the
 *   sternum, which reads as a fighter hugging itself rather than leading with a
 *   hand. It is a lead hand now: forward, a little across, mostly its own.
 * - **The stone elbow hangs, it does not wing out.** Solved for the grip alone,
 *   the shoulder abducted 1.15 rad to put the rock where it was asked for and
 *   left the elbow 0.69 m out to the side and only 0.30 m below the shoulder —
 *   a chicken-wing. Where the elbow rides is half of what a guard reads as: the
 *   same stone in the same place is carried very differently on an arm tucked at
 *   the ribs. It is 0.69 m below the shoulder now, near the throwing stance's
 *   0.75, with the forearm folded to carry the rock back up. Solving for the
 *   grip *and* the elbow together is what gets both.
 */
const STONE_STANCE_ARM: ThrowArmKey =
  { at: 0, upperX: -0.09, upperY: -0.24, upperZ: -0.5, lowerX: -1.95, handX: 0.04 };
const STONE_STANCE_FREE: ThrowArmKey =
  { at: 0, upperX: -0.91, upperY: -0.75, upperZ: 0.09, lowerX: -0.94, handX: 0.08 };
/** The forearm turned into the blow: elbow tucked, forearm up across the head. */
const STONE_GUARD_FREE: ThrowArmKey =
  { at: 0, upperX: -1.12, upperY: -0.29, upperZ: -0.47, lowerX: -1.58, handX: 0.17 };
/**
 * Both forearms in front of the face, elbows in. A boxer's high cover, and the
 * same answer for the same reason: when more is arriving than can be met one at
 * a time, you stop choosing and take it on the arms.
 */
const STONE_COVER_FREE: ThrowArmKey =
  { at: 0, upperX: -1.35, upperY: -0.54, upperZ: -0.04, lowerX: -2.01, handX: -0.38 };
const STONE_COVER_ARM: ThrowArmKey =
  { at: 0, upperX: -0.8, upperY: 0.47, upperZ: -0.78, lowerX: -1.94, handX: -0.54 };

/** The striking arm through each strike. Solved for the grip positions in the comments. */
const STONE_ARM_KEYS: Record<StoneStrike, ThrowArmKey[]> = {
  hammer: [
    { at: 0.2, upperX: -1.83, upperY: 0.67, upperZ: -2.01, lowerX: -1.78, handX: -1.09 },
    { at: 0.36, upperX: -0.95, upperY: 1.45, upperZ: -2.01, lowerX: -0.57, handX: -1.09 },
    { at: 0.5, upperX: -0.58, upperY: 1.59, upperZ: -1.45, lowerX: -0.43, handX: -1.09 },
    { at: 0.62, upperX: -0.04, upperY: 1.64, upperZ: -1.31, lowerX: -0.33, handX: -1.09 },
    { at: 0.78, upperX: 0.17, upperY: 1.64, upperZ: -1.02, lowerX: -0.26, handX: -1.09 },
  ],
  swing: [
    { at: 0.24, upperX: 0.68, upperY: -0.7, upperZ: -0.89, lowerX: -0.08, handX: 1.04 },
    { at: 0.42, upperX: 0.59, upperY: -0.11, upperZ: -1.95, lowerX: -1.12, handX: 1.04 },
    { at: 0.56, upperX: 0.42, upperY: 1.19, upperZ: -2.09, lowerX: -0.34, handX: -0.61 },
    { at: 0.68, upperX: 0.42, upperY: 1.8, upperZ: -1.91, lowerX: -0.52, handX: -0.61 },
    { at: 0.84, upperX: 0.56, upperY: 1.8, upperZ: -1.46, lowerX: -1.06, handX: -0.61 },
  ],
  jab: [
    { at: 0.24, upperX: 1.24, upperY: -0.41, upperZ: -0.85, lowerX: -2.17, handX: 0.65 },
    { at: 0.5, upperX: -0.62, upperY: 1.2, upperZ: -0.85, lowerX: -0.48, handX: -0.9 },
    { at: 0.74, upperX: 0.15, upperY: 0.04, upperZ: -0.81, lowerX: -1.93, handX: -0.23 },
  ],
  punch: [
    { at: 0.22, upperX: 0.29, upperY: -0.01, upperZ: -0.86, lowerX: -1.93, handX: 0.95 },
    { at: 0.46, upperX: -0.53, upperY: 1.35, upperZ: -0.86, lowerX: -0.36, handX: -0.75 },
    { at: 0.72, upperX: 0.25, upperY: 0.2, upperZ: -0.86, lowerX: -1.72, handX: -0.14 },
  ],
};

/**
 * The free hand joining the right one for the two-handed blow, keyed to the same
 * phases so the pair travel together. There is no IK here — the hands are not
 * welded, they are two arms told to be in the same place — so what this buys is
 * a silhouette that reads as both hands on the stone, which at RTS scale is the
 * whole of the claim.
 */
const STONE_HAMMER_FREE: ThrowArmKey[] = [
  // The first key only lifts; it does not cross yet. Solved to meet the right
  // hand at the load, this arm reached over the chest while the chest was still
  // turned into it and cleared the torso by two centimetres. The hands have
  // nothing to hold together until the stone is overhead anyway.
  { at: 0.2, upperX: -1.3, upperY: 0.3, upperZ: -0.9, lowerX: -0.6, handX: -0.15 },
  { at: 0.36, upperX: -1.6, upperY: 0.79, upperZ: -1.34, lowerX: -0.54, handX: -0.28 },
  { at: 0.5, upperX: -1.29, upperY: 0.79, upperZ: -0.78, lowerX: -0.23, handX: -0.28 },
  { at: 0.62, upperX: -0.69, upperY: 0.79, upperZ: -0.66, lowerX: -0.23, handX: -0.28 },
  { at: 0.78, upperX: -0.25, upperY: 0.79, upperZ: -0.65, lowerX: -0.23, handX: -0.28 },
];

/**
 * How far a strike carries the fighter forward, in metres. This is not
 * decoration: the arm reaches 1.65 m and the pair stands at nearly three, so
 * without it every stone strike resolves on nobody and throws its sparks into
 * the gap between them. A blow you step into is also what the technique is —
 * power comes off the back foot and travels.
 *
 * Sized like the hurl's step, and paid for the same way: `stoneLegs` is where
 * the angles live, and the drop that keeps the feet on the ground is derived
 * from those exact angles rather than guessed alongside them.
 */
const STONE_LUNGE: Record<StoneStrike, number> = {
  hammer: 0.46, swing: 0.4, jab: 0.35, punch: 0.26,
};

const stoneArmScratch: ThrowArmKey = { ...STONE_STANCE_ARM };
const stoneFreeScratch: ThrowArmKey = { ...STONE_STANCE_FREE };
const stoneLegsScratch: HurlLegs = { upperL: 0, lowerL: 0, upperR: 0, lowerR: 0 };
const stoneStepScratch: HurlStep = { forward: 0, drop: 0, engagement: 0 };

/** The four drives of a stone strike, or all zero when none is running. */
type StoneDrive = { load: number; drive: number; impact: number; recover: number };

function stoneDrive(strike: StoneStrike, phase: number): StoneDrive {
  const beats = STONE_BEATS[strike];
  return {
    load: beat(phase, beats.load),
    drive: beat(phase, beats.drive),
    impact: beat(phase, beats.impact),
    recover: beat(phase, beats.recover),
  };
}

/**
 * How far the hips are wound off the target through a strike. Positive is coiled
 * away, negative is whipped through — and every one of these goes further
 * negative than it went positive, because a body that only returns to square has
 * spent its coil stopping itself rather than delivering.
 *
 * Shared with the legs, which have to undo their share of it: the root turns the
 * whole skeleton about a point on the ground between the feet, so the hips
 * opening is the planted foot being swept round with them.
 */
function stoneHips(strike: StoneStrike, drive: StoneDrive): number {
  return STONE_BODY[strike].coil *
    (0.85 * drive.load - 1.15 * drive.impact - 0.4 * drive.recover);
}

/**
 * How much of the body each strike puts behind it: `coil` is the turn about the
 * spine and `fold` the bend over the front leg.
 *
 * Both are small numbers, and they have to be. The root and the spine carry the
 * arm with them, so a fold that looks modest as an angle is a metre at the end of
 * a reach: authored at a swordsman's cutting values times four, the jab's stone
 * arrived at the opponent's knees rather than its head, and the swing crossed a
 * metre and a half past the centre line before it landed. The sword's whole cut
 * is 0.1 rad of spine. These are read against that.
 */
const STONE_BODY: Record<StoneStrike, { coil: number; fold: number }> = {
  hammer: { coil: 0.3, fold: 1 },
  swing: { coil: 0.55, fold: 0.5 },
  jab: { coil: 0.42, fold: 0.35 },
  punch: { coil: 0.3, fold: 0.3 },
};

/**
 * The legs of a stone strike. The front leg blocks and the rear one drives,
 * which is the whole of where the power comes from: the torso whips around a
 * leg that has stopped moving.
 *
 * Written once because `stoneStep` derives its drop from these exact angles —
 * two copies would have the hips paying for a reach the legs are not making. The
 * bladed stance underneath is the throwing stance to the decimal, so a hurler
 * caught mid-fight does not change which foot it is standing on.
 */
function stoneLegs(drive: StoneDrive, hips: number): HurlLegs {
  const out = stoneLegsScratch;
  const { load, impact, recover } = drive;
  // The lead leg, throwing side and forward. It strides into the blow and then
  // holds: everything above it turns around this, which is where the power comes
  // from, and the stride is what the body travels over. The angle here and the
  // lunge in `STONE_LUNGE` have to be of a size with each other — the body is
  // translated bodily and there is no IK, so travel the legs do not make is a
  // foot sliding along the ground.
  out.upperR = -0.06 - HURLER_STANCE - 0.3 * impact - 0.08 * recover;
  out.lowerR = STANDING_KNEE + HURLER_LOAD + 0.16 * load + 0.2 * impact + 0.1 * recover;
  // The trailing leg, which loads under the coil and then extends behind as the
  // body goes over the front foot. Its `hips` term is the coil being undone —
  // nothing in the planar arithmetic here could predict it, because that is a
  // rotation about the vertical, and it is the same correction `hurlLegs` makes.
  out.upperL = 0.06 + HURLER_STANCE + 0.11 * hips + 0.1 * load + 0.34 * impact + 0.1 * recover;
  out.lowerL = STANDING_KNEE - HURLER_LOAD + 0.2 * load - 0.06 * impact;
  return out;
}

/**
 * Where a stone strike puts the body: forward along the blow, down by whatever
 * the legs cost, and how much of the fighter the strike currently owns.
 *
 * The same three answers `hurlStep` gives for the same three reasons, and read
 * once per frame for the same one: the pose, the balance layer's remaining
 * authority over the legs, and the model offset all have to come from one answer
 * or they fight each other. `drop` follows the **lower** of the two feet, which
 * is the one standing on the ground.
 */
export function stoneStep(strike: StoneStrike, phase: number): HurlStep {
  const out = stoneStepScratch;
  const drive = stoneDrive(strike, phase);
  out.engagement = phase < 0 ? 0 : Math.max(drive.load, drive.drive, drive.impact, drive.recover);
  // Out on the drive and the impact, home over the recovery: the fighter travels
  // over the foot it planted and then steps back onto the ground it holds.
  out.forward = phase < 0 ? 0
    : STONE_LUNGE[strike] *
      Math.min(1, 0.35 * drive.drive + drive.impact) * (1 - drive.recover);
  const legs = phase < 0
    ? Object.assign(stoneLegsScratch, {
      upperL: 0.06 + HURLER_STANCE, lowerL: STANDING_KNEE - HURLER_LOAD,
      upperR: -0.06 - HURLER_STANCE, lowerR: STANDING_KNEE + HURLER_LOAD,
    })
    : stoneLegs(drive, stoneHips(strike, drive));
  // The bladed stance is owed whenever the hurler is standing in it, so the two
  // branches have to agree at phase 0 — otherwise every strike opens with a foot
  // jumping to a new spot, which is invisible in a still and loud in motion.
  const standing = (upper: number, knee: number) => ankleLift(upper, knee) - STANDING_LIFT;
  out.drop = Math.min(
    standing(legs.upperL, legs.lowerL), standing(legs.upperR, legs.lowerR),
  );
  return out;
}

type StonePoseInput = {
  /** The strike running, or null when the hurler is standing and guarding. */
  strike: StoneStrike | null;
  attackPhase: number;
  /** 0..1 through a guard, or -1. Sizing up raises one as well as blocking does. */
  defensePhase: number;
  /** 0..1 through a blow genuinely arriving, or -1. See `PARRY_MEET`. */
  blockPhase: number;
  /**
   * How far up the second forearm is, 0..1. A blend rather than the cue's own
   * boolean, because a cover is held for as long as two bodies are on the
   * fighter and has to be raised and lowered rather than switched.
   */
  cover: number;
  defenseSide: number;
  hitPhase: number;
  line: AttackLine;
  intensity: number;
  combatStep: number;
};

/** Blends one arm toward a written-down pose, in place. */
function blendArm(out: ThrowArmKey, to: ThrowArmKey, amount: number): ThrowArmKey {
  if (amount <= 0) return out;
  out.upperX = lerp(out.upperX, to.upperX, amount);
  out.upperY = lerp(out.upperY, to.upperY, amount);
  out.upperZ = lerp(out.upperZ, to.upperZ, amount);
  out.lowerX = lerp(out.lowerX, to.lowerX, amount);
  out.handX = lerp(out.handX, to.handX, amount);
  return out;
}

function applyStonePose(bones: CombatBones, input: StonePoseInput): void {
  const {
    strike, attackPhase, defensePhase, blockPhase, cover, defenseSide,
    hitPhase, line, intensity, combatStep,
  } = input;
  const striking = strike !== null && attackPhase >= 0;
  const drive = striking
    ? stoneDrive(strike, attackPhase)
    : { load: 0, drive: 0, impact: 0, recover: 0 };
  const { load, impact, recover } = drive;
  const active = Math.max(load, drive.drive, impact, recover);
  const hips = striking ? stoneHips(strike, drive) : 0;
  const fold = striking ? STONE_BODY[strike].fold : 0;
  // A guard may go up whenever the fighter feels like it; a block only when
  // there is something to block. The same split the sword makes, for the reason
  // written on `PARRY_MEET` — driven off `defensePhase` alone, the arm swung at
  // thin air every time the fighter sized somebody up.
  const guarding = defensePhase >= 0
    ? smoothRange(defensePhase, 0, 0.22) * (1 - smoothRange(defensePhase, 0.72, 1)) * (1 - active)
    : 0;
  const meeting = beat(blockPhase, PARRY_MEET) * (1 - active);
  const jarring = beat(blockPhase, PARRY_JAR) * (1 - active);
  // The cover stands on its own rather than riding the guard beat. Multiplied
  // through `guarding`, it could only appear on the frames a blow was being
  // answered — so a posture meant to be held while two fighters worked the
  // hurler flashed on and off inside single exchanges. All a strike may do is
  // take the arms back for as long as it owns them.
  const covering = cover * (1 - active);
  const hitShock = hitPhase >= 0 ? Math.sin(Math.min(1, hitPhase) * Math.PI) * intensity : 0;

  // The body. The chest is given more of the coil than the hips and is given it
  // later, which is the separation the power is stored in: the hips come round
  // first and the shoulders are dragged after them.
  const chest = hips * 1.3;
  const brace = meeting * 0.06 - jarring * 0.08;
  const bend = (back: number, through: number, after: number) =>
    (-back * load + through * impact + after * recover) * fold;
  setBoneOffset(bones.root, bones.bodyRest.root,
    bend(0.04, 0.06, 0.07) + brace,
    0.3 * hips,
    bend(0.05, -0.04, 0) - defenseSide * guarding * 0.05);
  setBoneOffset(bones.spine, bones.bodyRest.spine,
    0.04 + bend(0.1, 0.09, 0.12) + brace * 0.8 -
      hitShock * COMBAT_LINE_MOTION[line].hitPitch,
    0.34 * chest,
    bend(-0.04, 0, 0.03) + hitShock * COMBAT_LINE_MOTION[line].hitRoll * 0.45);
  setBoneOffset(bones.chest, bones.bodyRest.chest,
    0.03 + bend(0.12, 0.1, 0.14) + brace * 0.6 +
      covering * 0.14 - hitShock * COMBAT_LINE_MOTION[line].hitPitch * 1.15,
    0.46 * chest,
    bend(-0.03, 0, 0.05) + hitShock * COMBAT_LINE_MOTION[line].hitRoll);
  // The eyes stay on what is being hit, both ways through the coil.
  setBoneOffset(bones.neck, bones.bodyRest.neck,
    0.08 - 0.05 * recover + covering * 0.1, -0.5 * chest, defenseSide * guarding * 0.06);
  setBoneOffset(bones.head, bones.bodyRest.head,
    -0.03 + covering * 0.12 + hitShock * (0.08 + COMBAT_LINE_MOTION[line].hitPitch * 0.6),
    -0.34 * chest,
    -defenseSide * guarding * 0.08 + hitShock * COMBAT_LINE_MOTION[line].hitRoll * 0.7);

  // The striking arm, and the free one. Only one layer may own a limb, so the
  // guard is blended toward rather than added on — added, it inherited whatever
  // the strike was doing and the arm ended up somewhere neither pose describes.
  const arm = striking
    ? keyedArmPose(STONE_ARM_KEYS[strike], STONE_STANCE_ARM, attackPhase, stoneArmScratch)
    : Object.assign(stoneArmScratch, STONE_STANCE_ARM);
  blendArm(arm, STONE_COVER_ARM, covering);
  setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
    arm.upperX + hitShock * 0.1, arm.upperY, arm.upperZ);
  setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR, arm.lowerX, 0, 0);
  setBoneOffset(bones.handR, bones.armRest.handR, arm.handX, 0, 0);

  // Two hands on the stone for the hammer and one for everything else, which is
  // the difference between the two-handed blow and the rest of them.
  const free = strike === "hammer" && striking
    ? keyedArmPose(STONE_HAMMER_FREE, STONE_STANCE_FREE, attackPhase, stoneFreeScratch)
    : Object.assign(stoneFreeScratch, STONE_STANCE_FREE);
  if (striking && strike === "swing") {
    // The counterweight. Pulling this elbow down and back is a good part of what
    // turns the shoulders through, and it is the half of the swing that happens
    // on the side the stone is not on.
    //
    // Its Z has to go **out** as the body comes round, not across. On this arm
    // negative Z is across the chest — the mirror of the striking arm, the same
    // rule the sword lines follow — and driven across through the whip the elbow
    // ended up 0.16 m inside the torso for a fifth of the strike. Invisible in a
    // silhouette, and the same fault `HURL_OPEN` exists to avoid one throw over.
    free.upperX += -0.3 * load + 0.45 * impact;
    free.upperZ += -0.15 * load + 0.68 * impact;
    free.lowerX += 0.2 * load - 0.15 * impact;
  }
  blendArm(free, STONE_GUARD_FREE, Math.max(guarding * 0.55, meeting));
  blendArm(free, STONE_COVER_FREE, covering);
  setBoneOffset(bones.upperArmL, bones.armRest.upperArmL,
    free.upperX + hitShock * 0.1 + jarring * 0.14,
    free.upperY - defenseSide * meeting * 0.12,
    free.upperZ);
  setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL, free.lowerX - jarring * 0.2, 0, 0);
  setBoneOffset(bones.handL, bones.armRest.handL, free.handX, 0, 0);

  const stanceLegs = striking
    ? stoneLegs(drive, hips)
    : Object.assign(stoneLegsScratch, {
      upperL: 0.06 + HURLER_STANCE, lowerL: STANDING_KNEE - HURLER_LOAD,
      upperR: -0.06 - HURLER_STANCE, lowerR: STANDING_KNEE + HURLER_LOAD,
    });
  setLegs(bones,
    stanceLegs.upperL + combatStep, stanceLegs.lowerL + guarding * 0.05,
    stanceLegs.upperR - combatStep, stanceLegs.lowerR + guarding * 0.05);
}

function resetCombatPose(bones: CombatBones): void {
  bones.root.quaternion.copy(bones.bodyRest.root);
  bones.spine.quaternion.copy(bones.bodyRest.spine);
  bones.chest.quaternion.copy(bones.bodyRest.chest);
  bones.neck.quaternion.copy(bones.bodyRest.neck);
  bones.head.quaternion.copy(bones.bodyRest.head);
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

/**
 * The corporate tint, one material per colour rather than one per painted mesh
 * per fighter.
 *
 * This used to clone on the spot, inside the traverse that finds the painted
 * parts. Eight parts a body at sixty-four a side is a thousand and twenty-four
 * distinct materials describing two colours, and the renderer sorts its draw
 * list by program and then by material — so every one of them was a state
 * change the frame had to pay for, to say a thing the material beside it had
 * already said.
 *
 * Sharing them is safe because nothing repaints a fighter while it is alive.
 * That is a standing rule here rather than an accident: a corpse sinks into the
 * dust instead of fading out precisely because its materials belong to every
 * other Rigwalker too.
 *
 * It is also what makes the army drawable in one call a part. Instances of a
 * single draw share one material by definition, so a per-fighter clone would
 * have split `RigwalkerBatch` back into a draw per fighter and undone the whole
 * point of it.
 */
const accentMaterials = new Map<string, THREE.MeshStandardMaterial>();

function accentMaterialFor(
  source: THREE.MeshStandardMaterial,
  accentColor: number,
): THREE.MeshStandardMaterial {
  // Keyed by the source too, not by the colour alone: the painted parts all
  // happen to come off one Blender material today, and a second one would
  // otherwise be handed the first one's tint.
  const key = `${source.uuid}:${accentColor}`;
  const existing = accentMaterials.get(key);
  if (existing) return existing;

  const material = source.clone();
  material.color.setHex(accentColor);
  material.emissive?.setHex(accentColor);
  accentMaterials.set(key, material);
  return material;
}

/**
 * Martian rock: an icosahedron with its vertices knocked about, flat shaded so
 * the facets catch the low sun. Built once and shared — a hurler holds one, the
 * effects pool flies them, and there may be dozens on the field.
 */
export function createRockGeometry(radius = 1, seed = 1): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  const position = geometry.attributes.position;
  const jitter = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    const wobble = Math.sin((index + seed) * 12.9898) * 43758.5453;
    const amount = 0.72 + (wobble - Math.floor(wobble)) * 0.5;
    jitter.fromBufferAttribute(position, index).multiplyScalar(amount);
    position.setXYZ(index, jitter.x, jitter.y * 0.86, jitter.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x59352a,
  roughness: 0.95,
  metalness: 0.04,
  flatShading: true,
});

// Sized from the rendered result rather than from plausibility, the way the
// sparks were: at gameplay zoom a rock under about a quarter of a metre is a
// three-pixel speck and the throw reads as a fighter miming one.
const heldRockGeometry = createRockGeometry(0.28, 3);
/**
 * Where the held rock sits in the wrist bone's own space. The hand bone runs
 * forward from the wrist, so local +Y is out through the palm.
 *
 * It has to clear the fist, and that is a measurement rather than a preference:
 * the rock is 0.56 m across and the hand is 0.28 m, with the hand mesh centred on
 * the wrist bone itself. At the 0.2 m this used to be, the rock's near face sat
 * 0.08 m *behind* the wrist — it swallowed the whole hand and poked back into the
 * forearm, which reads as a stone worn on the arm rather than held in the
 * fingers. Out here the fist overlaps the near side of it, which is a grip.
 *
 * Reported from play, and only once the close fight existed to report it from: a
 * throwing hurler carries this hand down at its hip where the rock is half hidden
 * against the body, and a fighting one holds it up at the shoulder and swings it
 * across the frame at head height.
 *
 * `tools/render_rigwalker_throw.py` has this number as `ROCK_IN_HAND` too, and
 * the release heights it checks are measured from it — so the two have to move
 * together or the tool starts validating a rock the game does not draw.
 */
const ROCK_IN_HAND = new THREE.Vector3(0, 0.32, 0);

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
    leftLeg.hip.rotation.z = 0;
    rightLeg.hip.rotation.z = 0;
    leftLeg.hip.position.x = -0.28;
    rightLeg.hip.position.x = 0.28;
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
    root.rotation.x = 0;
    root.rotation.z = stride * 0.025;
    head.rotation.y = Math.sin(elapsed * 1.1) * 0.07;
  }

  return { root, update };
}

export type RigwalkerOptions = {
  /** Defaults to melee, so every existing caller keeps the swordsman. */
  role?: CombatRole;
};

export function createRigwalker(
  asset: RigwalkerAsset | null = null,
  accentColor = 0xf29a3f,
  corporation = "Independent",
  /** Injected so a sim can seed temperaments and replay the same fight. */
  random: () => number = Math.random,
  options: RigwalkerOptions = {},
): Rigwalker {
  const role: CombatRole = options.role ?? "melee";
  const group = new THREE.Group();
  group.name = role === "hurler" ? "Rigwalker Hurler" : "Rigwalker";

  /**
   * What makes this unit step, look and settle on its own beat rather than in
   * lockstep with the rest of the line. It has to come off the seeded stream:
   * this was `group.id` — three.js's global object counter — until a second
   * camera in the sim shifted every id by one and moved every fighter in every
   * seeded fight. A fight that replays only while nothing else is added to the
   * scene does not replay. Drawn first, so where a unit falls in the stream is
   * what decides it, not how much geometry happens to exist by then.
   */
  const variation = Math.floor(random() * 997);

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
  // A full bar over every unit competes with the sparks and tells the player
  // nothing. It appears once the fighter has been hurt, or on selection.
  healthBar.visible = false;
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
  pipePivot.visible = !asset && role === "melee";
  group.add(pipePivot);

  const fallbackVisual = asset ? null : createFallbackVisual(accentColor);
  if (fallbackVisual) {
    group.add(fallbackVisual.root);
  }

  let mixer: THREE.AnimationMixer | null = null;
  let combatBones: CombatBones | null = null;
  // The skinned model, held so a throw can carry the body forward inside the
  // group without moving the position the director holds the unit at. Local +Z
  // is forward: the group's yaw is built from `atan2(direction.x, direction.z)`.
  let modelRoot: THREE.Object3D | null = null;
  let lungeOffset = 0;
  let lungeDrop = 0;
  let weaponVisual: THREE.Object3D | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let walkAction: THREE.AnimationAction | null = null;
  let combatAction: THREE.AnimationAction | null = null;
  let activeAction: THREE.AnimationAction | null = null;

  if (asset) {
    const model = asset.instantiate();
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && /Accent|Stripe|Shoulder|Knee|Toe/.test(object.name)) {
        object.material = accentMaterialFor(
          object.material as THREE.MeshStandardMaterial, accentColor,
        );
      }
    });
    group.add(model);
    modelRoot = model;
    combatBones = findCombatBones(model);
    weaponVisual = role === "hurler" ? null : model.getObjectByName("Broadsword") ?? null;
    if (weaponVisual) weaponVisual.visible = false;
    const carriedSword = role === "hurler" ? model.getObjectByName("Broadsword") : null;
    if (carriedSword) carriedSword.visible = false;
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

  // The held rock rides the wrist bone, so it inherits the whole arm chain and
  // is never positioned independently — the same rule the broadsword follows.
  // The hand bone runs forward from the wrist, so local +Y is the palm.
  let heldRock: THREE.Mesh | null = null;
  if (role === "hurler") {
    heldRock = new THREE.Mesh(heldRockGeometry, ROCK_MATERIAL);
    heldRock.name = "Rigwalker held rock";
    heldRock.castShadow = true;
    heldRock.visible = false;
    if (combatBones) {
      heldRock.position.copy(ROCK_IN_HAND);
      combatBones.handR.add(heldRock);
    } else {
      heldRock.position.set(0.68, 1.5, 0.1);
      group.add(heldRock);
    }
  }

  // Locate the blade's two ends from geometry rather than assuming an axis:
  // the Blender cylinder is authored along local Z, but the glTF Z-up to Y-up
  // conversion moves it, so we read the bounding box and let the body decide
  // which end is the tip.
  const bladeEndA = new THREE.Vector3();
  const bladeEndB = new THREE.Vector3();
  let bladeEndsFound = false;
  if (weaponVisual instanceof THREE.Mesh) {
    const geometry = weaponVisual.geometry as THREE.BufferGeometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      const size = box.getSize(new THREE.Vector3());
      const axis: "x" | "y" | "z" =
        size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
      box.getCenter(bladeEndA);
      bladeEndB.copy(bladeEndA);
      bladeEndA[axis] = box.min[axis];
      bladeEndB[axis] = box.max[axis];
      bladeEndsFound = true;
    }
  }

  let destination: THREE.Vector3 | null = null;
  /** Closest this unit has come to its waypoint, and how long since it improved. */
  let approachBestDistance = Number.POSITIVE_INFINITY;
  let approachStallElapsed = 0;
  /** True while a standing unit is seeing a shuffle for room through to the end. */
  let shufflingClear = false;
  let health = MAX_HEALTH;
  const combatProfile = createCombatProfile(random);
  let combatTarget: Rigwalker | null = null;
  let activeStrategy: CombatStrategy | null = null;
  /** Keeps a hurler standing like the throw it last loaded while it reloads. */
  let lastThrowType: ThrowType = "hurl";
  /**
   * Whether the rock in this hurler's hand is a weapon rather than a missile,
   * which decides its whole stance.
   *
   * Read off the gap rather than off the cue, because the cue only names a stone
   * strike on the frames the hurler is the one striking: blocking, being hit and
   * waiting between blows all carry the *attacker's* plan, and a stance that
   * flickered between the throwing pose and the fighting one on those frames
   * would jump several times an exchange.
   *
   * The band is the director's own — it turns a charge into a trade at
   * `STONE_RANGE` and lets that trade go at `STONE_RELEASE_RANGE` — so the
   * stance changes where the planning does, and the hysteresis comes free.
   */
  let closeFight = false;
  /** The strike being made, for the pose and for what the trail is drawn along. */
  let stoneStrike: StoneStrike | null = null;
  /** Keeps it standing like the strike it last made while it waits for the next. */
  let lastStoneStrike: StoneStrike = "swing";
  const restingFightDistance =
    role === "hurler" ? HURLER_FIGHT_DISTANCE : BASE_FIGHT_DISTANCE;
  let swinging = false;
  /**
   * How far through a block this fighter is, and how fast that was running, so a
   * parry can finish after the cue describing it has gone. -1 when none is.
   */
  let blockPlayhead = -1;
  /** A swing is 0.82 s to 1.08 s, so this is the middle of what a block runs at. */
  let blockRate = 1.05;
  let defenseSide = 1;
  /**
   * How far up the second forearm is. The director says whether two bodies are
   * on this fighter; how fast the arms answer that is presentation, and it has
   * to be a ramp — the condition flickers as attackers circle, and switched
   * straight through, the arm would strobe.
   */
  let coverBlend = 0;
  let hitReactionSide: -1 | 1 = 1;
  let defeatElapsed = -1;
  const defeatStartRotation = new THREE.Quaternion();
  const defeatTargetRotation = new THREE.Quaternion();
  const defeatRoll = new THREE.Quaternion();
  const defeatAxis = new THREE.Vector3();
  /** Where the corpse stood when it died, and how far the blow carries it. */
  const defeatStart = new THREE.Vector3();
  const defeatDrift = new THREE.Vector3();
  /** The line the last blow arrived on, or null when it did not have one. */
  let impactLine: THREE.Vector3 | null = null;
  let wasInCombat = false;
  let observedCombatTargetId: number | null = null;
  let observedEnemyDistance = Number.POSITIVE_INFINITY;
  let observedFightDistance = restingFightDistance;
  let distanceObservationElapsed = 0;
  let distanceObservationCount = 0;
  const balance = new BalanceController();
  let pendingBalanceImpactX = 0;
  let pendingBalanceImpactZ = 0;
  const targetRotation = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const movement = new THREE.Vector3();
  const desiredMovement = new THREE.Vector3();
  const combatDirection = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const proposedPosition = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const worldVelocity = new THREE.Vector3();
  const localVelocity = new THREE.Vector3();
  const inverseFacing = new THREE.Quaternion();
  const bladeEndScratch = new THREE.Vector3();
  const bladeTipScratch = new THREE.Vector3();
  const hiltScratch = new THREE.Vector3();
  const tipScratch = new THREE.Vector3();
  const contactScratch = new THREE.Vector3();
  const previousContact = new THREE.Vector3();
  const bladeVelocity = new THREE.Vector3();
  let hasPreviousContact = false;

  function sampleBlade(hilt: THREE.Vector3, tip: THREE.Vector3): boolean {
    // A stone strike has an edge worth trailing too: the forearm out to the rock
    // is the swept part of a hurler mid-swing, and it is what a block's sparks
    // should land on when a swordsman's cut is caught on it. Offered only while
    // a strike is actually running — a rock being wound up to be thrown is not a
    // weapon travelling through anything, and trailing it would draw a sword the
    // unit does not carry.
    if (heldRock && combatBones) {
      if (!stoneStrike) return false;
      combatBones.lowerArmR.getWorldPosition(hilt);
      heldRock.updateWorldMatrix(true, false);
      tip.setFromMatrixPosition(heldRock.matrixWorld);
      return true;
    }
    if (!weaponVisual || !bladeEndsFound) return false;
    weaponVisual.updateWorldMatrix(true, false);
    bladeEndScratch.copy(bladeEndA).applyMatrix4(weaponVisual.matrixWorld);
    bladeTipScratch.copy(bladeEndB).applyMatrix4(weaponVisual.matrixWorld);
    // Whichever end sits farther from the body is the tip; the bounding box
    // alone cannot say which way the blade points.
    const aIsTip = bladeEndScratch.distanceToSquared(group.position) >
      bladeTipScratch.distanceToSquared(group.position);
    hilt.copy(aIsTip ? bladeTipScratch : bladeEndScratch);
    tip.copy(aIsTip ? bladeEndScratch : bladeTipScratch);
    return true;
  }

  /**
   * Strikes land around the percussion point, not the very tip, so sparks fly
   * from where the blade would actually bite. A hurler has no blade: its strike
   * leaves from the rock in its hand.
   */
  function getContactPoint(out: THREE.Vector3): THREE.Vector3 {
    if (heldRock) {
      heldRock.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(heldRock.matrixWorld);
    }
    if (sampleBlade(hiltScratch, tipScratch)) {
      return out.copy(hiltScratch).lerp(tipScratch, 0.72);
    }
    return out.set(0, 2.4, 1.05).applyQuaternion(group.quaternion).add(group.position);
  }

  /** Chest height on the body itself: where a thrown rock arrives. */
  function getImpactPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 2.3, 0.18).applyQuaternion(group.quaternion).add(group.position);
  }

  function releaseRock(): boolean {
    if (!heldRock?.visible) return false;
    heldRock.visible = false;
    return true;
  }

  function getBladeVelocity(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(bladeVelocity);
  }

  function moveTo(nextDestination: THREE.Vector3): void {
    destination = nextDestination.clone();
    destination.y = 0;
    beginApproach();
  }

  /** A fresh attempt at the waypoint: nothing achieved yet, nothing given up on. */
  function beginApproach(): void {
    approachBestDistance = Number.POSITIVE_INFINITY;
    approachStallElapsed = 0;
  }

  /**
   * Whether the waypoint is taken: somebody alongside is standing between this
   * unit and it, and the ground in between is full of bodies rather than merely
   * busy. Being nearer the waypoint is what orders a crowd: the innermost unit
   * has nobody ahead of it, so it reaches the point and stops, and each unit
   * behind settles against the one in front rather than waiting on a neighbour
   * that is waiting back.
   *
   * Stalling alone is not enough. A batch walking abreast at one rally point
   * converges, and funnelling costs it a moment's ground with a neighbour right
   * there — a crowd it is not, and units that read it as one stop half a map
   * short of where they were sent.
   */
  function isWaypointTakenByCrowd(
    nearbyUnits: readonly Rigwalker[],
    distanceToWaypoint: number,
  ): boolean {
    if (!destination) return false;
    let blocked = false;
    let ahead = 0;
    for (const other of nearbyUnits) {
      if (other === rigwalker || !other.isAlive) continue;
      const otherToWaypoint = Math.hypot(
        destination.x - other.group.position.x,
        destination.z - other.group.position.z,
      );
      if (otherToWaypoint >= distanceToWaypoint) continue;
      ahead += 1;
      if (blocked) continue;
      const gap = Math.hypot(
        group.position.x - other.group.position.x,
        group.position.z - other.group.position.z,
      );
      if (gap <= CROWD_BLOCK_DISTANCE) blocked = true;
    }
    // Bodies pack about a clearance apart, so the ground already-arrived units
    // cover grows with the root of how many of them got there first. Compared
    // against the distance still to go, that is a fullness test: a handful of
    // units scattered across a long walk leaves plenty of room to keep going.
    return blocked &&
      distanceToWaypoint <= UNIT_CLEARANCE * (0.5 + Math.sqrt(ahead));
  }

  function setSelected(selected: boolean): void {
    selectionRing.visible = selected;
    healthBar.visible = selected || (health > 0 && health < MAX_HEALTH);
  }

  /** Swings the primitive fallback's pipe, which has no skeleton to drive it. */
  function poseFallbackWeapon(
    attackPhase: number,
    defensePhase: number,
    beatPreparation: boolean,
    presentedLine: AttackLine,
  ): void {
    if (!combatTarget) {
      pipePivot.position.set(0.52, 1.45, -0.42);
      pipePivot.rotation.set(0.12, 0, 0.2);
      return;
    }

    pipePivot.position.set(0.72, 1.65, 0.28);
    if (attackPhase < 0) {
      if (defensePhase >= 0) {
        const guard = Math.sin(defensePhase * Math.PI);
        pipePivot.rotation.set(1.22, defenseSide * 0.62, -0.48 + defenseSide * guard * 0.68);
      } else {
        pipePivot.rotation.set(0.65, 0.1, -0.9);
      }
      return;
    }

    const strike = Math.sin(attackPhase * Math.PI);
    const swing = smoothRange(attackPhase, 0.14, 0.64);
    if (beatPreparation) {
      const beat = Math.sin((attackPhase / 0.35) * Math.PI);
      pipePivot.rotation.set(1.05, defenseSide * (0.45 + beat * 0.5), -0.3);
      return;
    }
    switch (presentedLine) {
      case "overhead":
        pipePivot.rotation.set(1.35 - swing * 0.78, 0.1, -1.15 + swing * 1.75);
        break;
      case "forehand":
        pipePivot.rotation.set(1.15 - swing * 0.62, -0.9 + swing * 1.8, 0.9 - swing * 1.55);
        break;
      case "backhand":
        pipePivot.rotation.set(0.82 - strike * 0.22, -1.3 + swing * 2.6, -0.58);
        break;
      case "flank":
        pipePivot.rotation.set(0.45, 1.3 - swing * 2.6, -0.35 + strike * 0.3);
        break;
      default:
        pipePivot.rotation.set(1.45 - swing * 1.15, -0.55 + swing * 1.1, 0.55);
    }
  }

  /**
   * `line` is the horizontal direction the blow travelled in, given only when
   * the blow had one — a thrown rock. A cut does not: it arrives from a fighter
   * standing right there, and its own line is already carried by `side`.
   */
  function applyCombatDamage(
    damage: number, side: -1 | 1, line: THREE.Vector3 | null = null,
  ): void {
    if (health <= 0) return;
    // The visible reaction is driven by the cue each frame; this only records
    // the impulse the balance controller needs and the side to topple toward.
    hitReactionSide = side;
    impactLine = line ? (impactLine ?? new THREE.Vector3()).copy(line) : null;
    pendingBalanceImpactX += side * Math.min(0.38, 0.16 + damage / MAX_HEALTH * 0.55);
    pendingBalanceImpactZ -= Math.min(0.24, damage / MAX_HEALTH * 0.4);
    health = Math.max(0, health - damage);
    healthFill.scale.x = health / MAX_HEALTH;
    healthFill.position.x = -0.69 * (1 - health / MAX_HEALTH);
    healthBar.visible = health > 0;
    if (health === 0) {
      selectionRing.visible = false;
      defeatElapsed = 0;
      defeatStartRotation.copy(group.quaternion);
      defeatStart.copy(group.position);
      if (impactLine) {
        // Knocked down by the rock rather than folding up on the spot: tip the
        // body's up-axis over onto the line the rock came in on, and carry it a
        // little way along that line as it goes.
        //
        // The axis is `up × line`, so rotating about it swings up towards the
        // line; the roll is applied on the left of the start rotation because
        // it is a world direction, not one of the corpse's own axes.
        defeatAxis.set(0, 1, 0).cross(impactLine).normalize();
        defeatRoll.setFromAxisAngle(defeatAxis, 1.32);
        defeatTargetRotation.copy(defeatRoll).multiply(defeatStartRotation);
        defeatDrift.copy(impactLine).multiplyScalar(DEFEAT_KNOCKDOWN_DRIFT);
      } else {
        defeatRoll.setFromAxisAngle(DEFEAT_LOCAL_ROLL_AXIS, hitReactionSide * 1.32);
        defeatTargetRotation.copy(defeatStartRotation).multiply(defeatRoll);
        defeatDrift.set(0, 0, 0);
      }
    }
  }

  function update(
    delta: number,
    elapsed: number,
    terrainHeightAt: (x: number, z: number) => number,
    nearbyUnits: readonly Rigwalker[],
    obstacles: readonly NavigationObstacle[],
    cameraQuaternion: THREE.Quaternion,
    combatCue?: CombatCue,
  ): void {
    previousPosition.copy(group.position);
    if (health <= 0) {
      defeatElapsed += delta;
      const fallProgress = 1 - Math.exp(-5.5 * defeatElapsed);
      group.quaternion.slerpQuaternions(
        defeatStartRotation,
        defeatTargetRotation,
        fallProgress,
      );
      // Carried along the blow on the same curve it topples on, so the body
      // travels while it is going over rather than after it has landed.
      group.position.x = defeatStart.x + defeatDrift.x * fallProgress;
      group.position.z = defeatStart.z + defeatDrift.z * fallProgress;
      // The wreck lies where it fell, then settles into the dust. Materials are
      // shared between clones, so sinking is how a corpse leaves without
      // fading every other Rigwalker with it.
      const settling = Math.max(
        0, (defeatElapsed - (CORPSE_SECONDS - CORPSE_SINK_SECONDS)) / CORPSE_SINK_SECONDS,
      );
      group.position.y = THREE.MathUtils.damp(
        group.position.y, terrainHeightAt(group.position.x, group.position.z) + 0.2, 12, delta,
      ) - settling * 2.1;
      return;
    }

    const attackPhase = combatCue?.action === "attack" ? combatCue.phase : -1;
    const throwType: ThrowType | null =
      role === "hurler" && isThrow(combatCue?.strategy ?? null)
        ? (combatCue!.strategy as ThrowType)
        : null;
    // A hurler judging the gap is aiming, which is a pose of its own.
    const aimPhase = combatCue?.action === "size-up" ? combatCue.phase : -1;
    const line = combatCue?.line ?? "overhead";
    const presentedLine = combatCue?.feintLine && attackPhase >= 0 &&
      attackPhase < FEINT_REVEAL_PHASE ? combatCue.feintLine : line;
    const beatPreparation = combatCue?.strategy === "beat" && combatCue.action === "attack" &&
      combatCue.phase < 0.35;
    const defensePhase = combatCue?.action === "block" || combatCue?.action === "size-up"
      ? combatCue.phase
      : beatPreparation ? combatCue!.phase / 0.35 : -1;
    // Only a blow actually on its way. The director says `block` from 0.34 of the
    // attacker's swing, whether the outcome is a parry or a hit it has not landed
    // yet, so a fighter about to be hit reaches for the block and gets caught —
    // which is the pose it should be caught in.
    //
    // It is a playhead rather than the cue's own phase because the cue stops
    // describing a block the frame the outcome is known: a landed hit becomes
    // `hit` at 0.5 and a whiff falls back to sizing up at 0.46, and on that frame
    // the blade is at full stretch across the cut. Read straight through, a
    // full-amplitude pose vanished in one frame on every hit and every whiff. So
    // it follows the cue while there is one and keeps running at the rate it was
    // going, which plays `PARRY_MEET` and `PARRY_JAR` out to their authored end.
    if (combatCue?.action === "block") {
      if (blockPlayhead >= 0 && combatCue.phase > blockPlayhead && delta > 0) {
        blockRate = THREE.MathUtils.clamp(
          (combatCue.phase - blockPlayhead) / delta, 0.4, 4,
        );
      }
      blockPlayhead = combatCue.phase;
    } else if (blockPlayhead >= 0) {
      blockPlayhead += blockRate * delta;
      if (blockPlayhead >= 1) blockPlayhead = -1;
    }
    const blockPhase = blockPlayhead;
    coverBlend = THREE.MathUtils.damp(
      coverBlend, combatCue?.doubleGuard ? 1 : 0, 9, delta,
    );
    defenseSide = combatCue?.side ?? defenseSide;
    const hitPhase = combatCue?.action === "hit" ? combatCue.phase : -1;

    let moving = false;
    let travelSpeed = 0;
    // Distance this frame's step may cover, so closing cannot overshoot.
    let travelLimit = Number.POSITIVE_INFINITY;
    separation.set(0, 0, 0);

    combatTarget = combatCue?.targetId == null
      ? null
      : nearbyUnits.find((other) => other.combatId === combatCue.targetId && other.isAlive) ?? null;

    const separationRadius = combatTarget ? COMBAT_SEPARATION_RADIUS : SEPARATION_RADIUS;
    for (const other of nearbyUnits) {
      if (other === rigwalker || !other.isAlive) {
        continue;
      }

      radial.set(
        group.position.x - other.group.position.x,
        0,
        group.position.z - other.group.position.z,
      );
      const distance = radial.length();
      if (distance < separationRadius) {
        if (distance < 0.001) {
          const angle = (variation % 8) * (Math.PI / 4);
          radial.set(Math.cos(angle), 0, Math.sin(angle));
        } else {
          radial.divideScalar(distance);
        }
        separation.addScaledVector(
          radial,
          (separationRadius - distance) / separationRadius,
        );
      }
    }

    const inCombat = combatTarget !== null;
    activeStrategy = inCombat ? combatCue?.strategy ?? null : null;
    if (throwType) lastThrowType = throwType;
    swinging = inCombat && attackPhase >= 0;
    // Its own strike, not the one being made at it: the cue a defender is given
    // carries the attacker's plan, and a hurler must not be posed swinging
    // somebody else's stone.
    stoneStrike = role === "hurler" && combatCue?.plannerId === group.id &&
      isStoneStrike(combatCue.strategy)
      ? combatCue.strategy
      : null;
    if (stoneStrike) lastStoneStrike = stoneStrike;
    if (!inCombat && wasInCombat) {
      if (combatBones) resetCombatPose(combatBones);
      blockPlayhead = -1;
      // A fight leaves a unit somewhere it did not choose, so the walk back to
      // the waypoint is a new approach. Judging it against the ground it had
      // made before the fight would have it give up before it set off.
      beginApproach();
    }
    wasInCombat = inCombat;
    if (weaponVisual) weaponVisual.visible = inCombat;
    // The rock leaves the hand on the release event, and the hurler has another
    // in it by the time the motion is over. A stone strike is the one attack
    // that keeps hold of it — it is the weapon, not the ammunition — so only a
    // throw may take it out of the hand.
    if (heldRock && !(combatCue?.action === "attack" && isThrow(combatCue.strategy))) {
      heldRock.visible = true;
    }

    const enemyDistance = combatTarget
      ? group.position.distanceTo(combatTarget.group.position)
      : Number.POSITIVE_INFINITY;
    if (role === "hurler") {
      if (!combatTarget) closeFight = false;
      // Its own stone strike settles it outright, and so does a throw: a hurler
      // that is throwing is throwing, whatever the gap has done. Without that
      // second rule the gap alone decided, and a hurler tossing a pebble at
      // something three metres off — which is inside stone reach but is nobody
      // fighting it — was posed swinging a rock it was about to let go of.
      else if (stoneStrike) closeFight = true;
      else if (isThrow(combatCue?.strategy ?? null)) closeFight = false;
      // Otherwise the gap, on the director's own band, so the stance changes
      // where the planning does.
      else if (attackPhase < 0) {
        closeFight = enemyDistance <= (closeFight ? STONE_RELEASE_RANGE : STONE_RANGE);
      }
    }
    if (combatTarget) {
      const fightDistance = combatCue?.preferredDistance ?? restingFightDistance;
      if (observedCombatTargetId !== combatTarget.combatId) {
        observedCombatTargetId = combatTarget.combatId;
        observedEnemyDistance = enemyDistance;
        observedFightDistance = fightDistance;
        distanceObservationElapsed = 0.16 + ((variation * 37) % 17) / 100;
        distanceObservationCount = 0;
      } else {
        distanceObservationElapsed -= delta;
        if (distanceObservationElapsed <= 0) {
          observedEnemyDistance = enemyDistance;
          observedFightDistance = fightDistance;
          distanceObservationCount += 1;
          const spread = ((variation * 37 + distanceObservationCount * 61) % 100) / 100;
          distanceObservationElapsed = 0.18 + spread * 0.24;
        }
      }
      combatDirection.set(
        combatTarget.group.position.x - group.position.x, 0,
        combatTarget.group.position.z - group.position.z,
      ).normalize();
      const movementIntent = combatCue?.movement ?? "hold";
      const wantsToClose = movementIntent === "close" &&
        enemyDistance > observedFightDistance - COMBAT_DISTANCE_DEAD_ZONE;
      const wantsToRetreat = movementIntent === "retreat" &&
        enemyDistance < observedFightDistance + COMBAT_DISTANCE_DEAD_ZONE;
      travelSpeed = COMBAT_SHUFFLE_SPEED;
      if (movementIntent === "plant") {
        // Both feet are doing the throw. Nothing else moves.
        movement.set(0, 0, 0);
      } else if (observedEnemyDistance > observedFightDistance + COMBAT_DISTANCE_DEAD_ZONE ||
          wantsToClose) {
        movement.copy(combatDirection);
        moving = true;
        // A long approach is run, not shuffled: a swordsman crossing a hurler's
        // standoff at shuffle speed would never make up the ground.
        if (enemyDistance > COMBAT_RUN_DISTANCE) travelSpeed = MOVE_SPEED;
        // The decision runs on a deliberately stale reading, but the step is
        // clamped against the real gap. Walking through the opponent merges
        // two silhouettes into one blob and the fight stops reading.
        travelLimit = Math.max(0, enemyDistance - (fightDistance - COMBAT_DISTANCE_DEAD_ZONE));
      } else if (observedEnemyDistance < observedFightDistance - COMBAT_DISTANCE_DEAD_ZONE ||
          wantsToRetreat) {
        movement.copy(combatDirection).multiplyScalar(-1);
        moving = true;
        // Giving ground is slower than taking it, so a hurler kiting a
        // swordsman buys time rather than escaping outright.
        if (role === "hurler") travelSpeed = HURLER_BACKPEDAL_SPEED;
      } else if (movementIntent === "angle-left" || movementIntent === "angle-right") {
        movement.set(-combatDirection.z, 0, combatDirection.x)
          .multiplyScalar(movementIntent === "angle-left" ? 1 : -1);
        moving = true;
      } else {
        movement.set(0, 0, 0);
      }
      desiredMovement.copy(movement);
    } else {
      observedCombatTargetId = null;
      observedEnemyDistance = Number.POSITIVE_INFINITY;
      observedFightDistance = restingFightDistance;
    }

    if (!combatTarget && destination) {
      movement.set(
        destination.x - group.position.x,
        0,
        destination.z - group.position.z,
      );
      const distance = movement.length();

      if (distance <= ARRIVAL_DISTANCE) {
        destination = null;
      } else {
        if (distance < approachBestDistance - CROWD_ARRIVAL_PROGRESS) {
          approachBestDistance = distance;
          approachStallElapsed = 0;
        } else {
          approachBestDistance = Math.min(approachBestDistance, distance);
          approachStallElapsed += delta;
        }

        if (
          approachStallElapsed > CROWD_ARRIVAL_SECONDS &&
          isWaypointTakenByCrowd(nearbyUnits, distance)
        ) {
          destination = null;
        } else {
          moving = true;
          travelSpeed = MOVE_SPEED;
          movement.normalize();
          desiredMovement.copy(movement);
        }
      }
    }

    if (!moving) {
      // A standing unit takes a step to make room, but the step is a decision
      // rather than a per-frame reflex: a crowd is never perfectly still, and
      // testing the same threshold every frame starts and stops the walk at
      // frame rate. That is the stutter step. Once it starts making room it
      // finishes, and it does not start again for a nudge it can stand.
      const crowding = separation.length();
      shufflingClear = crowding > (shufflingClear ? SEPARATION_CLEAR : SEPARATION_NUDGE);
      if (shufflingClear) {
        moving = true;
        travelSpeed = SEPARATION_SPEED;
        movement.copy(separation).divideScalar(crowding);
        desiredMovement.copy(movement);
      }
    } else {
      shufflingClear = false;
      if (separation.lengthSq() > 0.001) {
        movement.addScaledVector(separation, 1.35).normalize();
      }
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
      const travel = Math.min(remainingDistance, travelLimit, travelSpeed * delta);
      group.position.addScaledVector(movement, travel);

      const targetAngle = combatTarget
        ? Math.atan2(combatDirection.x, combatDirection.z)
        : Math.atan2(movement.x, movement.z);
      targetRotation.setFromAxisAngle(upAxis, targetAngle);
      group.quaternion.slerp(targetRotation, 1 - Math.exp(-10 * delta));
    }

    // Only the primitive fallback shows this pipe. The Blender model carries a
    // Broadsword bone-parented to hand.R, which inherits the wrist chain from
    // applyCombatPose and needs no separate choreography.
    if (pipePivot.visible) {
      poseFallbackWeapon(attackPhase, defensePhase, beatPreparation, presentedLine);
    }

    const clearance = combatTarget ? COMBAT_CLEARANCE : UNIT_CLEARANCE;
    for (const other of nearbyUnits) {
      if (other === rigwalker || !other.isAlive) continue;
      radial.set(
        group.position.x - other.group.position.x,
        0,
        group.position.z - other.group.position.z,
      );
      const distance = radial.length();
      if (distance >= clearance) continue;
      if (distance < 0.001) {
        const angle = (variation % 8) * (Math.PI / 4);
        radial.set(Math.cos(angle), 0, Math.sin(angle));
      } else {
        radial.divideScalar(distance);
      }
      // Half the overlap each: the other unit resolves its own half on its own
      // update, so a pair separates without either being thrown clear.
      group.position.addScaledVector(radial, (clearance - distance) * 0.5);
    }

    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      terrainHeightAt(group.position.x, group.position.z) + 0.2,
      12,
      delta,
    );

    worldVelocity.copy(group.position).sub(previousPosition);
    if (delta > 0) worldVelocity.divideScalar(delta);
    inverseFacing.copy(group.quaternion).invert();
    localVelocity.copy(worldVelocity).applyQuaternion(inverseFacing);
    const attackLine = COMBAT_LINE_MOTION[line];
    const strikeLoad = attackPhase >= 0
      ? Math.sin(attackPhase * Math.PI) * (combatCue?.intensity ?? 0.72)
      : 0;
    const balancePose = balance.update({
      delta,
      localVelocityX: localVelocity.x,
      localVelocityZ: localVelocity.z,
      impactX: pendingBalanceImpactX,
      impactZ: pendingBalanceImpactZ,
      combatLoadX: combatTarget ? -attackLine.attackSide * strikeLoad * 0.11 : 0,
      combatLoadZ: combatTarget ? strikeLoad * 0.08 : 0,
    });
    pendingBalanceImpactX = 0;
    pendingBalanceImpactZ = 0;

    healthBar.quaternion.copy(group.quaternion).invert().multiply(cameraQuaternion);

    fallbackVisual?.update(delta, elapsed, moving);

    // Where the throw is putting the body, read once: the pose, the balance
    // layer's remaining authority over the legs, and the model offset all have
    // to come from the same answer or they fight each other.
    // Matched to the condition `applyThrowPose` runs under, not to whether a
    // throw is loaded — the drop pays for the bladed stance, and the hurler is
    // standing in that whenever it is posed as one.
    const step = combatTarget && role === "hurler"
      ? closeFight
        ? stoneStep(stoneStrike ?? lastStoneStrike, attackPhase)
        : hurlStep(throwType ?? lastThrowType, attackPhase)
      : EMPTY_HURL_STEP;

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
        const combatStep = moving ? Math.sin(elapsed * 5.8 + variation * 0.7) * 0.24 : 0;
        if (role === "hurler" && closeFight) {
          applyStonePose(combatBones, {
            // Between strikes it stands in the stance the last one left it in,
            // the same way a hurler between throws stands like the throw it last
            // loaded — the arc's two ends are one shared pose either way.
            strike: stoneStrike ?? lastStoneStrike,
            attackPhase,
            defensePhase,
            blockPhase,
            cover: coverBlend,
            defenseSide,
            hitPhase,
            line,
            intensity: combatCue?.intensity ?? 0.72,
            combatStep,
          });
        } else if (role === "hurler") {
          applyThrowPose(combatBones, {
            // Between throws the hurler still stands like one, so the ready
            // stance comes from the last throw it was loading.
            throwType: throwType ?? lastThrowType,
            attackPhase,
            aimPhase,
            hitPhase,
            line,
            intensity: combatCue?.intensity ?? 0.72,
            combatStep,
          });
        } else {
          applyCombatPose(combatBones, {
            attackPhase,
            presentedLine,
            defensePhase,
            blockPhase,
            defenseSide,
            hitPhase,
            line,
            intensity: combatCue?.intensity ?? 0.72,
            deflected: combatCue?.action === "attack" && combatCue.outcome === "blocked",
            combatStep,
          });
        }
      }
      // A throw authors its own stance, down to which foot carries the weight.
      // The balance controller's crouch and recovery steps are for a fighter
      // that is only standing; layered onto a stride they lifted the rear foot
      // clear of the ground and closed the split back up. Its lean and its hit
      // reactions still apply — it is only the legs it has to let go of.
      if (combatBones) {
        applyBalancePose(combatBones, balancePose, inCombat, 1 - step.engagement);
      }
    }

    // The step the hurl takes. Damped rather than written straight through: the
    // curve returns to zero on its own by the end of the motion, but a throw
    // re-planned mid-wind drops the phase to -1 in a single frame, and without
    // this the body would teleport back rather than settle.
    if (modelRoot) {
      lungeOffset = THREE.MathUtils.damp(lungeOffset, step.forward, 18, delta);
      lungeDrop = THREE.MathUtils.damp(lungeDrop, step.drop, 18, delta);
      modelRoot.position.set(0, -lungeDrop, lungeOffset);
      // The bar rides the body it belongs to. The selection ring does not: it
      // marks the ground the unit holds, which is the thing that has not moved.
      healthBar.position.z = lungeOffset;
    }

    // Sampled after the pose is applied so the direction reflects this frame's
    // arc. Effects use it to trail the shower along the cut.
    if (inCombat) {
      getContactPoint(contactScratch);
      if (hasPreviousContact && delta > 0) {
        bladeVelocity.copy(contactScratch).sub(previousContact).divideScalar(delta);
      } else {
        bladeVelocity.set(0, 0, 0);
      }
      previousContact.copy(contactScratch);
      hasPreviousContact = true;
    } else {
      hasPreviousContact = false;
      bladeVelocity.set(0, 0, 0);
    }
  }

  const rigwalker: Rigwalker = {
    group,
    corporation,
    combatId: group.id,
    combatProfile,
    role,
    get health() { return health; },
    maxHealth: MAX_HEALTH,
    get isAlive() { return health > 0; },
    get strategy() { return activeStrategy; },
    get canRemove() { return defeatElapsed >= CORPSE_SECONDS; },
    get isSwinging() { return swinging; },
    getContactPoint,
    getImpactPoint,
    releaseRock,
    getBladeVelocity,
    sampleBlade,
    applyCombatDamage,
    moveTo,
    setSelected,
    update,
  };
  return rigwalker;
}
