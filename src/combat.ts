export type CombatTemperament = "bold" | "reactive" | "patient" | "adaptive";

export type CombatStrategy =
  | "rush"
  | "react"
  | "size-up"
  | "feint"
  | "distance-trap"
  | "beat"
  | "riposte";

export type AttackLine = "overhead" | "forehand" | "backhand" | "flank" | "rising";
export type CombatAction = "idle" | "size-up" | "attack" | "block" | "hit" | "recover" | "defeated";
export type CombatMovement = "hold" | "close" | "retreat" | "angle-left" | "angle-right";
export type CombatOutcome = "pending" | "blocked" | "glancing" | "hit" | "whiff";

export type CombatProfile = {
  temperament: CombatTemperament;
  initiative: number;
  patience: number;
  defense: number;
  deception: number;
  aggression: number;
  adaptability: number;
};

export type CombatCue = {
  plannerId: number | null;
  targetId: number | null;
  action: CombatAction;
  movement: CombatMovement;
  phase: number;
  strategy: CombatStrategy | null;
  line: AttackLine;
  variant: number;
  side: -1 | 1;
  intensity: number;
  outcome: CombatOutcome;
};

export type CombatantSnapshot = {
  id: number;
  corporation: string;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  x: number;
  z: number;
  profile: CombatProfile;
};

export type CombatFrame = {
  cues: Map<number, CombatCue>;
  damage: Array<{ targetId: number; amount: number; outcome: "glancing" | "hit"; side: -1 | 1 }>;
};

type Memory = {
  lines: Record<AttackLine, number>;
  direct: number;
  deceptive: number;
  exchanges: number;
};

type FighterState = {
  memory: Memory;
  recentStrategies: CombatStrategy[];
  plans: number;
};

type Exchange = {
  plannerId: number;
  attackerId: number;
  defenderId: number;
  strategy: CombatStrategy;
  line: AttackLine;
  variant: number;
  side: -1 | 1;
  measureDuration: number;
  attackDuration: number;
  recoveryDuration: number;
  elapsed: number;
  outcome: CombatOutcome;
  damageApplied: boolean;
  chainDepth: number;
};

type Encounter = {
  a: number;
  b: number;
  support: boolean;
  exchange: Exchange;
};

const AWARENESS_RANGE = 8.5;
const ATTACK_RANGE = 3.25;
const MAX_SUPPORTERS_PER_TARGET = 2;
const LINES: readonly AttackLine[] = ["overhead", "forehand", "backhand", "flank", "rising"];
const EMPTY_CUE: CombatCue = {
  plannerId: null,
  targetId: null,
  action: "idle",
  movement: "hold",
  phase: 0,
  strategy: null,
  line: "overhead",
  variant: 0,
  side: 1,
  intensity: 0,
  outcome: "pending",
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function weightedChoice<T>(items: readonly T[], weights: readonly number[], random: () => number): T {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  let cursor = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= Math.max(0, weights[index]);
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1];
}

function freshMemory(): Memory {
  return {
    lines: { overhead: 0, forehand: 0, backhand: 0, flank: 0, rising: 0 },
    direct: 0,
    deceptive: 0,
    exchanges: 0,
  };
}

export function createCombatProfile(random: () => number = Math.random): CombatProfile {
  const temperaments: readonly CombatTemperament[] = ["bold", "reactive", "patient", "adaptive"];
  const temperament = temperaments[Math.floor(random() * temperaments.length)];
  const bases: Record<CombatTemperament, Omit<CombatProfile, "temperament">> = {
    bold: { initiative: 0.9, patience: 0.32, defense: 0.58, deception: 0.42, aggression: 0.9, adaptability: 0.58 },
    reactive: { initiative: 0.52, patience: 0.62, defense: 0.9, deception: 0.48, aggression: 0.48, adaptability: 0.78 },
    patient: { initiative: 0.38, patience: 0.92, defense: 0.82, deception: 0.55, aggression: 0.38, adaptability: 0.88 },
    adaptive: { initiative: 0.62, patience: 0.68, defense: 0.72, deception: 0.88, aggression: 0.62, adaptability: 0.95 },
  };
  const base = bases[temperament];
  const vary = (value: number) => clamp01(value + (random() - 0.5) * 0.16);
  return {
    temperament,
    initiative: vary(base.initiative),
    patience: vary(base.patience),
    defense: vary(base.defense),
    deception: vary(base.deception),
    aggression: vary(base.aggression),
    adaptability: vary(base.adaptability),
  };
}

