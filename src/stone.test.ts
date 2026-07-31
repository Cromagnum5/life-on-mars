import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import {
  CombatDirector,
  MIN_FIGHT_DISTANCE,
  STONE_FIGHT_DISTANCE,
  STONE_PROFILES,
  STONE_RANGE,
  STONE_RELEASE_RANGE,
  STONE_STRIKES,
  createCombatProfile,
  isStoneStrike,
  isThrow,
  type AttackLine,
  type CombatAction,
  type CombatCue,
  type CombatEvent,
  type CombatStrategy,
  type CombatantSnapshot,
  type StoneStrike,
} from "./combat";
import { createSeededRandom } from "./random";
import { unitField } from "./unit-field";
import { createRigwalker, stoneStep, type Rigwalker } from "./rigwalker";
import type { RigwalkerAsset } from "./rigwalker-assets";

/**
 * The hurler's close fight: what it does once somebody has crossed the standoff
 * it exists to hold. Half of this is the director deciding — a hurler charged
 * into a duel plans stone strikes the way a swordsman plans cuts, and picks
 * between them on how much time it has — and half is the poses those plans
 * resolve into, which are claims about where a rock in a hand ends up and can
 * only be checked against the real skeleton.
 */

const STEP = 1 / 60;
const CAMERA = new THREE.Quaternion();

function flat(): number {
  return 0;
}

function at(
  id: number, corporation: string, x: number, z: number,
  random: () => number, role: "melee" | "hurler", health = 100,
): CombatantSnapshot {
  return {
    id, corporation, role, health, maxHealth: 100, isAlive: true, x, z,
    profile: createCombatProfile(random),
  };
}

/**
 * Runs the director over fighters pinned where they are put, so the only thing
 * varying is what the gap makes them do. Health is held up: the run measures the
 * fight rather than how fast somebody dies out of it.
 */
function pinned(seed: number, seconds: number, fighters: CombatantSnapshot[]): {
  events: CombatEvent[];
  cues: Array<Map<number, CombatCue>>;
} {
  const director = new CombatDirector(createSeededRandom(seed));
  const events: CombatEvent[] = [];
  const cues: Array<Map<number, CombatCue>> = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const frame = director.update(STEP, fighters);
    events.push(...frame.events);
    cues.push(frame.cues);
    for (const fighter of fighters) fighter.health = 100;
  }
  return { events, cues };
}

/** Every plan the named fighter made for itself, in order. */
function ownPlans(
  cues: Array<Map<number, CombatCue>>, id: number,
): CombatStrategy[] {
  const plans: CombatStrategy[] = [];
  for (const frame of cues) {
    const cue = frame.get(id);
    if (cue?.plannerId === id && cue.strategy && plans.at(-1) !== cue.strategy) {
      plans.push(cue.strategy);
    }
  }
  return plans;
}

