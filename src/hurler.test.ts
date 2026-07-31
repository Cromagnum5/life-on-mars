import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ATTACK_RANGE,
  CombatDirector,
  HURLER_FIGHT_DISTANCE,
  LONG_THROW_RANGE,
  MEDIUM_THROW_RANGE,
  SHORT_THROW_RANGE,
  SHOULDER_WIDTH,
  THROW_PROFILES,
  THROW_TYPES,
  createCombatProfile,
  throwTypeForDistance,
  type CombatEvent,
  type CombatantSnapshot,
} from "./combat";
import { createSeededRandom } from "./random";
import { unitField } from "./unit-field";
import { createRigwalker, hurlStep, type Rigwalker } from "./rigwalker";

/**
 * What the hurler is supposed to be, checked rather than asserted in a comment:
 * three throws chosen by the gap, deadliest at the top of its range, with a
 * rock that lands a flight after it leaves the hand and a fight that a
 * swordsman can still walk in and win.
 */

const STEP = 1 / 60;
const CAMERA = new THREE.Quaternion();

function flat(): number {
  return 0;
}

function snapshot(
  id: number,
  corporation: string,
  x: number,
  random: () => number,
  role: "melee" | "hurler",
): CombatantSnapshot {
  return {
    id, corporation, role, health: 100, maxHealth: 100, isAlive: true, x, z: 0,
    profile: createCombatProfile(random),
  };
}

/**
 * Pins two fighters at a fixed gap and runs the director, reporting only what
 * the hurler itself did. Nothing moves, so the one thing varying between runs
 * is the throw the distance calls for.
 *
 * The filtering matters: inside sword reach the target fights back, and its own
 * cuts would otherwise be counted as the hurler's output and make close range
 * look like the hurler's best band.
 */
function throwAt(gap: number, seconds: number, seed = 5): {
  damage: number;
  events: CombatEvent[];
} {
  const random = createSeededRandom(seed);
  const director = new CombatDirector(random);
  const fighters = [
    snapshot(1, "A", 0, random, "hurler"),
    snapshot(2, "B", gap, random, "melee"),
  ];
  let damage = 0;
  const events: CombatEvent[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const frame = director.update(STEP, fighters);
    for (const event of frame.events) {
      if (event.attackerId === 1) events.push(event);
    }
    for (const entry of frame.damage) {
      if (entry.targetId === 2) damage += entry.amount;
    }
    // Both are punchbags: neither dies, so the run measures the throw rather
    // than the fight around it.
    fighters[0].health = 100;
    fighters[1].health = 100;
  }
  return { damage, events };
}

function runFight(seed: number, seconds: number, hurlerStandoff: number): {
  units: Rigwalker[];
  gaps: number[];
  defeats: number;
} {
  const random = createSeededRandom(seed);
  const director = new CombatDirector(random);
  const hurler = createRigwalker(null, 0xffffff, "Helios", random, { role: "hurler" });
  hurler.group.position.set(-hurlerStandoff, 0.2, 0);
  const sword = createRigwalker(null, 0xffffff, "Vanguard", random);
  sword.group.position.set(hurlerStandoff, 0.2, 0);
  sword.moveTo(new THREE.Vector3(-1, 0, 0));
  const units = [hurler, sword];

  const gaps: number[] = [];
  let defeats = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    const snapshots: CombatantSnapshot[] = units.map((unit) => ({
      id: unit.combatId, corporation: unit.corporation, role: unit.role,
      health: unit.health, maxHealth: unit.maxHealth, isAlive: unit.isAlive,
      x: unit.group.position.x, z: unit.group.position.z, profile: unit.combatProfile,
    }));
    const frame = director.update(STEP, snapshots);
    const byId = new Map(units.map((unit) => [unit.combatId, unit]));
    for (const entry of frame.damage) {
      const target = byId.get(entry.targetId)!;
      const wasAlive = target.isAlive;
      target.applyCombatDamage(entry.amount, entry.side);
      if (wasAlive && !target.isAlive) defeats += 1;
    }
    const field = unitField(units);
    for (const unit of units) {
      unit.update(STEP, elapsed, flat, field, [], CAMERA, frame.cues.get(unit.combatId));
    }
    gaps.push(hurler.group.position.distanceTo(sword.group.position));
  }
  return { units, gaps, defeats };
}

