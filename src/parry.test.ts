import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { BASE_FIGHT_DISTANCE, type AttackLine, type CombatAction, type CombatCue } from "./combat";
import { createSeededRandom } from "./random";
import { unitField } from "./unit-field";
import { createRigwalker, type Rigwalker } from "./rigwalker";
import type { RigwalkerAsset } from "./rigwalker-assets";

/**
 * The only test in the suite that loads the real GLB. Every other one runs on the
 * primitive fallback, which has no blade — and a block is a claim about where two
 * blades are, so it cannot be checked without one.
 *
 * It was written from a report from play: swords that stayed vertical through a
 * block, and sparks in the air beside them rather than on any steel. Both were
 * real, and measurable. The defending blade held 13° to 17° off vertical and did
 * not move a centimetre through the whole contact, because the guard rose during
 * the wind-up and then held a plateau; `hand.R`, which owns the blade's angle,
 * had no guard term in it at all. The sparks come off the attacker's percussion
 * point, which sat 1.2 m to 2.5 m from the defending blade.
 *
 * Two fighters are pinned facing each other at fighting distance, one swinging and
 * one blocking, each held at a phase until the balance spring settles. Two things
 * this rig gets wrong if they are not done: a held phase lets the separation force
 * shove the pair apart, so positions are re-pinned every frame, and the facing
 * update lives inside the moving branch of `update`, so a standing fighter never
 * turns and both have to be aimed by hand.
 */

const STEP = 1 / 60;
const CAMERA = new THREE.Quaternion();
const LINES: AttackLine[] = ["overhead", "forehand", "backhand", "flank", "rising"];
/** Just after the outcome resolves at 0.46, which is the frame sparks fly on. */
const CONTACT_PHASE = 0.47;
/** Long enough for the damped balance layer to stop moving under a held phase. */
const SETTLE_FRAMES = 100;

async function loadAsset(): Promise<RigwalkerAsset> {
  const file = readFileSync("public/models/rigwalker.glb");
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, "");
  return { clips: gltf.animations, instantiate: () => SkeletonUtils.clone(gltf.scene) };
}

function cueOf(
  targetId: number, action: CombatAction, phase: number, line: AttackLine, side: -1 | 1,
): CombatCue {
  return {
    plannerId: null, targetId, action, movement: "hold", phase,
    strategy: "react", line, feintLine: null, side, intensity: 0.78,
    outcome: "blocked", preferredDistance: BASE_FIGHT_DISTANCE, doubleGuard: false,
  };
}

/** Distance from a point to a blade, treating the blade as the segment it is. */
function gapToBlade(point: THREE.Vector3, hilt: THREE.Vector3, tip: THREE.Vector3): number {
  const span = tip.clone().sub(hilt);
  const along = THREE.MathUtils.clamp(
    point.clone().sub(hilt).dot(span) / span.lengthSq(), 0, 1,
  );
  return point.distanceTo(hilt.clone().addScaledVector(span, along));
}

function leanOffVertical(hilt: THREE.Vector3, tip: THREE.Vector3): number {
  const direction = tip.clone().sub(hilt).normalize();
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(direction.y, -1, 1)));
}

/**
 * The sword arm's clearance of the fighter's own chest — the measurement
 * `freeArmClearance` in anim.ts makes for the other arm. Inside the torso box on
 * every axis at once is inside the body, so the axis with the most room decides.
 */
function armClearance(unit: Rigwalker): number {
  const torso = unit.group.getObjectByName("Torso") as THREE.Mesh;
  torso.geometry.computeBoundingBox();
  const box = torso.geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  let worst = Number.POSITIVE_INFINITY;
  for (const name of ["Elbow.R", "Forearm.R", "Hand.R"]) {
    const part = unit.group.getObjectByName(name)
      ?? unit.group.getObjectByName(name.replaceAll(".", ""));
    if (!part) continue;
    const probe = part.getWorldPosition(new THREE.Vector3());
    torso.worldToLocal(probe);
    worst = Math.min(worst, Math.max(
      Math.abs(probe.x - centre.x) - half.x,
      Math.abs(probe.y - centre.y) - half.y,
      Math.abs(probe.z - centre.z) - half.z,
    ));
  }
  return worst;
}

type Duel = {
  defender: Rigwalker;
  attacker: Rigwalker;
  /** Holds one phase of one line until nothing is still moving. */
  hold: (line: AttackLine, side: -1 | 1, phase: number, action?: CombatAction) => void;
  /** Advances one frame with whatever the defender is being told now. */
  step: (line: AttackLine, side: -1 | 1, phase: number, action: CombatAction) => void;
  blade: () => { hilt: THREE.Vector3; tip: THREE.Vector3 };
  incoming: () => THREE.Vector3;
};

