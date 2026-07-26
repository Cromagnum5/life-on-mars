import * as THREE from "three";
import { BalanceController, type BalancePose } from "./balance";
import type { RigwalkerAsset } from "./rigwalker-assets";
import {
  BASE_FIGHT_DISTANCE,
  HURLER_FIGHT_DISTANCE,
  createCombatProfile,
  isThrow,
  type AttackLine,
  type CombatCue,
  type CombatProfile,
  type CombatRole,
  type CombatStrategy,
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
  applyCombatDamage: (damage: number, side: -1 | 1) => void;
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
 * Hard floor on how close two bodies may end a frame. Steering alone cannot
 * hold a crowd apart: several units converging on one target push inward
 * faster than the separation drift pushes back, and they end up occupying the
 * same spot. This resolves the remaining overlap positionally.
 */
const UNIT_CLEARANCE = 1.15;
const COMBAT_CLEARANCE = 1.85;
const OBSTACLE_LOOKAHEAD = 1.4;
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

function applyBalancePose(bones: CombatBones, pose: BalancePose, inCombat: boolean): void {
  if (!inCombat) return;

  const leftStep = pose.stepSide < 0 ? pose.step : 0;
  const rightStep = pose.stepSide > 0 ? pose.step : 0;
  addBoneOffset(bones.root, pose.leanZ * 0.72, 0, -pose.leanX * 0.8);
  addBoneOffset(bones.spine, pose.leanZ * 0.34, 0, -pose.leanX * 0.28);
  addBoneOffset(bones.chest, -pose.leanZ * 0.16, 0, pose.leanX * 0.12);
  addBoneOffset(bones.neck, -pose.leanZ * 0.34, 0, pose.leanX * 0.38);
  addBoneOffset(bones.head, -pose.leanZ * 0.3, 0, pose.leanX * 0.3);
  const stance = pose.stance * 1.2;
  const crouch = pose.crouch + pose.step * 0.05;
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
  defenseSide: number;
  hitPhase: number;
  /** The line being received, used for guard and hit-reaction shaping. */
  line: AttackLine;
  intensity: number;
  deflected: boolean;
  combatStep: number;
};

function applyCombatPose(bones: CombatBones, input: CombatPoseInput): void {
  const {
    attackPhase, presentedLine, defensePhase, defenseSide, hitPhase,
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
  const hitShock = hitPhase >= 0 ? Math.sin(Math.min(1, hitPhase) * Math.PI) * intensity : 0;
  const deflection = deflected && attacking
    ? smoothRange(attackPhase, 0.46, 0.6) * (1 - smoothRange(attackPhase, 0.72, 0.96))
    : 0;
  const torsoTwist = attackSide * (winding * -0.58 + impact * 0.76 + followThrough * 0.28) +
    defenseSide * guarding * 0.2 + defenseSide * hitShock * 0.24 -
    attackSide * deflection * 0.34;

  setBoneOffset(bones.root, bones.bodyRest.root, 0, torsoTwist * 0.28, 0);
  setBoneOffset(bones.spine, bones.bodyRest.spine, 0.04 + cutting * 0.1 - hitShock * lineMotion.hitPitch, torsoTwist * 0.52, attackSide * (winding - cutting) * 0.08 + hitShock * lineMotion.hitRoll * 0.45);
  setBoneOffset(bones.chest, bones.bodyRest.chest, 0.03 + cutting * 0.12 - hitShock * lineMotion.hitPitch * 1.15, torsoTwist * 0.72, attackSide * (winding - cutting) * 0.13 + hitShock * lineMotion.hitRoll);
  setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08 + cutting * 0.08 - hitShock * 0.12, -torsoTwist * 0.46, defenseSide * guarding * 0.08);
  setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + hitShock * (0.08 + lineMotion.hitPitch * 0.6), -torsoTwist * 0.34, -defenseSide * guarding * 0.1 + hitShock * lineMotion.hitRoll * 0.7);

  // One-handed compass cut: the hilt loads near the sword-side ear, the
  // elbow stays bent, and the shoulder carries the blade through a compact arc.
  const rightShoulderForward = -0.3 - winding * 0.72 - impact * 0.2 + followThrough * 0.16 -
    guarding * (0.12 + lineMotion.guardLift * 0.24);
  const rightElbowBend = -0.5 - winding * 0.68 + impact * 0.3 + followThrough * 0.16 - guarding * 0.24;
  setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
    rightShoulderForward + hitShock * 0.08,
    attackSide * (0.1 + winding * 0.22 - impact * 0.38 - followThrough * 0.22) - defenseSide * guarding * (0.08 + Math.abs(lineMotion.guardCross) * 0.18) + attackSide * deflection * 0.28,
    attackSide * (-0.05 - winding * 0.18 + impact * 0.26 + followThrough * 0.14),
  );
  setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
    rightElbowBend + hitShock * 0.08,
    attackSide * (winding * 0.18 - impact * 0.28 - followThrough * 0.14),
    attackSide * (0.04 + winding * 0.08 - impact * 0.1 + guarding * 0.08),
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