describe("throw ranges", () => {
  it("states its bands in shoulder widths and sword reach", () => {
    // Twelve shoulder widths, and twice a sword Rigwalker's strike distance.
    expect(SHOULDER_WIDTH).toBeCloseTo(1.34, 5);
    expect(LONG_THROW_RANGE).toBeCloseTo(SHOULDER_WIDTH * 12, 5);
    expect(MEDIUM_THROW_RANGE).toBeCloseTo(ATTACK_RANGE * 2, 5);
    expect(SHORT_THROW_RANGE).toBeCloseTo(ATTACK_RANGE, 5);
    expect(LONG_THROW_RANGE).toBeGreaterThan(MEDIUM_THROW_RANGE);
    expect(MEDIUM_THROW_RANGE).toBeGreaterThan(SHORT_THROW_RANGE);
  });

  it("picks the throw the gap calls for", () => {
    expect(throwTypeForDistance(15)).toBe("hurl");
    expect(throwTypeForDistance(MEDIUM_THROW_RANGE + 0.1)).toBe("hurl");
    expect(throwTypeForDistance(6)).toBe("pitch");
    expect(throwTypeForDistance(SHORT_THROW_RANGE + 0.1)).toBe("pitch");
    expect(throwTypeForDistance(3)).toBe("toss");
    expect(throwTypeForDistance(LONG_THROW_RANGE + 0.1)).toBeNull();
  });

  it("throws hardest, fastest, and slowest to execute at the top of the range", () => {
    const [hurl, pitch, toss] = THROW_TYPES.map((type) => THROW_PROFILES[type]);
    expect(hurl.damage).toBeGreaterThan(pitch.damage);
    expect(pitch.damage).toBeGreaterThan(toss.damage);
    expect(hurl.speed).toBeGreaterThan(pitch.speed);
    expect(pitch.speed).toBeGreaterThan(toss.speed);
    // The long throw is the big wind-up; the close one is a flick.
    expect(hurl.motion).toBeGreaterThan(pitch.motion);
    expect(pitch.motion).toBeGreaterThan(toss.motion);
    // And the further out it is thrown from, the better it is aimed.
    expect(hurl.miss + hurl.deflect).toBeLessThan(pitch.miss + pitch.deflect);
    expect(pitch.miss + pitch.deflect).toBeLessThan(toss.miss + toss.deflect);
  });

  it("stands off near the top of its range rather than at the edge of it", () => {
    expect(HURLER_FIGHT_DISTANCE).toBeLessThan(LONG_THROW_RANGE);
    expect(HURLER_FIGHT_DISTANCE).toBeGreaterThan(MEDIUM_THROW_RANGE);
  });
});

