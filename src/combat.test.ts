import { describe, expect, it } from "vitest";
import {
  CombatDirector,
  createCombatProfile,
  type CombatCue,
  type CombatantSnapshot,
} from "./combat";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fighter(
  id: number,
  corporation: string,
  x: number,
  random: () => number,
): CombatantSnapshot {
  return {
    id,
    corporation,
    health: 100,
    maxHealth: 100,
    isAlive: true,
    x,
    z: 0,
    profile: createCombatProfile(random),
  };
}

function simulate(seed: number): {
  seconds: number;
  blockedDamage: number;
  cues: CombatCue[];
} {
  const random = seededRandom(seed);
  const director = new CombatDirector(random);
  const fighters = [fighter(1, "A", 0, random), fighter(2, "B", 2.7, random)];
  const cues: CombatCue[] = [];
  let blockedDamage = 0;
  let seconds = 0;
  while (fighters.filter((item) => item.isAlive).length > 1 && seconds < 120) {
    const frame = director.update(1 / 30, fighters);
    for (const cue of frame.cues.values()) {
      if (cue.targetId !== null) cues.push(cue);
    }
    for (const event of frame.damage) {
      const target = fighters.find((item) => item.id === event.targetId)!;
      if (frame.cues.get(target.id)?.outcome === "blocked") blockedDamage += event.amount;
      target.health = Math.max(0, target.health - event.amount);
      target.isAlive = target.health > 0;
    }
    seconds += 1 / 30;
  }
  return { seconds, blockedDamage, cues };
}

describe("CombatDirector", () => {
  it("creates mutual readable duels without assigning a fighter twice", () => {
    const random = seededRandom(7);
    const director = new CombatDirector(random);
    const fighters = [
      fighter(1, "A", 0, random), fighter(2, "B", 2.7, random),
      fighter(3, "A", 5.4, random), fighter(4, "B", 8.1, random),
    ];
    const targets = new Map(
      [...director.update(1 / 30, fighters).cues].filter(([, cue]) => cue.targetId !== null),
    );
    for (const [id, cue] of targets) expect(targets.get(cue.targetId!)?.targetId).toBe(id);
  });

  it("never applies damage to a successfully blocked action", () => {
    for (let seed = 1; seed <= 40; seed += 1) expect(simulate(seed).blockedDamage).toBe(0);
  });

  it("creates all persistent temperaments with distinct dominant traits", () => {
    const temperamentRandom = seededRandom(1000);
    const profiles = Array.from({ length: 256 }, () =>
      createCombatProfile(temperamentRandom),
    );
    const byTemperament = new Map(profiles.map((profile) => [profile.temperament, profile]));
    expect([...byTemperament.keys()].sort()).toEqual(["adaptive", "bold", "patient", "reactive"]);
    expect(byTemperament.get("bold")!.aggression).toBeGreaterThan(byTemperament.get("bold")!.patience);
    expect(byTemperament.get("reactive")!.defense).toBeGreaterThan(byTemperament.get("reactive")!.aggression);
    expect(byTemperament.get("patient")!.patience).toBeGreaterThan(byTemperament.get("patient")!.initiative);
    expect(byTemperament.get("adaptive")!.adaptability).toBeGreaterThan(0.8);
  });

  it("produces bold, reactive, patient, and deceptive openings", () => {
    const openings = new Set<string>();
    for (let seed = 1; seed <= 160; seed += 1) {
      const first = simulate(seed).cues.find((cue) => cue.strategy !== null);
      if (first?.strategy) openings.add(first.strategy);
    }
    expect(openings.has("rush")).toBe(true);
    expect(openings.has("react")).toBe(true);
    expect(openings.has("size-up")).toBe(true);
    expect(openings.has("feint")).toBe(true);
  });

  it("finishes seeded duels without deadlock and near the brisk spectacle target", () => {
    const durations = Array.from({ length: 96 }, (_, index) => simulate(index + 1).seconds)
      .sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    expect(durations.at(-1)).toBeLessThan(120);
    expect(median).toBeGreaterThanOrEqual(15);
    expect(median).toBeLessThanOrEqual(25);
  });

  it("exposes only cut-and-block action vocabulary", () => {
    const actions = ["idle", "size-up", "attack", "block", "hit", "recover", "defeated"];
    expect(actions).not.toContain("thrust");
    expect(actions).not.toContain("stab");
  });
});