/** A beat of the motion: fades in over the first pair, out over the second. */
type Beat = readonly [number, number, number, number];

function beat(phase: number, [inStart, inEnd, outStart, outEnd]: Beat): number {
  if (phase < 0) return 0;
  return smoothRange(phase, inStart, inEnd) * (1 - smoothRange(phase, outStart, outEnd));
}

/**
 * The drive behind every throw: coil away, open, whip through, follow through.
 * The three throws differ in when these land and how far they go, not in which
 * bones they use.
 */
type ThrowDrive = { draw: number; stride: number; whip: number; follow: number };

const THROW_BEATS: Record<ThrowType, Record<keyof ThrowDrive, Beat>> = {
  // A long wind: a full coil, a stride that opens the hips while the shoulders
  // stay shut, then everything unwinds at once.
  hurl: {
    draw: [0, 0.3, 0.34, 0.5],
    stride: [0.3, 0.46, 0.52, 0.64],
    // The whip is deliberately still climbing at the release phase, so the rock
    // leaves near the top of the arc rather than after the arm has come down.
    whip: [0.46, 0.6, 0.8, 0.94],
    follow: [0.66, 0.8, 0.9, 1],
  },
  // No stride and half the coil: a shoulder pitch thrown off a planted stance.
  pitch: {
    draw: [0, 0.24, 0.26, 0.4],
    stride: [0.18, 0.3, 0.34, 0.46],
    whip: [0.3, 0.44, 0.52, 0.7],
    follow: [0.44, 0.58, 0.8, 1],
  },
  // Barely a wind at all: the elbow and the wrist do all of it.
  toss: {
    draw: [0, 0.18, 0.2, 0.34],
    stride: [0.1, 0.2, 0.24, 0.36],
    whip: [0.2, 0.32, 0.4, 0.58],
    // Kept moving through the whole recovery: a flick that freezes after the
    // release reads as a dropped frame at RTS scale.
    follow: [0.32, 0.44, 0.62, 0.95],
  },
};