describe("a hurler charged into the close fight", () => {
  it("fights with the stone instead of throwing", () => {
    const random = createSeededRandom(4);
    const { events, cues } = pinned(4, 20, [
      at(1, "A", 0, 0, random, "hurler"),
      at(2, "B", STONE_FIGHT_DISTANCE, 0, random, "melee"),
    ]);
    const plans = ownPlans(cues, 1);
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(isStoneStrike(plan)).toBe(true);
    // And nothing leaves its hand: a rock being used as a weapon is not
    // ammunition, so there is no `throw` in the whole fight.
    expect(events.some((event) => event.attackerId === 1 && event.type === "throw"))
      .toBe(false);
  });

  it("is never handed a plan it has no weapon for", () => {
    // Waiting to counter swaps who attacks, so a swordsman choosing `react`
    // against a hurler made the *hurler* the attacker of a sword exchange — a
    // fighter cutting with a blade it does not carry. Every strategy naming the
    // hurler as attacker has to be one of its own.
    for (let seed = 1; seed <= 8; seed += 1) {
      const random = createSeededRandom(seed);
      const { events } = pinned(seed, 20, [
        at(1, "A", 0, 0, random, "hurler"),
        at(2, "B", STONE_FIGHT_DISTANCE, 0, random, "melee"),
      ]);
      for (const event of events) {
        if (event.attackerId !== 1) continue;
        expect(STONE_STRIKES, `seed ${seed} handed the hurler ${event.strategy}`)
          .toContain(event.strategy);
      }
    }
  });

  it("swings with its whole body when it has room, and punches when it has none", () => {
    // The claim the strike choice rests on. A riposte is the case with no room
    // at all — the fighter has just taken a blow on its arms and answers inside
    // what is left of the attacker's recovery — so every one of them comes out
    // as the strike that needs no warning. Given a free plan it reaches for the
    // heavy ones, which is the other half of the same rule.
    const heavy = new Set<CombatStrategy>(["hammer", "swing"]);
    let ripostes = 0;
    let heavyPlans = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const random = createSeededRandom(seed);
      const { events, cues } = pinned(seed, 25, [
        at(1, "A", 0, 0, random, "hurler"),
        at(2, "B", STONE_FIGHT_DISTANCE, 0, random, "melee"),
      ]);
      for (const event of events) {
        if (event.type !== "riposte" || event.attackerId !== 1) continue;
        ripostes += 1;
        expect(event.strategy, `seed ${seed} riposted with ${event.strategy}`).toBe("punch");
      }
      heavyPlans += ownPlans(cues, 1).filter((plan) => heavy.has(plan)).length;
    }
    expect(ripostes, "no hurler riposte in any seed").toBeGreaterThan(0);
    expect(heavyPlans, "never reached for the heavy strikes").toBeGreaterThan(10);
  });

  it("only becomes a duel once the charge is inside stone reach", () => {
    // Out at throwing range a hurler has no answer to somebody walking at it, so
    // the pair is not a trade and it keeps shelling. The band it becomes one in
    // is the stone's reach, not the sword's.
    const random = createSeededRandom(6);
    const far = pinned(6, 12, [
      at(1, "A", 0, 0, random, "hurler"),
      at(2, "B", STONE_RANGE + 0.6, 0, random, "melee"),
    ]);
    for (const plan of ownPlans(far.cues, 1)) expect(isThrow(plan)).toBe(true);

    const near = pinned(6, 12, [
      at(1, "A", 0, 0, random, "hurler"),
      at(2, "B", STONE_RANGE - 0.3, 0, random, "melee"),
    ]);
    for (const plan of ownPlans(near.cues, 1)) expect(isStoneStrike(plan)).toBe(true);
  });

  it("goes back to throwing once it has made room, without churning", () => {
    // The other end of the band. Held just outside the range a trade survives
    // to, the pair has to settle on one answer rather than taking and dropping
    // the encounter as often as the crowd jostles it — the same fault the
    // acquire range had, which reads as a unit stuttering under a strobing ring.
    for (const seed of [1, 2, 3]) {
      const random = createSeededRandom(seed);
      const jitter = createSeededRandom(seed + 40);
      const director = new CombatDirector(random);
      const fighters = [
        at(1, "A", 0, 0, random, "hurler"),
        at(2, "B", 0, 0, random, "melee"),
      ];
      let plans = 0;
      let threw = false;
      for (let elapsed = 0; elapsed < 20; elapsed += STEP) {
        fighters[1].x = STONE_RELEASE_RANGE + 0.2 + (jitter() - 0.5) * 0.3;
        const frame = director.update(STEP, fighters);
        plans += frame.events.filter((event) => event.type === "plan").length;
        threw ||= frame.events.some((event) => event.attackerId === 1 && event.type === "throw");
      }
      expect(threw, `seed ${seed}: never went back to throwing`).toBe(true);
      // A handful of plans is two fighters settling and re-planning their own
      // exchanges; dozens is the encounter churning at frame rate.
      expect(plans, `seed ${seed}: ${plans} plans`).toBeLessThan(40);
    }
  });

  it("holds a cover while two bodies work it, and never against one", () => {
    // A cover is a posture, not a flinch. Gated to the frames a blow was landing
    // it was up for one per cent of a crowded fight — which in play meant it was
    // only ever seen on a corpse, because a defeated fighter keeps the last pose
    // it was given. It is held now for as long as two enemies are on the
    // fighter, and dropped only to swing.
    const covering = (positions: ReadonlyArray<readonly [number, number]>) => {
      const random = createSeededRandom(9);
      const fighters = [at(1, "A", 0, 0, random, "hurler")];
      positions.forEach(([x, z], index) =>
        fighters.push(at(index + 2, "B", x, z, random, "melee")));
      const { cues } = pinned(9, 20, fighters);
      let doubles = 0;
      let striking = 0;
      for (const frame of cues) {
        const cue = frame.get(1);
        if (cue?.doubleGuard) doubles += 1;
        if (cue?.action === "attack") striking += 1;
      }
      return { doubles, striking, frames: cues.length };
    };
    // Two bodies on different bearings. The clearance floor holds a pair about
    // 39° apart at fighting distance, so that is the case that has to work —
    // written at fifty degrees, the common one never qualified at all.
    for (const pair of [
      [[STONE_FIGHT_DISTANCE, 0], [-STONE_FIGHT_DISTANCE, 0.3]],
      [[STONE_FIGHT_DISTANCE, 1.3], [STONE_FIGHT_DISTANCE, -1.3]],
      [[STONE_FIGHT_DISTANCE, 0.95], [STONE_FIGHT_DISTANCE, -0.95]],
    ] as ReadonlyArray<ReadonlyArray<readonly [number, number]>>) {
      const worked = covering(pair);
      expect(worked.doubles / worked.frames, `cover up ${worked.doubles}/${worked.frames}`)
        .toBeGreaterThan(0.4);
      // But not while it is swinging: that arm has something else to do.
      expect(worked.doubles + worked.striking).toBeLessThanOrEqual(worked.frames);
    }
    // One enemy is one problem, and one arm answers it — two bearings are needed
    // and there is only ever one.
    expect(covering([[STONE_FIGHT_DISTANCE, 0]]).doubles).toBe(0);
    // And two stacked on the same line are one problem as well.
    expect(covering([[STONE_FIGHT_DISTANCE, 0], [STONE_FIGHT_DISTANCE + 1.6, 0.1]]).doubles)
      .toBe(0);
  });

  it("drops out of its team's battery while it is fighting", () => {
    // A hurler with somebody on top of it must not drag the rest of the battery
    // onto the body standing in its own melee, and must not be throwing itself.
    const random = createSeededRandom(15);
    const fighters = [
      at(1, "A", 0, 0, random, "hurler"), at(2, "A", 0, 6, random, "hurler"),
      at(3, "B", STONE_FIGHT_DISTANCE, 0, random, "melee"),
      at(4, "B", 13, 4, random, "melee"),
    ];
    const { events, cues } = pinned(15, 12, fighters);
    const last = cues.at(-1)!;
    // Every plan it makes for itself is a stone strike. Its *cue* is often a
    // sword strategy, because a defender is given the attacker's plan.
    const plans = ownPlans(cues, 1);
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(isStoneStrike(plan)).toBe(true);
    // It throws nothing for the whole fight — the rock in its hand has another
    // job — while the thrower that is still free keeps working.
    expect(events.some((event) => event.type === "throw" && event.attackerId === 1)).toBe(false);
    expect(events.some((event) => event.type === "throw" && event.attackerId === 2)).toBe(true);
    expect(isThrow(last.get(2)?.strategy ?? null)).toBe(true);
  });
});