describe("the step a hurl takes", () => {
  const sample = (phase: number) => hurlStep("hurl", phase);
  const release = THROW_PROFILES.hurl.release;

  it("only the long throw travels", () => {
    for (const phase of [0, 0.3, 0.44, 0.58, 0.8]) {
      expect(hurlStep("pitch", phase).forward).toBe(0);
      expect(hurlStep("toss", phase).forward).toBe(0);
    }
  });

  it("plants forward through the stride and is back on its spot by the end", () => {
    // A hurler holds the ground the director gave it, so the step is a loan.
    // Anything left over at phase 1 is a body that has to be snapped back.
    expect(sample(-1).forward).toBe(0);
    expect(sample(0).forward).toBe(0);
    expect(sample(1).forward).toBeCloseTo(0, 5);
    // Rising through the wind, furthest out around the moment the rock leaves.
    expect(sample(0.44).forward).toBeGreaterThan(sample(0.3).forward);
    expect(sample(release).forward).toBeGreaterThan(sample(0.44).forward);
  });

  it("travels only as far as the legs can hold their feet down", () => {
    // Not a taste number. There is no IK: the hips are pinned to the terrain
    // and a foot cannot reach out and stay on the ground, so every centimetre
    // of travel is charged to the rear leg's reach and paid back as crouch.
    // Half a body-width asks for nearly 0.2 m of it, and a hurl crouched that
    // deep releases lower than a pitch — which inverts the ordering the three
    // throws are read by, and which `render_rigwalker_throw.py` fails on.
    expect(sample(release).forward).toBeGreaterThan(0.25);
    expect(sample(release).forward).toBeLessThan(0.35);
  });

  it("keeps the hips within a stance of where they stand", () => {
    // `drop` tracks the lower of the two feet, so it can go either way: a
    // fighter whose legs are both straighter than it stands genuinely stands
    // taller. What it may not do is wander, because it comes straight off the
    // release height, and a hurl that releases below a pitch inverts the
    // ordering the three throws are read by.
    expect(Math.abs(sample(-1).drop)).toBeLessThan(0.05);
    for (const phase of [0.3, 0.44, release, 0.72, 0.9]) {
      expect(Math.abs(sample(phase).drop)).toBeLessThan(0.1);
    }
    // The stance is owed whether or not a throw is loaded, so the two slower
    // throws stand in it too.
    expect(hurlStep("toss", -1).drop).toBeCloseTo(sample(-1).drop, 5);
  });

  it("starts a hurl in the stance it was already standing in", () => {
    // A hurler between throws is posed by the branch a pitch and a toss use;
    // the instant a long throw starts it is posed by the hurl's own. If those
    // two disagree about the stance, every hurl opens with a foot jumping to a
    // new spot — which is not visible in a still and very visible in motion.
    // `drop` is what this can see of the legs, and it is derived from all four
    // angles, so it catches any of them drifting apart.
    expect(sample(0).drop).toBeCloseTo(sample(-1).drop, 5);
    expect(sample(1).drop).toBeCloseTo(sample(-1).drop, 5);
    for (const throwType of ["pitch", "toss"] as const) {
      expect(hurlStep(throwType, -1).drop).toBeCloseTo(sample(-1).drop, 5);
    }
  });

  it("hands the legs to the throw and takes them back", () => {
    // What `applyBalancePose` reads to know whose stance it is. Its crouch and
    // recovery steps belong to a fighter that is only standing; layered onto a
    // stride they lifted the rear foot clear of the ground.
    expect(sample(-1).engagement).toBe(0);
    expect(sample(release).engagement).toBeCloseTo(1, 5);
    expect(sample(1).engagement).toBeCloseTo(0, 5);
  });
});