function throwDrive(throwType: ThrowType, phase: number): ThrowDrive {
  const beats = THROW_BEATS[throwType];
  return {
    draw: beat(phase, beats.draw),
    stride: beat(phase, beats.stride),
    whip: beat(phase, beats.whip),
    follow: beat(phase, beats.follow),
  };
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
 * The hurler's three throws. Each is one continuous motion driven by the same
 * four beats, and each is a different way of getting a rock moving:
 *
 * - `hurl` is the whole body. The rock is drawn back past the ear over a coiled
 *   torso, the left arm points out at the target, the front foot strides, the
 *   hips open ahead of the shoulders, and the arm slings over the top with the
 *   wrist last. It is slow, and it is why standing off is worth it.
 * - `pitch` is the arm and shoulder only, thrown from a three-quarter slot off
 *   a planted stance. Half the coil, no stride, no aiming arm.
 * - `toss` is a flick from the hip: elbow and wrist, underhand, weight centred,
 *   done before the wind-up of a hurl would have finished.
 *
 * Everything is written as an offset from the imported rest pose, and every
 * foot angle cancels the joints above it so the soles stay flat on the ground.
 */
function applyThrowPose(bones: CombatBones, input: ThrowPoseInput): void {
  const { throwType, attackPhase, aimPhase, line, hitPhase, intensity, combatStep } = input;
  const { draw, stride, whip, follow } = throwDrive(throwType, attackPhase);
  // The aim settles rather than pulses: a hurler judging a gap is still.
  const aim = aimPhase >= 0 ? smoothRange(aimPhase, 0, 0.45) : 0;
  const ready = 1 - Math.max(draw, stride, whip, follow);

  if (throwType === "hurl") {
    // Hips lead the shoulders. The separation between the two during the stride
    // is what makes a throw read as a throw rather than an arm swing.
    const hip = 0.85 * draw + 0.15 * stride - 0.9 * whip - 0.6 * follow;
    const chest = 1 * draw + 0.9 * stride - 1 * whip - 0.5 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      -0.16 * draw + 0.04 * stride + 0.1 * whip + 0.12 * follow,
      0.34 * hip,
      -0.14 * draw - 0.08 * stride + 0.08 * whip + 0.12 * follow);
    setBoneOffset(bones.spine, bones.bodyRest.spine,
      0.04 + 0.1 * draw - 0.22 * follow, 0.3 * chest, 0.06 * draw - 0.05 * follow);
    setBoneOffset(bones.chest, bones.bodyRest.chest,
      0.03 + 0.16 * draw - 0.26 * follow, 0.44 * chest, 0.05 * draw - 0.08 * follow);
    // The eyes stay on the target through a coil of nearly sixty degrees.
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08 - 0.06 * follow, -0.5 * chest, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + 0.08 * aim, -0.35 * chest, 0);

    setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
      -0.35 + 1.35 * draw + 1.05 * stride - 1.55 * whip + 0.85 * follow,
      0.85 * draw + 0.7 * stride - 1.1 * whip - 0.5 * follow,
      -0.3 - 0.55 * draw - 0.15 * stride - 0.35 * whip + 0.95 * follow);
    setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
      -0.45 + 1.5 * draw + 1.35 * stride - 0.25 * whip + 0.55 * follow,
      0, 0.2 * draw + 0.45 * follow);
    // Last link in the chain, and the fastest: the wrist is still cocked at the
    // top of the whip and has snapped through by the time the rock is gone.
    setBoneOffset(bones.handR, bones.armRest.handR,
      0.55 * draw + 0.4 * stride - 0.85 * whip - 0.25 * follow,
      0, -0.2 * draw + 0.3 * follow);

    // The aiming arm: raised at the target through the wind, then pulled down
    // hard into the ribs, which is what the throwing shoulder rotates around.
    setBoneOffset(bones.upperArmL, bones.armRest.upperArmL,
      -0.3 - 1.35 * draw - 1.45 * stride + 1.15 * whip + 0.9 * follow - 0.35 * aim,
      0, -0.1 - 0.25 * stride + 0.2 * follow);
    setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL,
      -0.35 - 0.55 * draw - 0.6 * stride + 0.9 * whip + 1 * follow - 0.3 * aim,
      0, -0.05);
    setBoneOffset(bones.handL, bones.armRest.handL, -0.06, 0, 0);

    // Left leg strides out and takes the weight; the right trails and its knee
    // folds instead of its heel lifting.
    const upperL = -0.06 + 0.14 * draw - 0.22 * stride - 0.22 * whip - 0.14 * follow + combatStep;
    const lowerL = 0.24 + 0.16 * draw + 0.14 * stride + 0.08 * whip + 0.14 * follow;
    const upperR = 0.06 + 0.2 * draw + 0.26 * stride + 0.16 * whip + 0.07 * follow - combatStep;
    const lowerR = 0.24 + 0.26 * draw + 0.1 * stride + 0.1 * whip + 0.08 * follow;
    setLegs(bones, upperL, lowerL, upperR, lowerR);
  } else if (throwType === "pitch") {
    const coil = 0.95 * draw + 0.7 * stride - 0.95 * whip - 0.4 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      -0.1 * draw + 0.22 * whip + 0.3 * follow, 0.16 * coil, -0.08 * draw + 0.1 * follow);
    setBoneOffset(bones.spine, bones.bodyRest.spine,
      0.04 + 0.05 * draw - 0.12 * follow, 0.17 * coil, 0);
    setBoneOffset(bones.chest, bones.bodyRest.chest,
      0.03 + 0.08 * draw - 0.16 * follow, 0.24 * coil, 0);
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08, -0.32 * coil, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03 + 0.06 * aim, -0.24 * coil, 0);

    // A three-quarter slot: the elbow stays out at shoulder height rather than
    // going over the top, so the arc is visibly flatter than a hurl's.
    setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
      -0.35 + 0.85 * draw + 0.62 * stride - 1.05 * whip - 0.5 * follow,
      0.5 * draw + 0.4 * stride - 0.7 * whip - 0.3 * follow,
      -0.85 - 0.3 * draw + 1.15 * whip + 0.7 * follow);
    setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
      -0.45 + 1.1 * draw + 0.95 * stride - 0.7 * whip + 0.4 * follow,
      0, 0.15 * draw + 0.3 * follow);
    setBoneOffset(bones.handR, bones.armRest.handR,
      0.4 * draw + 0.3 * stride - 0.6 * whip - 0.15 * follow, 0, 0.2 * follow);

    // The free arm only counterbalances; there is no time to aim with it.
    setBoneOffset(bones.upperArmL, bones.armRest.upperArmL,
      -0.32 - 0.3 * draw + 0.45 * whip + 0.55 * follow, 0, -0.08);
    setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL,
      -0.5 - 0.2 * draw + 0.35 * whip + 0.45 * follow, 0, -0.05);
    setBoneOffset(bones.handL, bones.armRest.handL, -0.06, 0, 0);

    const upperL = -0.02 + 0.06 * draw - 0.1 * whip - 0.08 * follow + combatStep;
    const lowerL = 0.24 + 0.08 * draw + 0.06 * whip + 0.09 * follow;
    const upperR = 0.02 + 0.1 * draw + 0.08 * whip + 0.04 * follow - combatStep;
    const lowerR = 0.24 + 0.14 * draw + 0.13 * whip + 0.17 * follow;
    setLegs(bones, upperL, lowerL, upperR, lowerR);
  } else {
    const coil = 0.5 * draw - 0.45 * whip - 0.2 * follow;
    setBoneOffset(bones.root, bones.bodyRest.root,
      0.06 * draw + 0.12 * whip + 0.14 * follow, 0.1 * coil, 0);
    setBoneOffset(bones.spine, bones.bodyRest.spine, 0.04 + 0.06 * draw, 0.12 * coil, 0);
    setBoneOffset(bones.chest, bones.bodyRest.chest, 0.03 + 0.05 * draw, 0.16 * coil, 0);
    setBoneOffset(bones.neck, bones.bodyRest.neck, 0.08, -0.2 * coil, 0);
    setBoneOffset(bones.head, bones.bodyRest.head, -0.03, -0.16 * coil, 0);

    // Underhand from the hip. The shoulder barely travels; the read is the
    // elbow opening and the wrist flicking up, so both are given full range.
    setBoneOffset(bones.upperArmR, bones.armRest.upperArmR,
      -0.05 + 0.55 * draw + 0.35 * stride - 0.8 * whip - 0.55 * follow,
      0.2 * draw - 0.3 * whip,
      -0.34 - 0.14 * draw + 0.1 * whip + 0.3 * follow);
    setBoneOffset(bones.lowerArmR, bones.armRest.lowerArmR,
      -0.3 + 0.5 * draw + 0.35 * stride - 0.15 * whip + 0.25 * follow,
      0, 0.08 * draw);
    setBoneOffset(bones.handR, bones.armRest.handR,
      0.7 * draw + 0.5 * stride - 1.05 * whip - 0.2 * follow, 0, 0.1 * follow);

    setBoneOffset(bones.upperArmL, bones.armRest.upperArmL, -0.34 + 0.14 * whip, 0, -0.1);
    setBoneOffset(bones.lowerArmL, bones.armRest.lowerArmL, -0.62 + 0.12 * whip, 0, -0.06);
    setBoneOffset(bones.handL, bones.armRest.handL, -0.06, 0, 0);

    const upperL = -0.02 - 0.08 * whip + combatStep;
    const lowerL = 0.26 + 0.14 * draw + 0.1 * whip;
    const upperR = 0.02 + 0.08 * whip - combatStep;
    const lowerR = 0.26 + 0.18 * draw + 0.14 * whip;
    setLegs(bones, upperL, lowerL, upperR, lowerR);
  }

  // Bladed and settled between throws: rock hand low at the hip, free hand up
  // across the chest, weight slightly back. Distinct at a glance from a
  // swordsman's guard, which is what tells the two units apart on the field.
  if (ready > 0.001) {
    addBoneOffset(bones.root, 0, ready * 0.16, -ready * 0.05);
    addBoneOffset(bones.chest, 0, ready * 0.12, 0);
    addBoneOffset(bones.neck, 0, -ready * 0.16, 0);
    addBoneOffset(bones.upperArmL, -ready * (0.1 + aim * 0.5), 0, 0);
    addBoneOffset(bones.lowerArmL, -ready * (0.25 + aim * 0.35), 0, 0);
  }

  addHitReaction(bones, line, hitPhase, intensity);
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
const cachedRockGeometry = createRockGeometry(0.2, 11);

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
  // A full bar over every unit competes with the sparks and tells the player
  // nothing. It appears once the fighter has been hurt, or on selection.
  healthBar.visible = false;
  group.add(healthBar);

  // A hurler carries its ammunition where it can be seen: a couple of rocks on
  // the hip. At RTS scale that satchel, and the empty sword hand, are how the
  // player tells the two units apart before either has done anything.
  const rockCache = new THREE.Group();
  rockCache.name = "Rigwalker rock cache";
  rockCache.visible = role === "hurler";
  if (role === "hurler") {
    for (const [offset, tilt] of [
      [new THREE.Vector3(-0.46, 1.46, -0.2), 0.6],
      [new THREE.Vector3(-0.36, 1.24, -0.32), 2.1],
      [new THREE.Vector3(-0.5, 1.2, -0.1), 4.4],
    ] as const) {
      const stone = new THREE.Mesh(cachedRockGeometry, ROCK_MATERIAL);
      stone.position.copy(offset);
      stone.rotation.set(tilt, tilt * 1.7, tilt * 0.6);
      stone.castShadow = true;
      rockCache.add(stone);
    }
  }
  group.add(rockCache);

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
      heldRock.position.set(0, 0.2, 0);
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
  let health = MAX_HEALTH;
  const combatProfile = createCombatProfile(random);
  let combatTarget: Rigwalker | null = null;
  let activeStrategy: CombatStrategy | null = null;
  /** Keeps a hurler standing like the throw it last loaded while it reloads. */
  let lastThrowType: ThrowType = "hurl";
  const restingFightDistance =
    role === "hurler" ? HURLER_FIGHT_DISTANCE : BASE_FIGHT_DISTANCE;
  let swinging = false;
  let defenseSide = 1;
  let hitReactionSide: -1 | 1 = 1;
  let defeatElapsed = -1;
  const defeatStartRotation = new THREE.Quaternion();
  const defeatTargetRotation = new THREE.Quaternion();
  const defeatRoll = new THREE.Quaternion();
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

  function applyCombatDamage(damage: number, side: -1 | 1): void {
    if (health <= 0) return;
    // The visible reaction is driven by the cue each frame; this only records
    // the impulse the balance controller needs and the side to topple toward.
    hitReactionSide = side;
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
      defeatRoll.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        hitReactionSide * 1.32,
      );
      defeatTargetRotation.copy(defeatStartRotation).multiply(defeatRoll);
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
          const angle = (group.id % 8) * (Math.PI / 4);
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
    if (!inCombat && wasInCombat && combatBones) {
      resetCombatPose(combatBones);
    }
    wasInCombat = inCombat;
    if (weaponVisual) weaponVisual.visible = inCombat;
    // The rock leaves the hand on the release event, and the hurler has another
    // out of the hip cache by the time the motion is over.
    if (heldRock && combatCue?.action !== "attack") heldRock.visible = true;

    const enemyDistance = combatTarget
      ? group.position.distanceTo(combatTarget.group.position)
      : Number.POSITIVE_INFINITY;
    if (combatTarget) {
      const fightDistance = combatCue?.preferredDistance ?? restingFightDistance;
      if (observedCombatTargetId !== combatTarget.combatId) {
        observedCombatTargetId = combatTarget.combatId;
        observedEnemyDistance = enemyDistance;
        observedFightDistance = fightDistance;
        distanceObservationElapsed = 0.16 + ((group.id * 37) % 17) / 100;
        distanceObservationCount = 0;
      } else {
        distanceObservationElapsed -= delta;
        if (distanceObservationElapsed <= 0) {
          observedEnemyDistance = enemyDistance;
          observedFightDistance = fightDistance;
          distanceObservationCount += 1;
          const variation = ((group.id * 37 + distanceObservationCount * 61) % 100) / 100;
          distanceObservationElapsed = 0.18 + variation * 0.24;
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
        const angle = (group.id % 8) * (Math.PI / 4);
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
        const combatStep = moving ? Math.sin(elapsed * 5.8 + group.id * 0.7) * 0.24 : 0;
        if (role === "hurler") {
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
            defenseSide,
            hitPhase,
            line,
            intensity: combatCue?.intensity ?? 0.72,
            deflected: combatCue?.action === "attack" && combatCue.outcome === "blocked",
            combatStep,
          });
        }
      }
      if (combatBones) applyBalancePose(combatBones, balancePose, inCombat);
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