/**
 * The poses. These load the real GLB, because every claim here is about where a
 * rock in a hand actually ends up, and the primitive fallback has no skeleton to
 * put one on.
 */

const SETTLE = 80;

async function loadAsset(): Promise<RigwalkerAsset> {
  const file = readFileSync("public/models/rigwalker.glb");
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, "");
  return { clips: gltf.animations, instantiate: () => SkeletonUtils.clone(gltf.scene) };
}

function cueOf(
  self: number, targetId: number, action: CombatAction, phase: number,
  strategy: CombatStrategy | null, doubleGuard = false,
): CombatCue {
  return {
    plannerId: self, targetId, action, movement: "plant", phase, strategy,
    line: "overhead" as AttackLine, feintLine: null, side: 1, intensity: 0.78,
    outcome: "pending", preferredDistance: STONE_FIGHT_DISTANCE, doubleGuard,
  };
}

/** How far clear of its own torso a fighter's arm is; negative is inside the body. */
function armClearance(unit: Rigwalker, side: "L" | "R"): number {
  const torso = unit.group.getObjectByName("Torso") as THREE.Mesh;
  torso.geometry.computeBoundingBox();
  const box = torso.geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  let worst = Number.POSITIVE_INFINITY;
  for (const name of [`Elbow.${side}`, `Forearm.${side}`, `Hand.${side}`]) {
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

/**
 * How far the stone in one fighter's hand is from the other's body — the surface
 * of the torso rather than its centre, because whether a blow reads as landing is
 * a question about where the two shapes are, not where their origins are.
 */
function gapToBody(attacker: Rigwalker, defender: Rigwalker): number {
  const torso = defender.group.getObjectByName("Torso") as THREE.Mesh;
  torso.geometry.computeBoundingBox();
  const box = torso.geometry.boundingBox!;
  const point = attacker.getContactPoint(new THREE.Vector3());
  torso.worldToLocal(point);
  return box.distanceToPoint(point);
}

function partAt(unit: Rigwalker, name: string): THREE.Vector3 {
  const part = unit.group.getObjectByName(name)
    ?? unit.group.getObjectByName(name.replaceAll(".", ""));
  if (!part) throw new Error(`no part named ${name}`);
  return part.getWorldPosition(new THREE.Vector3());
}

type Bench = {
  hurler: Rigwalker;
  mark: Rigwalker;
  /** Holds one phase of one strike until the balance spring stops moving. */
  hold: (action: CombatAction, phase: number, strategy: CombatStrategy | null,
    doubleGuard?: boolean) => void;
  rock: () => THREE.Vector3;
};

/**
 * A hurler and something to hit, both pinned. Two things this rig gets wrong if
 * they are not done every frame: a held phase lets the separation force shove
 * the pair apart, and the facing update lives inside the moving branch of
 * `update`, so a standing fighter never turns and both have to be aimed by hand.
 */
function stageFight(asset: RigwalkerAsset): Bench {
  const random = createSeededRandom(7);
  const hurler = createRigwalker(asset, 0xffffff, "Helios", random, { role: "hurler" });
  const mark = createRigwalker(asset, 0xffffff, "Vanguard", random);
  const units = [hurler, mark];
  let clock = 0;
  const step = (
    action: CombatAction, phase: number, strategy: CombatStrategy | null, doubleGuard: boolean,
  ) => {
    hurler.group.position.set(0, 0.2, 0);
    mark.group.position.set(0, 0.2, STONE_FIGHT_DISTANCE);
    hurler.group.rotation.set(0, 0, 0);
    mark.group.rotation.set(0, Math.PI, 0);
    clock += STEP;
    const field = unitField(units);
    hurler.update(STEP, clock, flat, field, [], CAMERA,
      cueOf(hurler.combatId, mark.combatId, action, phase, strategy, doubleGuard));
    mark.update(STEP, clock, flat, field, [], CAMERA);
  };
  return {
    hurler,
    mark,
    hold: (action, phase, strategy, doubleGuard = false) => {
      for (let frame = 0; frame < SETTLE; frame += 1) step(action, phase, strategy, doubleGuard);
    },
    rock: () => hurler.getContactPoint(new THREE.Vector3()),
  };
}

describe("the stone strikes", () => {
  it("lands each one on the body it is aimed at", async () => {
    const bench = stageFight(await loadAsset());
    for (const strike of STONE_STRIKES) {
      // The director resolves the outcome at 0.46 and applies the damage at
      // 0.54, so the stone has to be on the opponent between those two. A strike
      // that resolves with less reach than the gap is landing on nobody, and its
      // sparks come off the empty air between the fighters.
      let closest = Number.POSITIVE_INFINITY;
      for (const phase of [0.46, 0.5, 0.54]) {
        bench.hold("attack", phase, strike);
        closest = Math.min(closest, gapToBody(bench.hurler, bench.mark));
      }
      expect(closest, `${strike} resolves ${closest.toFixed(2)} m off the body`)
        .toBeLessThan(strike === "punch" ? 0.55 : 0.35);
    }
  }, 300_000);

  it("carries the stone a long way to get there", async () => {
    const bench = stageFight(await loadAsset());
    for (const strike of STONE_STRIKES) {
      bench.hold("attack", 0.2, strike);
      const loaded = bench.rock().clone();
      bench.hold("attack", 0.5, strike);
      const landed = bench.rock().clone();
      const travel = loaded.distanceTo(landed);
      // A strike that holds a pose and teleports its stone onto the target reads
      // as a dropped frame however good the two ends look. The heavy ones travel
      // furthest, which is the whole reason they cost time.
      expect(travel, `${strike} moved its stone ${travel.toFixed(2)} m`)
        .toBeGreaterThan(strike === "punch" ? 1 : 1.8);
    }
  }, 300_000);

  it("puts both hands on the stone for the hammer and one for the rest", async () => {
    const bench = stageFight(await loadAsset());
    const gapAtTop = (strike: StoneStrike) => {
      bench.hold("attack", 0.4, strike);
      return partAt(bench.hurler, "Hand.L").distanceTo(bench.rock());
    };
    const twoHanded = gapAtTop("hammer");
    expect(twoHanded, `the hammer's free hand is ${twoHanded.toFixed(2)} m off the stone`)
      .toBeLessThan(0.6);
    // Every other strike keeps that arm for the guard, which is what the free
    // hand is for when it is not holding the weapon.
    for (const strike of ["swing", "jab", "punch"] as const) {
      expect(gapAtTop(strike), `${strike} brought the free hand to the stone`)
        .toBeGreaterThan(twoHanded);
    }
  }, 300_000);

  it("keeps both arms out of its own chest", async () => {
    // The one pose fault a picture cannot show: an arm going *through* the body
    // rather than round it is drawn in front of the chest either way, and the
    // difference is a few centimetres of one Euler angle. It was a real fault in
    // the swing, whose counterweight arm drove across the chest instead of out
    // of it and sat 0.16 m inside the torso for a fifth of the strike.
    const bench = stageFight(await loadAsset());
    for (const strike of STONE_STRIKES) {
      for (let phase = 0; phase <= 1.0001; phase += 0.05) {
        bench.hold("attack", phase, strike);
        for (const side of ["L", "R"] as const) {
          const clear = armClearance(bench.hurler, side);
          expect(clear, `${strike} at ${phase.toFixed(2)}: ${side} arm ${clear.toFixed(3)} m clear`)
            .toBeGreaterThan(0.05);
        }
      }
    }
  }, 600_000);

  it("keeps its feet on the ground and its hips over them", async () => {
    // There is no IK: the hips are pinned to the terrain and the legs are two
    // rigid bones, so every centimetre the body travels is charged to a leg's
    // reach and paid back as crouch. `drop` follows the lower of the two feet,
    // which is the one being stood on.
    for (const strike of STONE_STRIKES) {
      expect(Math.abs(stoneStep(strike, -1).drop)).toBeLessThan(0.02);
      for (let phase = 0; phase <= 1.0001; phase += 0.02) {
        const { drop } = stoneStep(strike, phase);
        expect(Math.abs(drop), `${strike} at ${phase.toFixed(2)} drops ${drop.toFixed(3)}`)
          .toBeLessThan(0.1);
      }
    }
  });

  it("lunges into the blow and comes back off it", () => {
    for (const strike of STONE_STRIKES) {
      const step = (phase: number) => stoneStep(strike, phase);
      // The ground a hurler holds is the director's to give, so the lunge is a
      // loan: anything left at phase 1 is a body that has to be snapped back.
      expect(step(-1).forward).toBe(0);
      expect(step(0).forward).toBe(0);
      expect(step(1).forward).toBeCloseTo(0, 5);
      expect(step(0.5).forward).toBeGreaterThan(step(0.25).forward);
      // And the heavy ones travel furthest, which is the other half of why they
      // reach and a punch does not.
      expect(step(0.5).forward).toBeGreaterThan(0.15);
    }
    expect(stoneStep("hammer", 0.5).forward).toBeGreaterThan(stoneStep("punch", 0.5).forward);
  });

  it("hands the legs to the strike and takes them back", () => {
    // What `applyBalancePose` reads to know whose stance it is: its crouch and
    // recovery steps belong to a fighter that is only standing, and layered onto
    // a lunge they lift the rear foot clear of the ground.
    for (const strike of STONE_STRIKES) {
      expect(stoneStep(strike, -1).engagement).toBe(0);
      expect(stoneStep(strike, 0.5).engagement).toBeGreaterThan(0.9);
      expect(stoneStep(strike, 1).engagement).toBeCloseTo(0, 5);
    }
  });

  it("starts and finishes every strike in the stance it waits in", async () => {
    // Both ends of every arc are the one pose the hurler stands in between
    // strikes, read rather than stored. Two copies of it would jump the arm
    // whenever the fight called for a different strike — invisible in a still,
    // and loud in motion.
    const bench = stageFight(await loadAsset());
    bench.hold("size-up", 0, "swing");
    const waiting = bench.rock().clone();
    for (const strike of STONE_STRIKES) {
      for (const phase of [0, 1]) {
        bench.hold("attack", phase, strike);
        const gap = bench.rock().distanceTo(waiting);
        expect(gap, `${strike} at phase ${phase} sits ${gap.toFixed(3)} m off the stance`)
          .toBeLessThan(0.05);
      }
    }
  }, 300_000);

  it("holds the stone in the fist rather than back along the arm", async () => {
    // Reported from play, and measurable. The rock rides the wrist bone at a
    // fixed offset, so cocking the wrist swings it back down the forearm — at
    // the 0.72 rad the stance first carried, the stone sat at 0.80 of the way
    // from elbow to fist, behind the hand and lying on the arm.
    //
    // The ratio is what to check: 1 is the fist, more than 1 is out past it, and
    // anything short of about 0.9 is a hurler wearing its rock rather than
    // holding it. It is a claim about the guard as much as the strike, because
    // the stance is the pose held for most of a fight.
    const bench = stageFight(await loadAsset());
    const alongArm = () => {
      const elbow = partAt(bench.hurler, "lower_arm.R");
      const fist = partAt(bench.hurler, "Hand.R");
      const span = fist.clone().sub(elbow);
      return bench.rock().clone().sub(elbow).dot(span) / span.lengthSq();
    };
    const cases: Array<[string, () => void]> = [
      ["the stance", () => bench.hold("size-up", 0, "swing")],
      ["a guard", () => bench.hold("block", 0.47, "rush")],
      ["a cover", () => bench.hold("block", 0.47, "rush", true)],
      ...STONE_STRIKES.map((strike) =>
        [strike as string, () => bench.hold("attack", 0.5, strike)] as [string, () => void]),
    ];
    for (const [name, hold] of cases) {
      hold();
      const along = alongArm();
      expect(along, `${name} carries the stone at ${along.toFixed(2)} of the way to the fist`)
        .toBeGreaterThan(0.9);
    }
  }, 300_000);

  it("hangs the stone elbow rather than winging it out", async () => {
    // Reported from play. Solved for the grip alone, the shoulder abducted to
    // put the rock where it was asked for and left the elbow 0.69 m out to the
    // side of the shoulder and only 0.30 m below it — a chicken-wing. Where the
    // elbow rides is half of what a guard reads as, and it is only visible while
    // the hurler is waiting or defending, which is most of a fight.
    const bench = stageFight(await loadAsset());
    for (const [name, hold] of [
      ["waiting", () => bench.hold("size-up", 0, "swing")],
      ["sizing up", () => bench.hold("size-up", 0.6, "rush")],
      ["a guard", () => bench.hold("block", 0.47, "rush")],
    ] as Array<[string, () => void]>) {
      hold();
      const shoulder = partAt(bench.hurler, "upper_arm.R");
      const elbow = partAt(bench.hurler, "lower_arm.R");
      const below = shoulder.y - elbow.y;
      const out = Math.abs(elbow.x - shoulder.x);
      expect(below, `${name}: the elbow rides ${below.toFixed(2)} m below the shoulder`)
        .toBeGreaterThan(0.55);
      expect(out, `${name}: the elbow is ${out.toFixed(2)} m out to the side`)
        .toBeLessThan(0.5);
    }
  }, 300_000);

  it("keeps the off hand on its own side while it waits", async () => {
    // A free arm folded across the sternum reads as a fighter hugging itself
    // rather than leading with a hand. It may cross to block — that is what a
    // block is — but not to stand.
    const bench = stageFight(await loadAsset());
    bench.hold("size-up", 0, "swing");
    const lead = partAt(bench.hurler, "Hand.L").sub(bench.hurler.group.position);
    expect(lead.x, `the off hand stands ${lead.x.toFixed(2)} across the centre line`)
      .toBeLessThan(-0.15);
    // And it is out in front rather than tucked into the chest.
    expect(lead.z).toBeGreaterThan(0.9);
  }, 300_000);

  it("moves the guard out to meet a blow, and puts the second arm up to cover", async () => {
    const bench = stageFight(await loadAsset());
    bench.hold("size-up", 0, "rush");
    const resting = partAt(bench.hurler, "Hand.L").clone();
    bench.hold("block", 0.47, "rush");
    const met = partAt(bench.hurler, "Hand.L").clone();
    // The lesson the sword already learned: a guard that holds a plateau through
    // the contact reads as an arm that never answered anything.
    const travel = resting.distanceTo(met);
    expect(travel, `the guard moved ${travel.toFixed(2)} m to meet the blow`)
      .toBeGreaterThan(0.3);
    expect(met.y).toBeGreaterThan(resting.y);

    // And the second arm only comes across when there is more than one blow.
    const oneArm = bench.rock().clone();
    bench.hold("block", 0.47, "rush", true);
    const covered = bench.rock().clone();
    expect(covered.y, "the stone hand stayed low under a cover").toBeGreaterThan(oneArm.y);
    expect(partAt(bench.hurler, "Hand.L").y).toBeGreaterThan(met.y);
  }, 300_000);
});

describe("the stone profiles", () => {
  it("orders the strikes by what they cost and what they do", () => {
    const [hammer, swing, jab, punch] = STONE_STRIKES.map((s) => STONE_PROFILES[s]);
    // Heavier is slower to load, slower to make, slower to recover from, and
    // harder to stop. A strike that were better on every axis would not be a
    // decision.
    expect(hammer.load).toBeGreaterThan(swing.load);
    expect(swing.load).toBeGreaterThan(jab.load);
    expect(jab.load).toBeGreaterThan(punch.load);
    expect(punch.load).toBe(0);
    expect(hammer.motion).toBeGreaterThan(swing.motion);
    expect(swing.motion).toBeGreaterThan(jab.motion);
    expect(jab.motion).toBeGreaterThan(punch.motion);
    expect(hammer.recovery).toBeGreaterThan(punch.recovery);
    expect(hammer.damage).toBeGreaterThan(swing.damage);
    expect(swing.damage).toBeGreaterThan(jab.damage);
    expect(jab.damage).toBeGreaterThan(punch.damage);
    expect(hammer.pressure).toBeGreaterThan(punch.pressure);
  });

  it("stands close enough to reach with a stone, and no closer than reads", () => {
    expect(STONE_FIGHT_DISTANCE).toBeGreaterThanOrEqual(MIN_FIGHT_DISTANCE);
    expect(STONE_FIGHT_DISTANCE).toBeLessThan(STONE_RANGE);
    // The band a trade is held together over has to be wider than the one it is
    // entered at, or a pair sitting on the line takes and drops the encounter as
    // often as the crowd jostles it.
    expect(STONE_RELEASE_RANGE).toBeGreaterThan(STONE_RANGE);
  });
});