describe("a hurler in an exchange", () => {
  it("is most effective at maximum range", () => {
    // The claim the whole unit rests on, measured as damage per second held at
    // each band across several seeds rather than argued from the profiles.
    const rate = (gap: number) => {
      let total = 0;
      for (let seed = 1; seed <= 8; seed += 1) total += throwAt(gap, 30, seed).damage;
      return total / (8 * 30);
    };
    const long = rate(HURLER_FIGHT_DISTANCE);
    const medium = rate(6.5);
    const short = rate(3);
    expect(long).toBeGreaterThan(medium * 1.2);
    expect(medium).toBeGreaterThan(short * 1.2);
  });

  it("only ever throws, and never picks up a sword plan", () => {
    // Out where it is throwing. Inside stone reach it fights, which is the whole
    // of "a hurler in the close fight" and is pinned in `stone.test.ts`.
    for (const gap of [14, 6.5, 4]) {
      const { events } = throwAt(gap, 25);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(["hurl", "pitch", "toss"]).toContain(event.strategy);
      }
      expect(events.some((event) => event.type === "riposte")).toBe(false);
      expect(events.some((event) => event.type === "swing")).toBe(false);
    }
  });

  it("throws the band the gap calls for", () => {
    // The toss band is what is left of sword reach once stone reach is taken out
    // of the bottom of it: close enough to be worth a pebble, far enough that
    // nobody has actually reached the thrower yet.
    for (const [gap, expected] of [[14, "hurl"], [6.5, "pitch"], [4, "toss"]] as const) {
      const releases = throwAt(gap, 25).events.filter((event) => event.type === "throw");
      expect(releases.length).toBeGreaterThan(0);
      for (const release of releases) expect(release.projectile?.throwType).toBe(expected);
    }
  });

  it("lands each rock exactly once, a flight after it leaves the hand", () => {
    const outcomes = new Set(["hit", "glance", "whiff", "block"]);
    for (const gap of [14, 6.5, 4]) {
      const { events } = throwAt(gap, 40);
      const releases = events.filter((event) => event.type === "throw");
      const landings = events.filter((event) => outcomes.has(event.type));
      // A rock can still be in the air when the run ends, and only then.
      expect(releases.length - landings.length).toBeGreaterThanOrEqual(0);
      expect(releases.length - landings.length).toBeLessThanOrEqual(1);
      for (const release of releases) {
        expect(release.projectile).toBeDefined();
        // Flight is the real gap over the real speed, so presentation can put a
        // rock in the air that arrives on the frame the strike resolves.
        expect(release.projectile!.flightTime)
          .toBeCloseTo(gap / release.projectile!.speed, 2);
      }
    }
  });

  it("resolves the strike at release and replays it on arrival", () => {
    const { events } = throwAt(14, 40);
    const releases = events.filter((event) => event.type === "throw");
    const landings = events.filter(
      (event) => ["hit", "glance", "whiff", "block"].includes(event.type),
    );
    const named = { hit: "hit", glance: "glancing", whiff: "whiff", block: "blocked" } as const;
    landings.forEach((landing, index) => {
      const declared = releases[index].projectile!.outcome;
      expect(named[landing.type as keyof typeof named]).toBe(declared);
    });
  });

  it("applies no damage to a rock that was swatted aside or missed", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { events, damage } = throwAt(14, 30, seed);
      const landed = events.filter(
        (event) => event.type === "hit" || event.type === "glance",
      ).length;
      const missed = events.filter(
        (event) => event.type === "whiff" || event.type === "block",
      ).length;
      expect(missed).toBeGreaterThanOrEqual(0);
      // Only the landings can have contributed, and each contributes at most a
      // clean hurl's worth.
      expect(damage).toBeLessThanOrEqual(landed * THROW_PROFILES.hurl.damage);
    }
  });
});

describe("a hurler at the edge of its reach", () => {
  it("keeps hold of a target instead of noticing it over and over", () => {
    // Reported from play: a unit stutter-stepping under a strobing plan ring.
    // A hurler jostled by the crowd around it sat on the line where it both
    // acquires and forgets a target, and took the same encounter every few
    // frames. Nothing here throws — the whole fight is 21 metres of standing
    // around, and a plan every frame is the tell.
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = createSeededRandom(seed);
      const director = new CombatDirector(random);
      const jitter = createSeededRandom(seed + 40);
      const edge = LONG_THROW_RANGE * 1.35;
      let plans = 0;
      for (let elapsed = 0; elapsed < 20; elapsed += STEP) {
        // Shoved back and forth across the line the way a crowd shoves.
        const gap = edge + (jitter() - 0.5) * 0.3;
        const frame = director.update(STEP, [
          snapshot(1, "A", 0, random, "hurler"),
          snapshot(2, "B", gap, random, "melee"),
        ]);
        plans += frame.events.filter((event) => event.type === "plan").length;
      }
      // Acquiring once and holding on is one plan; a couple more is a hurler
      // changing its mind. Dozens is the encounter churning at frame rate.
      expect(plans).toBeLessThan(4);
    }
  });
});