function stageDuel(asset: RigwalkerAsset): Duel {
  const random = createSeededRandom(7);
  const defender = createRigwalker(asset, 0xffffff, "Helios", random);
  const attacker = createRigwalker(asset, 0xffffff, "Vanguard", random);
  const units = [defender, attacker];
  let clock = 0;

  const step = (line: AttackLine, side: -1 | 1, phase: number, action: CombatAction) => {
    defender.group.position.set(0, 0.2, 0);
    attacker.group.position.set(0, 0.2, BASE_FIGHT_DISTANCE);
    defender.group.rotation.set(0, 0, 0);
    attacker.group.rotation.set(0, Math.PI, 0);
    clock += STEP;
    const field = unitField(units);
    defender.update(STEP, clock, () => 0, field, [], CAMERA,
      cueOf(attacker.combatId, action, phase, line, side));
    attacker.update(STEP, clock, () => 0, field, [], CAMERA,
      cueOf(defender.combatId, "attack", phase, line, side));
  };

  return {
    defender,
    attacker,
    step,
    hold: (line, side, phase, action) => {
      const held = action ?? (phase < 0.34 ? "size-up" : "block");
      for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) step(line, side, phase, held);
    },
    blade: () => {
      const hilt = new THREE.Vector3();
      const tip = new THREE.Vector3();
      defender.sampleBlade(hilt, tip);
      return { hilt, tip };
    },
    incoming: () => attacker.getContactPoint(new THREE.Vector3()),
  };
}

describe("a parried cut", () => {
  it("puts the defending blade on the incoming one, from either side of every line", async () => {
    const duel = stageDuel(await loadAsset());
    for (const side of [1, -1] as const) {
      for (const line of LINES) {
        duel.hold(line, side, CONTACT_PHASE);
        const { hilt, tip } = duel.blade();
        const gap = gapToBlade(duel.incoming(), hilt, tip);
        const where = `${line} from side ${side}`;
        // Thrown from the attacker's percussion point, the sparks were 1.2 m to
        // 2.5 m off the defending blade. Measured at 0.18 m to 0.22 m here; the
        // margin is for the fight distance, which the director varies.
        expect(gap, `${where}: sparks land ${gap.toFixed(2)} m off the blade`)
          .toBeLessThan(0.4);
        // The complaint that started this was that the sword looks vertical.
        const lean = leanOffVertical(hilt, tip);
        expect(lean, `${where}: blade only ${lean.toFixed(0)}° off vertical`)
          .toBeGreaterThan(35);
        // Reaching across a cut must not reach through its own chest.
        expect(armClearance(duel.defender), `${where}: sword arm inside the torso`)
          .toBeGreaterThan(0.05);
      }
    }
  }, 120_000);

  it("moves the blade to get there, rather than holding a pose", async () => {
    const duel = stageDuel(await loadAsset());
    duel.hold("overhead", 1, 0.2);
    const guard = duel.blade();
    duel.hold("overhead", 1, CONTACT_PHASE);
    const parry = duel.blade();
    // The old guard held its blade still to the centimetre through the contact.
    // The tip travels about 2.4 m out and back now; a plateau would read as a
    // sword that stays vertical however good the numbers around it look.
    const travel = parry.tip.distanceTo(guard.tip);
    expect(travel, `the tip moved ${travel.toFixed(2)} m between guard and contact`)
      .toBeGreaterThan(1);
    expect(leanOffVertical(guard.hilt, guard.tip))
      .toBeLessThan(leanOffVertical(parry.hilt, parry.tip));
  }, 120_000);

  it("keeps the guard still when nothing is arriving", async () => {
    const duel = stageDuel(await loadAsset());
    // A fighter sizing up feeds `defensePhase` exactly as a blocking one does, and
    // its guard should come up — but a parry is aimed at a blow, and there is no
    // blow here. Driven off `defensePhase`, this swung at thin air.
    duel.hold("overhead", 1, 0.2, "size-up");
    const early = duel.blade();
    duel.hold("overhead", 1, CONTACT_PHASE, "size-up");
    const late = duel.blade();
    expect(late.tip.distanceTo(early.tip)).toBeLessThan(0.1);
    expect(leanOffVertical(late.hilt, late.tip)).toBeLessThan(25);
  }, 120_000);

  it("finishes the parry after the cue stops describing one", async () => {
    const duel = stageDuel(await loadAsset());
    // The director stops saying `block` the frame the outcome is known: a landed
    // hit becomes `hit` at 0.5, a whiff falls back to sizing up at 0.46, and the
    // blade is at full stretch across the cut on that frame. Read straight from
    // the cue, a full-amplitude pose vanished in a single frame on every hit and
    // every whiff, which is why the phase is a playhead that runs on by itself.
    duel.hold("overhead", 1, 0.5);
    const held = duel.blade().tip;
    duel.step("overhead", 1, 0.5, "size-up");
    const next = duel.blade().tip;
    // The frame the cue changes on is the whole question. Collapsing, the blade
    // crosses the 2.4 m back to the guard in one of them; carried by the playhead
    // it covers 3 cm and then plays the authored return out over about 12 frames,
    // which peaks near 0.37 m per frame — fast, but drawn rather than jumped. So
    // this is a claim about the first frame only, not about the sweep.
    const jump = next.distanceTo(held);
    expect(jump, `the blade jumped ${jump.toFixed(2)} m the frame the cue changed`)
      .toBeLessThan(0.15);
  }, 120_000);
});