export class CombatDirector {
  private readonly encounters = new Map<string, Encounter>();
  private readonly fighters = new Map<number, FighterState>();

  constructor(private readonly random: () => number = Math.random) {}

  update(delta: number, snapshots: readonly CombatantSnapshot[]): CombatFrame {
    const living = snapshots.filter((fighter) => fighter.isAlive);
    const byId = new Map(living.map((fighter) => [fighter.id, fighter]));
    const cues = new Map<number, CombatCue>();
    const damage: CombatFrame["damage"] = [];
    for (const fighter of snapshots) cues.set(fighter.id, { ...EMPTY_CUE });

    for (const [key, encounter] of this.encounters) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b || a.corporation === b.corporation || this.distance(a, b) > AWARENESS_RANGE * 1.35) {
        this.encounters.delete(key);
      }
    }

    const primaryParticipants = new Set<number>();
    for (const encounter of this.encounters.values()) {
      if (!encounter.support) {
        primaryParticipants.add(encounter.a);
        primaryParticipants.add(encounter.b);
      }
    }
    const promotedTargets = new Set<number>();
    for (const encounter of this.encounters.values()) {
      if (!encounter.support || primaryParticipants.has(encounter.b) || promotedTargets.has(encounter.b)) {
        continue;
      }
      encounter.support = false;
      primaryParticipants.add(encounter.a);
      primaryParticipants.add(encounter.b);
      promotedTargets.add(encounter.b);
    }

    const reserved = new Set<number>();
    const supportCounts = new Map<number, number>();
    for (const encounter of this.encounters.values()) {
      reserved.add(encounter.a);
      if (encounter.support) {
        supportCounts.set(encounter.b, (supportCounts.get(encounter.b) ?? 0) + 1);
      } else {
        reserved.add(encounter.b);
      }
    }

    const candidates: Array<{ a: CombatantSnapshot; b: CombatantSnapshot; distance: number }> = [];
    for (let aIndex = 0; aIndex < living.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < living.length; bIndex += 1) {
        const a = living[aIndex];
        const b = living[bIndex];
        if (a.corporation === b.corporation || reserved.has(a.id) || reserved.has(b.id)) continue;
        const distance = this.distance(a, b);
        if (distance <= AWARENESS_RANGE) candidates.push({ a, b, distance });
      }
    }
    candidates.sort((left, right) => left.distance - right.distance);
    for (const candidate of candidates) {
      if (reserved.has(candidate.a.id) || reserved.has(candidate.b.id)) continue;
      const encounter = this.createEncounter(candidate.a, candidate.b);
      this.encounters.set(this.key(candidate.a.id, candidate.b.id), encounter);
      reserved.add(candidate.a.id);
      reserved.add(candidate.b.id);
    }

    const primaryThreats: Array<{ ally: CombatantSnapshot; target: CombatantSnapshot }> = [];
    for (const encounter of this.encounters.values()) {
      if (encounter.support) continue;
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      primaryThreats.push({ ally: a, target: b }, { ally: b, target: a });
    }
    for (const helper of living) {
      if (reserved.has(helper.id)) continue;
      const choices = primaryThreats
        .filter(({ ally, target }) =>
          ally.corporation === helper.corporation && ally.id !== helper.id &&
          target.corporation !== helper.corporation &&
          this.distance(helper, target) <= AWARENESS_RANGE * 1.15 &&
          (supportCounts.get(target.id) ?? 0) < MAX_SUPPORTERS_PER_TARGET)
        .map(({ ally, target }) => ({
          ally, target,
          score: this.distance(helper, target) +
            (ally.health / ally.maxHealth) * 2 +
            (target.health / target.maxHealth) * 0.35,
        }))
        .sort((left, right) => left.score - right.score);
      const choice = choices[0];
      if (!choice) continue;
      const encounter = this.createSupportEncounter(helper, choice.target);
      this.encounters.set("support:" + helper.id + ":" + choice.target.id, encounter);
      reserved.add(helper.id);
      supportCounts.set(choice.target.id, (supportCounts.get(choice.target.id) ?? 0) + 1);
    }

    for (const encounter of this.encounters.values()) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      this.advanceEncounter(encounter, a, b, delta, cues, damage);
    }

    return { cues, damage };
  }

  private createEncounter(a: CombatantSnapshot, b: CombatantSnapshot): Encounter {
    this.ensureFighter(a.id);
    this.ensureFighter(b.id);
    const initiativeA = a.profile.initiative + a.profile.aggression * 0.45 + this.random() * 0.35;
    const initiativeB = b.profile.initiative + b.profile.aggression * 0.45 + this.random() * 0.35;
    const attacker = initiativeA >= initiativeB ? a : b;
    const defender = attacker === a ? b : a;
    return { a: a.id, b: b.id, support: false, exchange: this.planExchange(attacker, defender, 0) };
  }

  private createSupportEncounter(helper: CombatantSnapshot, target: CombatantSnapshot): Encounter {
    this.ensureFighter(helper.id);
    this.ensureFighter(target.id);
    return {
      a: helper.id, b: target.id, support: true,
      exchange: this.planExchange(helper, target, 0, undefined, true),
    };
  }

  private planExchange(
    attacker: CombatantSnapshot,
    defender: CombatantSnapshot,
    chainDepth: number,
    forcedStrategy?: CombatStrategy,
    offensiveOnly = false,
  ): Exchange {
    const state = this.ensureFighter(attacker.id);
    const healthRatio = attacker.health / attacker.maxHealth;
    const opponentRatio = defender.health / defender.maxHealth;
    const firstExchange = state.plans === 0;
    state.plans += 1;
    const strategies: readonly CombatStrategy[] = offensiveOnly
      ? ["rush", "feint", "beat"]
      : firstExchange
        ? ["rush", "react", "size-up", "feint"]
        : ["rush", "react", "size-up", "feint", "distance-trap", "beat"];
    const p = attacker.profile;
    const weights = strategies.map((strategy) => {
      let weight =
        strategy === "rush" ? p.initiative + p.aggression :
        strategy === "react" ? p.defense + p.patience * 0.55 :
        strategy === "size-up" ? p.patience * 1.35 + p.adaptability * 0.35 :
        strategy === "feint" ? p.deception + p.adaptability * 0.45 :
        strategy === "distance-trap" ? p.defense + p.adaptability * 0.7 :
        p.aggression + p.deception * 0.65;
      if (p.temperament === "bold" && strategy === "rush") weight += 1.2;
      if (p.temperament === "reactive" && strategy === "react") weight += 1.1;
      if (p.temperament === "patient" && (strategy === "size-up" || strategy === "distance-trap")) weight += 1.25;
      if (p.temperament === "adaptive" && (strategy === "feint" || strategy === "beat")) weight += 1.1;
      if (healthRatio < opponentRatio - 0.2 && (strategy === "react" || strategy === "distance-trap")) {
        weight += 0.8;
      }
      if (state.recentStrategies.includes(strategy)) weight *= 0.55;
      return weight;
    });
    const strategy = forcedStrategy ?? weightedChoice(strategies, weights, this.random);
    const defensivePlan = strategy === "react" || strategy === "distance-trap";
    const actualAttacker = defensivePlan ? defender : attacker;
    const actualDefender = defensivePlan ? attacker : defender;
    const defenderMemory = this.ensureFighter(defender.id).memory;
    const lineWeights = LINES.map((line) => {
      const seen = defenderMemory.lines[line];
      return 1 + p.adaptability * Math.max(0, defenderMemory.exchanges * 0.45 - seen);
    });
    const line = weightedChoice(LINES, lineWeights, this.random);
    const variant = LINES.indexOf(line);
    const side: -1 | 1 = line === "backhand" || line === "rising" ? -1 : 1;
    const measureDuration =
      strategy === "rush" ? 0.1 + this.random() * 0.25 :
      strategy === "react" ? 0.25 + this.random() * 0.4 :
      strategy === "size-up" ? (firstExchange ? 1.5 + this.random() * 1.5 : 0.45 + this.random() * 0.55) :
      strategy === "distance-trap" ? 0.7 + this.random() * 0.7 :
      strategy === "riposte" ? 0.12 + this.random() * 0.12 :
      0.35 + this.random() * 0.45;
    return {
      plannerId: attacker.id,
      attackerId: actualAttacker.id,
      defenderId: actualDefender.id,
      strategy,
      line,
      variant,
      side,
      measureDuration,
      attackDuration: strategy === "riposte" ? 0.82 : strategy === "rush" ? 0.95 : 1.08,
      recoveryDuration: 0.32 + this.random() * 0.28,
      elapsed: 0,
      outcome: "pending",
      damageApplied: false,
      chainDepth,
    };
  }

  private advanceEncounter(
    encounter: Encounter,
    a: CombatantSnapshot,
    b: CombatantSnapshot,
    delta: number,
    cues: Map<number, CombatCue>,
    damage: CombatFrame["damage"],
  ): void {
    const exchange = encounter.exchange;
    const attacker = exchange.attackerId === a.id ? a : b;
    const defender = exchange.defenderId === a.id ? a : b;
    const distance = this.distance(attacker, defender);
    exchange.elapsed += delta;

    if (distance > ATTACK_RANGE) {
      exchange.elapsed = Math.min(exchange.elapsed, exchange.measureDuration);
      cues.set(attacker.id, this.cue(exchange, defender.id, "size-up", "close", 0));
      if (!encounter.support) {
        cues.set(defender.id, this.cue(exchange, attacker.id, "size-up", "hold", 0));
      }
      return;
    }

    const occupiedCue = cues.get(defender.id);
    if (encounter.support && exchange.elapsed >= exchange.measureDuration &&
        (occupiedCue?.action === "attack" || occupiedCue?.action === "block")) {
      exchange.elapsed = exchange.measureDuration;
      cues.set(attacker.id, this.cue(
        exchange, defender.id, "size-up", exchange.side > 0 ? "angle-left" : "angle-right", 1,
      ));
      return;
    }

    if (exchange.elapsed < exchange.measureDuration) {
      const phase = exchange.elapsed / exchange.measureDuration;
      const attackerMove: CombatMovement =
        exchange.strategy === "distance-trap" || exchange.strategy === "react" ? "close" :
        exchange.strategy === "size-up" ? (exchange.side > 0 ? "angle-left" : "angle-right") :
        "hold";
      cues.set(attacker.id, this.cue(exchange, defender.id, "size-up", attackerMove, phase));
      if (!encounter.support) {
        cues.set(defender.id, this.cue(
          exchange, attacker.id, "size-up",
          exchange.strategy === "distance-trap" ? "retreat" : phase > 0.55 ? "angle-right" : "hold",
          phase,
        ));
      }
      return;
    }

    const attackElapsed = exchange.elapsed - exchange.measureDuration;
    if (attackElapsed <= exchange.attackDuration) {
      const phase = clamp01(attackElapsed / exchange.attackDuration);
      if (exchange.outcome === "pending" && phase >= 0.46) {
        exchange.outcome = this.resolveOutcome(exchange, attacker, defender);
      }
      const defenderAction: CombatAction =
        phase < 0.34 ? "size-up" :
        exchange.outcome === "blocked" ? "block" :
        exchange.outcome === "whiff" ? "size-up" :
        phase >= 0.5 ? "hit" : "block";
      const defenderMove: CombatMovement =
        exchange.outcome === "whiff" ? "retreat" :
        exchange.strategy === "distance-trap" ? "retreat" :
        "hold";
      cues.set(attacker.id, this.cue(exchange, defender.id, "attack", "hold", phase));
      if (!encounter.support || (phase >= 0.48 && exchange.outcome !== "whiff")) {
        cues.set(defender.id, this.cue(exchange, attacker.id, defenderAction, defenderMove, phase));
      }
      if (!exchange.damageApplied && phase >= 0.54) {
        if (exchange.outcome === "hit" || exchange.outcome === "glancing") {
          const base =
            exchange.strategy === "rush" ? 28 :
            exchange.strategy === "beat" ? 20 :
            exchange.strategy === "riposte" ? 22 :
            exchange.line === "rising" ? 18 :
            24;
          damage.push({
            targetId: defender.id,
            amount: exchange.outcome === "glancing" ? Math.round(base * 0.35) : base,
            outcome: exchange.outcome,
            side: exchange.side,
          });
        }
        exchange.damageApplied = true;
      }
      return;
    }

    const recoveryPhase = clamp01(
      (attackElapsed - exchange.attackDuration) / exchange.recoveryDuration,
    );
    cues.set(attacker.id, this.cue(exchange, defender.id, "recover", "retreat", recoveryPhase));
    if (!encounter.support) {
      cues.set(defender.id, this.cue(exchange, attacker.id, "recover", "hold", recoveryPhase));
    }
    if (recoveryPhase < 1) return;

    this.recordExchange(exchange);
    if (encounter.support) {
      encounter.exchange = this.planExchange(a, b, 0, undefined, true);
      return;
    }
    if ((exchange.outcome === "blocked" || exchange.outcome === "whiff") &&
        exchange.chainDepth < 2 && this.random() < (exchange.outcome === "whiff" ? 0.9 : 0.78)) {
      encounter.exchange = this.planExchange(defender, attacker, exchange.chainDepth + 1, "riposte");
    } else {
      const nextAttacker =
        exchange.outcome === "hit" && this.random() < 0.58 ? attacker :
        this.random() < 0.5 ? attacker : defender;
      const nextDefender = nextAttacker.id === attacker.id ? defender : attacker;
      encounter.exchange = this.planExchange(nextAttacker, nextDefender, 0);
    }
  }

  private resolveOutcome(
    exchange: Exchange,
    attacker: CombatantSnapshot,
    defender: CombatantSnapshot,
  ): CombatOutcome {
    if (exchange.strategy === "distance-trap" && this.random() <
        0.35 + defender.profile.patience * 0.4 + defender.profile.adaptability * 0.15) {
      return "whiff";
    }
    const defenderState = this.ensureFighter(defender.id);
    const learnedLine = defenderState.memory.lines[exchange.line] /
      Math.max(1, defenderState.memory.exchanges);
    const tacticalDefense =
      exchange.strategy === "react"
        ? defender.profile.defense * 0.18 + defender.profile.adaptability * 0.1
        : exchange.strategy === "distance-trap" ? defender.profile.patience * 0.12 : 0;
    const attackPressure =
      exchange.strategy === "feint" ? attacker.profile.deception * 0.25 :
      exchange.strategy === "beat" ? 0.12 + attacker.profile.aggression * 0.12 :
      exchange.strategy === "rush" ? attacker.profile.initiative * 0.1 :
      exchange.strategy === "size-up" ? attacker.profile.adaptability * 0.1 :
      exchange.strategy === "riposte" ? 0.18 : 0;
    const defenseChance = clamp01(
      0.17 + defender.profile.defense * 0.25 +
      defender.profile.adaptability * learnedLine * 0.25 + tacticalDefense - attackPressure,
    );
    const roll = this.random();
    if (roll < defenseChance) return "blocked";
    if (roll < defenseChance + 0.12) return "glancing";
    return "hit";
  }

  private recordExchange(exchange: Exchange): void {
    const planner = this.ensureFighter(exchange.plannerId);
    const observer = this.ensureFighter(exchange.defenderId);
    observer.memory.lines[exchange.line] += 1;
    observer.memory.exchanges += 1;
    if (exchange.strategy === "feint" || exchange.strategy === "beat") observer.memory.deceptive += 1;
    else observer.memory.direct += 1;
    planner.recentStrategies.push(exchange.strategy);
    if (planner.recentStrategies.length > 2) planner.recentStrategies.shift();
  }

  private cue(
    exchange: Exchange,
    targetId: number,
    action: CombatAction,
    movement: CombatMovement,
    phase: number,
  ): CombatCue {
    return {
      plannerId: exchange.plannerId,
      targetId,
      action,
      movement,
      phase: clamp01(phase),
      strategy: exchange.strategy,
      line: exchange.line,
      variant: exchange.variant,
      side: exchange.side,
      intensity: action === "hit" && exchange.outcome === "glancing" ? 0.42 :
        action === "block" ? 0.78 :
        exchange.strategy === "rush" ? 1 : exchange.strategy === "riposte" ? 0.88 : 0.72,
      outcome: exchange.outcome,
    };
  }

  private ensureFighter(id: number): FighterState {
    let state = this.fighters.get(id);
    if (!state) {
      state = { memory: freshMemory(), recentStrategies: [], plans: 0 };
      this.fighters.set(id, state);
    }
    return state;
  }

  private distance(a: CombatantSnapshot, b: CombatantSnapshot): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private key(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
}