describe("a battery of hurlers", () => {
  /** Positions a fighter freely, since a battery is a question about geometry. */
  function at(
    id: number, corporation: string, x: number, z: number,
    random: () => number, role: "melee" | "hurler", health = 100,
  ): CombatantSnapshot {
    return {
      id, corporation, role, health, maxHealth: 100, isAlive: true, x, z,
      profile: createCombatProfile(random),
    };
  }

  /** Runs long enough for every thrower to come off its wind-up and re-aim. */
  function settle(director: CombatDirector, fighters: CombatantSnapshot[], seconds: number) {
    let cues = director.update(STEP, fighters).cues;
    for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
      cues = director.update(STEP, fighters).cues;
    }
    return cues;
  }

  it("throws at one body together rather than one each", () => {
    const random = createSeededRandom(11);
    const director = new CombatDirector(random);
    const fighters = [
      at(1, "A", 0, -2, random, "hurler"), at(2, "A", 0, 0, random, "hurler"),
      at(3, "A", 0, 2, random, "hurler"),
      at(4, "B", 12, -2, random, "melee"), at(5, "B", 12, 0, random, "melee"),
      at(6, "B", 12, 2, random, "melee"),
    ];
    const cues = settle(director, fighters, 3);
    const aimed = [1, 2, 3].map((id) => cues.get(id)?.targetId);
    expect(new Set(aimed).size).toBe(1);
    expect(aimed[0]).not.toBeNull();
  });

  it("walks the crowd down weakest first, and swings across together", () => {
    const random = createSeededRandom(12);
    const director = new CombatDirector(random);
    const fighters = [
      at(1, "A", 0, -1, random, "hurler"), at(2, "A", 0, 1, random, "hurler"),
      at(3, "B", 12, -1, random, "melee"), at(4, "B", 12, 1, random, "melee", 20),
    ];
    // The hurt one at the same range is the one the battery works on.
    expect([...settle(director, fighters, 3)].filter(([id]) => id <= 2)
      .map(([, cue]) => cue.targetId)).toEqual([4, 4]);

    // It goes down, and both throwers come across to the survivor together.
    fighters[3].health = 0;
    fighters[3].isAlive = false;
    expect([...settle(director, fighters, 3)].filter(([id]) => id <= 2)
      .map(([, cue]) => cue.targetId)).toEqual([3, 3]);
  });

  it("comes off a far target onto one that closes on the throwers", () => {
    const random = createSeededRandom(13);
    const director = new CombatDirector(random);
    const fighters = [
      at(1, "A", 0, -1, random, "hurler"), at(2, "A", 0, 1, random, "hurler"),
      at(3, "B", 15, 0, random, "melee"),
    ];
    expect(settle(director, fighters, 3).get(1)?.targetId).toBe(3);

    // A second body walks out of the crowd and into their laps. Keeping it off
    // them outranks finishing the one at the back of the field.
    fighters.push(at(4, "B", 3.5, 0, random, "melee"));
    const cues = settle(director, fighters, 3);
    expect(cues.get(1)?.targetId).toBe(4);
    expect(cues.get(2)?.targetId).toBe(4);
  });

  it("splits into groups rather than putting a dozen rocks on one body", () => {
    const random = createSeededRandom(15);
    const director = new CombatDirector(random);
    const fighters: CombatantSnapshot[] = [];
    for (let n = 0; n < 12; n += 1) {
      fighters.push(at(n + 1, "A", 0, (n - 5.5) * 1.9, random, "hurler"));
    }
    for (let n = 0; n < 8; n += 1) {
      fighters.push(at(n + 13, "B", 12, (n - 3.5) * 1.9, random, "melee"));
    }
    const cues = settle(director, fighters, 3);
    const perTarget = new Map<number, number>();
    for (let n = 0; n < 12; n += 1) {
      const target = cues.get(n + 1)?.targetId;
      expect(target).not.toBeNull();
      perTarget.set(target!, (perTarget.get(target!) ?? 0) + 1);
    }
    // Three rocks put a fresh body down, so three throwers is a volley and the
    // rest of the battery is somewhere else. Twelve on one is what this is for.
    for (const count of perTarget.values()) expect(count).toBeLessThanOrEqual(3);
    expect(perTarget.size).toBeGreaterThanOrEqual(4);
    // Groups of two, not of one: a rock is swatted often enough that a single
    // thrower on a body is a body that may not go down. A straggler mid-wind-up
    // on a body the group has already left is allowed — it cannot re-aim.
    const alone = [...perTarget.values()].filter((count) => count < 2);
    expect(alone.length).toBeLessThanOrEqual(1);
  });

  it("never hands a hurler a sword plan when it cannot reach anything", () => {
    const random = createSeededRandom(14);
    const director = new CombatDirector(random);
    // The swords are in a fight the hurler is far too far away to throw into.
    const fighters = [
      at(1, "A", 0, 0, random, "hurler"),
      at(2, "A", 17, 0, random, "melee"), at(3, "B", 19.5, 0, random, "melee"),
    ];
    for (let elapsed = 0; elapsed < 4; elapsed += STEP) {
      const frame = director.update(STEP, fighters);
      const cue = frame.cues.get(1)!;
      if (cue.strategy !== null) expect(THROW_TYPES).toContain(cue.strategy);
      expect(cue.movement).not.toBe("close");
      for (const event of frame.events) expect(event.attackerId).not.toBe(1);
    }
  });
});

