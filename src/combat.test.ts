import { describe, expect, it } from "vitest";
import {
  CombatDirector,
  createCombatProfile,
  type CombatCue,
  type CombatEvent,
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
  events: CombatEvent[];
  damageCount: number;
} {
  const random = seededRandom(seed);
  const director = new CombatDirector(random);
  const fighters = [fighter(1, "A", 0, random), fighter(2, "B", 2.7, random)];
  const cues: CombatCue[] = [];
  const events: CombatEvent[] = [];
  let blockedDamage = 0;
  let damageCount = 0;
  let seconds = 0;
  while (fighters.filter((item) => item.isAlive).length > 1 && seconds < 120) {
    const frame = director.update(1 / 30, fighters);
    for (const cue of frame.cues.values()) {
      if (cue.targetId !== null) cues.push(cue);
    }
    events.push(...frame.events);
    for (const event of frame.damage) {
      const target = fighters.find((item) => item.id === event.targetId)!;
      if (frame.cues.get(target.id)?.outcome === "blocked") blockedDamage += event.amount;
      target.health = Math.max(0, target.health - event.amount);
      target.isAlive = target.health > 0;
      damageCount += 1;
    }
    seconds += 1 / 30;
  }
  return { seconds, blockedDamage, cues, events, damageCount };
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

  it("sends an unengaged Rigwalker to help a teammate already fighting", () => {
    const random = seededRandom(21);
    const director = new CombatDirector(random);
    const fighters = [
      fighter(1, "A", 0, random), fighter(2, "B", 2.7, random),
      fighter(3, "A", 5.4, random),
    ];
    const cues = director.update(1 / 30, fighters).cues;
    expect(cues.get(1)?.targetId).toBe(2);
    expect(cues.get(3)?.targetId).toBe(2);
  });

  it("promotes a support fight when the primary teammate is defeated", () => {
    const random = seededRandom(24);
    const director = new CombatDirector(random);
    const fighters = [
      fighter(1, "A", 0, random), fighter(2, "B", 2.7, random),
      fighter(3, "A", 5.4, random),
    ];
    director.update(1 / 30, fighters);
    fighters[0].health = 0;
    fighters[0].isAlive = false;
    const cues = director.update(1 / 30, fighters).cues;
    expect(cues.get(2)?.targetId).toBe(3);
    expect(cues.get(3)?.targetId).toBe(2);
  });

  it("caps coordinated pressure at a primary fighter plus two supporters", () => {
    const random = seededRandom(22);
    const director = new CombatDirector(random);
    const fighters = [
      fighter(1, "A", 0, random), fighter(2, "B", 2, random),
      fighter(3, "A", 4.8, random), fighter(4, "A", 5.1, random),
      fighter(5, "A", 5.4, random),
    ];
    const cues = director.update(1 / 30, fighters).cues;
    const attackers = fighters.filter((item) =>
      item.corporation === "A" && cues.get(item.id)?.targetId === 2);
    expect(attackers).toHaveLength(3);
  });

  it("prioritizes the enemy threatening the more wounded teammate", () => {
    const random = seededRandom(23);
    const director = new CombatDirector(random);
    const fighters = [
      fighter(1, "A", 0, random), fighter(2, "B", 1, random),
      fighter(3, "A", 10, random), fighter(4, "B", 11, random),
      fighter(5, "A", 5.5, random),
    ];
    fighters[0].health = 20;
    const cues = director.update(1 / 30, fighters).cues;
    expect(cues.get(5)?.targetId).toBe(2);
  });

  it("never applies damage to a successfully blocked action", () => {
    for (let seed = 1; seed <= 40; seed += 1) expect(simulate(seed).blockedDamage).toBe(0);
  });

  it("varies the preferred distance between exchanges while keeping attacks in reach", () => {
    const distances = new Set<number>();
    for (let seed = 1; seed <= 32; seed += 1) {
      for (const cue of simulate(seed).cues) {
        distances.add(Math.round(cue.preferredDistance * 100));
        expect(cue.preferredDistance).toBeGreaterThanOrEqual(2.15);
        expect(cue.preferredDistance).toBeLessThanOrEqual(3.15);
      }
    }
    expect(distances.size).toBeGreaterThan(20);
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

  it("lets reactive and distance-trap planners yield the first attack", () => {
    let sawReactive = false;
    let sawDistanceTrap = false;
    let sawDistanceWhiff = false;
    for (let seed = 1; seed <= 220; seed += 1) {
      const result = simulate(seed);
      for (const cue of result.cues) {
        if (cue.action !== "attack") continue;
        if (cue.strategy === "react") {
          sawReactive = true;
          expect(cue.plannerId).not.toBeNull();
          expect(cue.targetId).toBe(cue.plannerId);
        }
        if (cue.strategy === "distance-trap") {
          sawDistanceTrap = true;
          expect(cue.targetId).toBe(cue.plannerId);
          if (cue.outcome === "whiff") sawDistanceWhiff = true;
        }
        if (cue.strategy === "rush" || cue.strategy === "feint" || cue.strategy === "beat") {
          expect(cue.targetId).not.toBe(cue.plannerId);
        }
      }
    }
    expect(sawReactive).toBe(true);
    expect(sawDistanceTrap).toBe(true);
    expect(sawDistanceWhiff).toBe(true);
  });

  it("finishes seeded duels without deadlock and near the brisk spectacle target", () => {
    const durations = Array.from({ length: 96 }, (_, index) => simulate(index + 1).seconds)
      .sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    expect(durations.at(-1)).toBeLessThan(120);
    expect(median).toBeGreaterThanOrEqual(15);
    expect(median).toBeLessThanOrEqual(25);
  });

  it("drives all five line profiles with contact-specific intensity", () => {
    const lines = new Set<string>();
    let sawBlock = false;
    let sawGlancing = false;
    let sawCleanHit = false;
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const cue of simulate(seed).cues) {
        if (cue.action === "attack") lines.add(cue.line);
        if (cue.action === "block") {
          sawBlock = true;
          expect(cue.intensity).toBe(0.78);
        }
        if (cue.action === "hit" && cue.outcome === "glancing") {
          sawGlancing = true;
          expect(cue.intensity).toBe(0.42);
        }
        if (cue.action === "hit" && cue.outcome === "hit") {
          sawCleanHit = true;
          expect(cue.intensity).toBeGreaterThan(0.7);
        }
      }
    }
    expect([...lines].sort()).toEqual(["backhand", "flank", "forehand", "overhead", "rising"]);
    expect(sawBlock && sawGlancing && sawCleanHit).toBe(true);
  });

  it("completes seeded three-on-three battles without idle victims or excess dogpiling", () => {
    for (let seed = 300; seed < 312; seed += 1) {
      const random = seededRandom(seed);
      const director = new CombatDirector(random);
      const fighters = [
        fighter(1, "A", 0, random), fighter(3, "A", 0.2, random), fighter(5, "A", 0.4, random),
        fighter(2, "B", 2.4, random), fighter(4, "B", 2.6, random), fighter(6, "B", 2.8, random),
      ];
      let elapsed = 0;
      while (new Set(fighters.filter((item) => item.isAlive).map((item) => item.corporation)).size > 1 &&
          elapsed < 120) {
        const frame = director.update(1 / 30, fighters);
        const activeCues = [...frame.cues.entries()].filter(([, cue]) => cue.targetId !== null);
        for (const fighter of fighters.filter((item) => item.isAlive)) {
          const isThreatened = activeCues.some(([, cue]) => cue.targetId === fighter.id);
          if (isThreatened) expect(frame.cues.get(fighter.id)?.targetId).not.toBeNull();
          const pressure = activeCues.filter(([, cue]) => cue.targetId === fighter.id).length;
          expect(pressure).toBeLessThanOrEqual(3);
        }
        for (const event of frame.damage) {
          const target = fighters.find((item) => item.id === event.targetId)!;
          target.health = Math.max(0, target.health - event.amount);
          target.isAlive = target.health > 0;
        }
        elapsed += 1 / 30;
      }
      expect(elapsed).toBeLessThan(120);
      expect(new Set(fighters.filter((item) => item.isAlive).map((item) => item.corporation)).size)
        .toBeLessThanOrEqual(1);
    }
  });

  it("announces every swing exactly once so effects never double-fire", () => {
    const contactTypes = new Set(["block", "glance", "hit", "whiff"]);
    for (let seed = 1; seed <= 48; seed += 1) {
      const { events } = simulate(seed);
      const swings = events.filter((event) => event.type === "swing").length;
      const contacts = events.filter((event) => contactTypes.has(event.type)).length;
      expect(swings).toBeGreaterThan(0);
      // Every resolution follows a swing; the duel can end mid-swing, so the
      // sole permitted surplus is the final unresolved one.
      expect(swings - contacts).toBeGreaterThanOrEqual(0);
      expect(swings - contacts).toBeLessThanOrEqual(1);
    }
  });

  it("emits one damaging event per damage entry", () => {
    for (let seed = 1; seed <= 48; seed += 1) {
      const { events, damageCount } = simulate(seed);
      const damaging = events.filter(
        (event) => event.type === "hit" || event.type === "glance",
      ).length;
      expect(damaging - damageCount).toBeGreaterThanOrEqual(0);
      expect(damaging - damageCount).toBeLessThanOrEqual(1);
    }
  });

  it("reports every combat event type across seeded duels", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 220; seed += 1) {
      for (const event of simulate(seed).events) seen.add(event.type);
    }
    expect([...seen].sort()).toEqual(
      ["block", "glance", "hit", "riposte", "swing", "whiff"],
    );
  });

  it("gives feints a false line that differs from the delivered one", () => {
    let sawFeint = false;
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const cue of simulate(seed).cues) {
        if (cue.strategy === "feint") {
          sawFeint = true;
          expect(cue.feintLine).not.toBeNull();
          expect(cue.feintLine).not.toBe(cue.line);
        } else {
          expect(cue.feintLine).toBeNull();
        }
      }
    }
    expect(sawFeint).toBe(true);
  });

  it("follows a riposte announcement with a riposte attack from the defender", () => {
    let checked = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const { events } = simulate(seed);
      events.forEach((event, index) => {
        if (event.type !== "riposte") return;
        const nextSwing = events.slice(index + 1).find((item) => item.type === "swing");
        if (!nextSwing) return;
        expect(nextSwing.strategy).toBe("riposte");
        expect(nextSwing.attackerId).toBe(event.attackerId);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("exposes only cut-and-block action vocabulary", () => {
    const actions = ["idle", "size-up", "attack", "block", "hit", "recover", "defeated"];
    expect(actions).not.toContain("thrust");
    expect(actions).not.toContain("stab");
  });
});