describe("a hurler under pressure", () => {
  it("holds near its standoff while it is left alone", () => {
    // Two hurlers have no way to close on each other, so the gap they settle at
    // is the range they both want to work from.
    const random = createSeededRandom(3);
    const director = new CombatDirector(random);
    const units = [
      createRigwalker(null, 0xffffff, "Helios", random, { role: "hurler" }),
      createRigwalker(null, 0xffffff, "Vanguard", random, { role: "hurler" }),
    ];
    units[0].group.position.set(-9, 0.2, 0);
    units[1].group.position.set(9, 0.2, 0);
    let gap = 18;
    for (let elapsed = 0; elapsed < 30; elapsed += STEP) {
      const snapshots: CombatantSnapshot[] = units.map((unit) => ({
        id: unit.combatId, corporation: unit.corporation, role: unit.role,
        health: 100, maxHealth: 100, isAlive: true,
        x: unit.group.position.x, z: unit.group.position.z, profile: unit.combatProfile,
      }));
      const frame = director.update(STEP, snapshots);
      const field = unitField(units);
      for (const unit of units) {
        unit.update(STEP, elapsed, flat, field, [], CAMERA, frame.cues.get(unit.combatId));
      }
      gap = units[0].group.position.distanceTo(units[1].group.position);
    }
    expect(gap).toBeGreaterThan(MEDIUM_THROW_RANGE);
    expect(gap).toBeLessThan(LONG_THROW_RANGE);
  });

  it("is walked down through all three bands and killed by a swordsman", () => {
    let sawEveryBand = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { gaps, defeats } = runFight(seed, 60, 9);
      // Opens outside sword reach and ends inside it: the swordsman crosses the
      // standoff rather than the hurler kiting forever.
      expect(Math.max(...gaps)).toBeGreaterThan(MEDIUM_THROW_RANGE);
      expect(Math.min(...gaps)).toBeLessThan(SHORT_THROW_RANGE);
      expect(defeats).toBeGreaterThan(0);
      const bands = new Set(gaps.map((gap) => throwTypeForDistance(gap)));
      if (bands.has("hurl") && bands.has("pitch") && bands.has("toss")) sawEveryBand += 1;
    }
    expect(sawEveryBand).toBeGreaterThan(3);
  });
});
