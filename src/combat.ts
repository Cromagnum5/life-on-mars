export type CombatTemperament = "bold" | "reactive" | "patient" | "adaptive";

/** What a fighter does for a living. Melee cuts; a hurler throws rocks. */
export type CombatRole = "melee" | "hurler";

/** The three throws, longest first. A hurler picks one from the current gap. */
export type ThrowType = "hurl" | "pitch" | "toss";

export type CombatStrategy =
  | "rush"
  | "react"
  | "size-up"
  | "feint"
  | "distance-trap"
  | "beat"
  | "riposte"
  | ThrowType;

export type AttackLine = "overhead" | "forehand" | "backhand" | "flank" | "rising";
export type CombatAction = "idle" | "size-up" | "attack" | "block" | "hit" | "recover" | "defeated";
export type CombatMovement =
  | "hold" | "close" | "retreat" | "angle-left" | "angle-right"
  /** Planted: a throw in flight cannot also be a shuffle. */
  | "plant";
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
  /** The line a feint shows before switching to `line`; null when honest. */
  feintLine: AttackLine | null;
  side: -1 | 1;
  intensity: number;
  outcome: CombatOutcome;
  preferredDistance: number;
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
  /** Absent means melee, so existing callers need no change. */
  role?: CombatRole;
};

/**
 * A discrete moment worth seeing or hearing. Presentation reads these instead
 * of edge-detecting per-frame cues, so a swing that starts and resolves inside
 * one frame still produces exactly one spark and one sound.
 */
export type CombatEventType =
  | "swing" | "block" | "glance" | "hit" | "whiff" | "riposte" | "plan" | "throw";

/**
 * A rock leaving a hurler's hand. It carries its own flight so presentation can
 * launch a rock that lands on the exact frame the director resolves the strike:
 * the outcome is already rolled at release, and the impact event replays it.
 */
export type ProjectileRelease = {
  throwType: ThrowType;
  /** Metres per second. */
  speed: number;
  /** Seconds between release and impact. */
  flightTime: number;
  /** What the rock will do when it arrives. */
  outcome: Exclude<CombatOutcome, "pending">;
};

export type CombatEvent = {
  type: CombatEventType;
  attackerId: number;
  defenderId: number;
  line: AttackLine;
  strategy: CombatStrategy;
  side: -1 | 1;
  intensity: number;
  /** Only on a `throw`. */
  projectile?: ProjectileRelease;
};

export type CombatFrame = {
  cues: Map<number, CombatCue>;
  damage: Array<{
    targetId: number;
    /** Who landed it, so presentation can work out which way the blow came from. */
    sourceId: number;
    amount: number;
    outcome: "glancing" | "hit";
    side: -1 | 1;
    /** A rock rather than a cut: it carries a direction, and it knocks down. */
    thrown: boolean;
  }>;
  events: CombatEvent[];
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
  feintLine: AttackLine | null;
  side: -1 | 1;
  measureDuration: number;
  attackDuration: number;
  recoveryDuration: number;
  elapsed: number;
  outcome: CombatOutcome;
  damageApplied: boolean;
  swingAnnounced: boolean;
  chainDepth: number;
  preferredDistance: number;
  /** Null for a cut. Set means the exchange is a thrown rock. */
  throwType: ThrowType | null;
  /** Beyond this the attacker has to walk in; a cut and a hurl differ hugely. */
  attackRange: number;
  /** Phase of the throwing motion at which the rock leaves the hand. */
  releasePhase: number;
  released: boolean;
  /** Exchange time the rock lands at, or null while it is still in hand. */
  impactAt: number | null;
  impactAnnounced: boolean;
};

type Encounter = {
  a: number;
  b: number;
  support: boolean;
  /** A hurler shelling `b`. One-sided, never promoted, never riposted. */
  ranged: boolean;
  exchange: Exchange;
};

/** Player-facing names for each plan, shared by the HUD and the combat sim. */
export const STRATEGY_LABELS: Record<CombatStrategy, string> = {
  rush: "Rushing",
  react: "Waiting to counter",
  "size-up": "Sizing up",
  feint: "Feinting",
  "distance-trap": "Baiting range",
  beat: "Beating the guard",
  riposte: "Riposting",
  hurl: "Winding up a hurl",
  pitch: "Pitching",
  toss: "Tossing close",
};

export const THROW_TYPES: readonly ThrowType[] = ["hurl", "pitch", "toss"];

export function isThrow(strategy: CombatStrategy | null): strategy is ThrowType {
  return strategy === "hurl" || strategy === "pitch" || strategy === "toss";
}

const AWARENESS_RANGE = 8.5;
// Kept clear of MAX_FIGHT_DISTANCE so a pair drifting around its preferred
// spacing cannot cross the range check and rewind the exchange every frame.
export const ATTACK_RANGE = 4.3;
// Sized from the rendered result, not from reach: below about 2.6 m the two
// silhouettes merge into one blob at RTS viewing scale and the fight stops
// reading. The blade is 2.65 m, so this band still lets it do the work.
export const MIN_FIGHT_DISTANCE = 2.6;
export const MAX_FIGHT_DISTANCE = 3.65;
/** Spacing a pair settles at when nothing biases the plan toward reach. */
export const BASE_FIGHT_DISTANCE = 3.05;

/**
 * Shoulder-to-shoulder span of the Rigwalker skeleton: `create_rigwalker.py`
 * puts the arm bones at x = ±0.67. Throw ranges are quoted in these, so the
 * band a hurler works in is stated in the unit the model itself defines.
 */
export const SHOULDER_WIDTH = 1.34;
/** Twelve shoulder widths. The farthest a rock is thrown, and the best place to be. */
export const LONG_THROW_RANGE = SHOULDER_WIDTH * 12;
/** Twice a sword Rigwalker's strike distance. */
export const MEDIUM_THROW_RANGE = ATTACK_RANGE * 2;
/** Inside a sword's reach: the throw made with somebody already on top of you. */
export const SHORT_THROW_RANGE = ATTACK_RANGE;
/**
 * Where a hurler tries to stand. Held short of the maximum so a target drifting
 * a metre does not push every plan out of range and rewind the wind-up.
 */
export const HURLER_FIGHT_DISTANCE = LONG_THROW_RANGE - 1.5;

export type ThrowProfile = {
  /** Longest gap this throw is chosen at. */
  range: number;
  /** Seconds spent judging the throw, as a base plus a random span. */
  measure: readonly [number, number];
  /** Seconds the throwing motion itself runs. */
  motion: number;
  /** Phase of that motion at which the rock leaves the hand. */
  release: number;
  /** Seconds of recovery afterwards, extended if the rock is still in the air. */
  recovery: number;
  /** Metres per second the rock travels. */
  speed: number;
  damage: number;
  /** Chance the rock is swatted aside, and the chance it misses outright. */
  deflect: number;
  miss: number;
  /** How loudly the release and the landing read. */
  intensity: number;
};

/**
 * The three throws. A hurler is deadliest at the top of its range: the hurl is
 * slow to execute but lands roughly a third more damage per second than the
 * pitch and twice the toss, and it is the most accurate of the three. Crowd a
 * hurler and it is reduced to flicking pebbles at a swordsman's chest.
 */
export const THROW_PROFILES: Record<ThrowType, ThrowProfile> = {
  hurl: {
    range: LONG_THROW_RANGE, measure: [0.45, 0.35], motion: 1.15, release: 0.58,
    recovery: 0.55, speed: 32.5, damage: 38, deflect: 0.06, miss: 0.07, intensity: 1,
  },
  pitch: {
    range: MEDIUM_THROW_RANGE, measure: [0.22, 0.22], motion: 0.62, release: 0.44,
    recovery: 0.35, speed: 17, damage: 19, deflect: 0.13, miss: 0.13, intensity: 0.7,
  },
  toss: {
    range: SHORT_THROW_RANGE, measure: [0.08, 0.12], motion: 0.3, release: 0.32,
    recovery: 0.22, speed: 11, damage: 8, deflect: 0.22, miss: 0.2, intensity: 0.45,
  },
};

/** Which throw the current gap calls for; null when the target is out of range. */
export function throwTypeForDistance(distance: number): ThrowType | null {
  if (distance <= SHORT_THROW_RANGE) return "toss";
  if (distance <= MEDIUM_THROW_RANGE) return "pitch";
  if (distance <= LONG_THROW_RANGE) return "hurl";
  return null;
}

/** How a rock's arrival reads on the body it lands against. */
const THROW_LINES: Record<ThrowType, AttackLine> = {
  hurl: "overhead", pitch: "forehand", toss: "flank",
};

/**
 * Slack on the acquire range so a hurler walks the last stretch into throwing
 * distance rather than standing still just outside it.
 *
 * It must stay below `RELEASE_SLACK`. Noticing somebody at the same range you
 * forget them at is not a range at all: a fighter sitting on that line takes
 * the encounter, loses it, and takes it again as often as the crowd jostles it,
 * which reads as a unit stuttering under a strobing plan ring.
 */
const ACQUIRE_SLACK = 1.15;
/** Slack on the range an encounter survives to, which sets the hysteresis band. */
const RELEASE_SLACK = 1.35;
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
  feintLine: null,
  side: 1,
  intensity: 0,
  outcome: "pending",
  preferredDistance: BASE_FIGHT_DISTANCE,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Being hit outranks whatever the fighter was planning. Several encounters can
 * write a cue for the same fighter in one frame — a hurler shelling a target
 * that a teammate is also cutting at — and without this the winner is whichever
 * encounter happens to be iterated last, so a landed blow can vanish.
 */
function writeCue(cues: Map<number, CombatCue>, id: number, cue: CombatCue): void {
  if (cues.get(id)?.action === "hit" && cue.action !== "hit") return;
  cues.set(id, cue);
}

function outcomeEvent(outcome: CombatOutcome): CombatEventType {
  return outcome === "blocked" ? "block" :
    outcome === "glancing" ? "glance" :
    outcome === "whiff" ? "whiff" : "hit";
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

  /** Forgets every encounter and all tactical memory. Used to restart a sim. */
  reset(): void {
    this.encounters.clear();
    this.fighters.clear();
  }

  update(delta: number, snapshots: readonly CombatantSnapshot[]): CombatFrame {
    const presentIds = new Set(snapshots.map((fighter) => fighter.id));
    for (const id of this.fighters.keys()) {
      if (!presentIds.has(id)) this.fighters.delete(id);
    }
    const living = snapshots.filter((fighter) => fighter.isAlive);
    const byId = new Map(living.map((fighter) => [fighter.id, fighter]));
    const cues = new Map<number, CombatCue>();
    const damage: CombatFrame["damage"] = [];
    const events: CombatEvent[] = [];
    for (const fighter of snapshots) cues.set(fighter.id, { ...EMPTY_CUE });

    for (const [key, encounter] of this.encounters) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b || a.corporation === b.corporation ||
          this.distance(a, b) > this.awareness(a, b) * RELEASE_SLACK) {
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
      // A ranged encounter is never promoted: a hurler and its target are not
      // trading, and making the pair mutual would hand the target's cue to a
      // fighter standing twelve metres away. Nor is a swordsman's encounter
      // *on* a hurler, which would hand the hurler a sword and a riposte —
      // crowded, a hurler keeps throwing, and the throws get worse.
      if (!encounter.support || encounter.ranged ||
          byId.get(encounter.b)?.role === "hurler" ||
          primaryParticipants.has(encounter.b) || promotedTargets.has(encounter.b)) {
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
      if (!encounter.support) {
        reserved.add(encounter.b);
      } else if (!encounter.ranged) {
        // Rocks arriving from range do not crowd a target the way bodies do, so
        // a hurler does not spend one of its team's melee support slots.
        supportCounts.set(encounter.b, (supportCounts.get(encounter.b) ?? 0) + 1);
      }
    }

    const candidates: Array<{ a: CombatantSnapshot; b: CombatantSnapshot; distance: number }> = [];
    for (let aIndex = 0; aIndex < living.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < living.length; bIndex += 1) {
        const a = living[aIndex];
        const b = living[bIndex];
        if (a.corporation === b.corporation || reserved.has(a.id) || reserved.has(b.id)) continue;
        // Hurlers never enter a mutual duel; they take a one-sided encounter of
        // their own below and are charged rather than traded with.
        if (a.role === "hurler" || b.role === "hurler") continue;
        const distance = this.distance(a, b);
        if (distance <= AWARENESS_RANGE) candidates.push({ a, b, distance });
      }
    }
    candidates.sort((left, right) => left.distance - right.distance);
    for (const candidate of candidates) {
      if (reserved.has(candidate.a.id) || reserved.has(candidate.b.id)) continue;
      const encounter = this.createEncounter(candidate.a, candidate.b);
      this.announcePlan(encounter.exchange, events);
      this.encounters.set(this.key(candidate.a.id, candidate.b.id), encounter);
      reserved.add(candidate.a.id);
      reserved.add(candidate.b.id);
    }

    for (const hurler of living) {
      if (hurler.role !== "hurler" || reserved.has(hurler.id)) continue;
      const target = living
        .filter((other) => other.corporation !== hurler.corporation &&
          this.distance(hurler, other) <= LONG_THROW_RANGE * ACQUIRE_SLACK)
        // Nearest first, but finish what is already hurt.
        .sort((left, right) =>
          this.distance(hurler, left) + (left.health / left.maxHealth) * 2.5 -
          this.distance(hurler, right) - (right.health / right.maxHealth) * 2.5)[0];
      if (!target) continue;
      const encounter = this.createRangedEncounter(hurler, target);
      this.announcePlan(encounter.exchange, events);
      this.encounters.set("ranged:" + hurler.id, encounter);
      reserved.add(hurler.id);
    }

    const primaryThreats: Array<{
      ally: CombatantSnapshot; target: CombatantSnapshot; ranged: boolean;
    }> = [];
    for (const encounter of this.encounters.values()) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      if (encounter.ranged) {
        // The fighter being shelled is the ally worth helping, and the hurler is
        // the thing to walk at.
        primaryThreats.push({ ally: b, target: a, ranged: true });
      } else if (!encounter.support) {
        primaryThreats.push(
          { ally: a, target: b, ranged: false }, { ally: b, target: a, ranged: false },
        );
      }
    }
    for (const helper of living) {
      if (reserved.has(helper.id)) continue;
      const choices = primaryThreats
        .filter(({ ally, target, ranged }) =>
          ally.corporation === helper.corporation &&
          // A fighter cannot help itself against a swordsman it is already
          // paired with, but it certainly may charge the hurler shelling it.
          (ranged || ally.id !== helper.id) &&
          target.corporation !== helper.corporation &&
          this.distance(helper, target) <= this.awareness(helper, target) * ACQUIRE_SLACK &&
          (supportCounts.get(target.id) ?? 0) < MAX_SUPPORTERS_PER_TARGET)
        .map(({ ally, target, ranged }) => ({
          ally, target,
          score: this.distance(helper, target) +
            (ally.health / ally.maxHealth) * 2 +
            (target.health / target.maxHealth) * 0.35 -
            // Silencing a hurler is worth crossing ground for.
            (ranged ? 6 : 0),
        }))
        .sort((left, right) => left.score - right.score);
      const choice = choices[0];
      if (!choice) continue;
      const encounter = this.createSupportEncounter(helper, choice.target);
      this.announcePlan(encounter.exchange, events);
      this.encounters.set("support:" + helper.id + ":" + choice.target.id, encounter);
      reserved.add(helper.id);
      supportCounts.set(choice.target.id, (supportCounts.get(choice.target.id) ?? 0) + 1);
    }

    for (const encounter of this.encounters.values()) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      if (encounter.ranged) this.advanceThrow(encounter, a, b, delta, cues, damage, events);
      else this.advanceEncounter(encounter, a, b, delta, cues, damage, events);
    }

    return { cues, damage, events };
  }

  /**
   * How far apart two fighters can notice each other. A hurler works from the
   * top of its throwing range, so a pair including one has to stay engaged from
   * far outside the distance two swordsmen would.
   */
  private awareness(a: CombatantSnapshot, b: CombatantSnapshot): number {
    return a.role === "hurler" || b.role === "hurler"
      ? Math.max(AWARENESS_RANGE, LONG_THROW_RANGE)
      : AWARENESS_RANGE;
  }

  /**
   * A fighter committing to a plan is a discrete moment like any contact, so it
   * travels on the event stream rather than being edge-detected from cues. A
   * riposte announces itself with its own event and is not repeated here.
   */
  private announcePlan(exchange: Exchange, events: CombatEvent[]): void {
    if (exchange.strategy !== "riposte") events.push(this.event(exchange, "plan"));
  }

  private createEncounter(a: CombatantSnapshot, b: CombatantSnapshot): Encounter {
    this.ensureFighter(a.id);
    this.ensureFighter(b.id);
    const initiativeA = a.profile.initiative + a.profile.aggression * 0.45 + this.random() * 0.35;
    const initiativeB = b.profile.initiative + b.profile.aggression * 0.45 + this.random() * 0.35;
    const attacker = initiativeA >= initiativeB ? a : b;
    const defender = attacker === a ? b : a;
    return {
      a: a.id, b: b.id, support: false, ranged: false,
      exchange: this.planExchange(attacker, defender, 0),
    };
  }

  private createSupportEncounter(helper: CombatantSnapshot, target: CombatantSnapshot): Encounter {
    this.ensureFighter(helper.id);
    this.ensureFighter(target.id);
    return {
      a: helper.id, b: target.id, support: true, ranged: false,
      exchange: this.planExchange(helper, target, 0, undefined, true),
    };
  }

  private createRangedEncounter(hurler: CombatantSnapshot, target: CombatantSnapshot): Encounter {
    this.ensureFighter(hurler.id);
    this.ensureFighter(target.id);
    return {
      a: hurler.id, b: target.id, support: true, ranged: true,
      exchange: this.planThrow(hurler, target),
    };
  }

  /**
   * Picks the throw the current gap calls for and lays out its beats. Out past
   * the maximum a hurler still commits to a hurl and walks until the target is
   * inside it, which is what keeps it advancing rather than idling.
   */
  private planThrow(attacker: CombatantSnapshot, defender: CombatantSnapshot): Exchange {
    const state = this.ensureFighter(attacker.id);
    state.plans += 1;
    const distance = this.distance(attacker, defender);
    const throwType = throwTypeForDistance(distance) ?? "hurl";
    const profile = THROW_PROFILES[throwType];
    const line = THROW_LINES[throwType];
    state.recentStrategies.push(throwType);
    if (state.recentStrategies.length > 2) state.recentStrategies.shift();
    return {
      plannerId: attacker.id,
      attackerId: attacker.id,
      defenderId: defender.id,
      strategy: throwType,
      line,
      feintLine: null,
      side: 1,
      measureDuration: profile.measure[0] + this.random() * profile.measure[1],
      attackDuration: profile.motion,
      recoveryDuration: profile.recovery,
      elapsed: 0,
      outcome: "pending",
      damageApplied: false,
      swingAnnounced: false,
      chainDepth: 0,
      // Standing off is the whole job, so a hurler holds its ground near the
      // top of its range whichever throw it happens to be loading.
      preferredDistance: Math.max(
        MEDIUM_THROW_RANGE + 1,
        Math.min(
          LONG_THROW_RANGE - 0.6,
          HURLER_FIGHT_DISTANCE + (this.random() - 0.5) * 1.2,
        ),
      ),
      throwType,
      attackRange: profile.range,
      releasePhase: profile.release,
      released: false,
      impactAt: null,
      impactAnnounced: false,
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
    // A feint opens on a line the defender is not about to receive, then
    // switches. Offsetting by two keeps the shown and delivered lines on
    // visibly different arcs rather than neighbouring ones.
    const feintLine = strategy === "feint"
      ? LINES[(LINES.indexOf(line) + 2) % LINES.length]
      : null;
    const side: -1 | 1 = line === "backhand" || line === "rising" ? -1 : 1;
    const measureDuration =
      strategy === "rush" ? 0.1 + this.random() * 0.25 :
      strategy === "react" ? 0.25 + this.random() * 0.4 :
      strategy === "size-up" ? (firstExchange ? 1.5 + this.random() * 1.5 : 0.45 + this.random() * 0.55) :
      strategy === "distance-trap" ? 0.7 + this.random() * 0.7 :
      strategy === "riposte" ? 0.12 + this.random() * 0.12 :
      0.35 + this.random() * 0.45;
    const rangeBias =
      strategy === "rush" || strategy === "riposte" ? -0.25 :
      strategy === "distance-trap" || strategy === "react" ? 0.275 :
      0;
    const preferredDistance = Math.max(
      MIN_FIGHT_DISTANCE,
      Math.min(
        MAX_FIGHT_DISTANCE,
        BASE_FIGHT_DISTANCE + rangeBias + (this.random() - 0.5) * 0.6875,
      ),
    );
    return {
      plannerId: attacker.id,
      attackerId: actualAttacker.id,
      defenderId: actualDefender.id,
      strategy,
      line,
      feintLine,
      side,
      measureDuration,
      attackDuration: strategy === "riposte" ? 0.82 : strategy === "rush" ? 0.95 : 1.08,
      recoveryDuration: 0.32 + this.random() * 0.28,
      elapsed: 0,
      outcome: "pending",
      damageApplied: false,
      swingAnnounced: false,
      chainDepth,
      preferredDistance,
      throwType: null,
      attackRange: ATTACK_RANGE,
      releasePhase: 0,
      released: false,
      impactAt: null,
      impactAnnounced: false,
    };
  }

  /**
   * One frame of a hurler's exchange: judge the gap, load the throw, release,
   * and let the rock fly. Unlike a cut, the strike is resolved when the rock
   * leaves the hand and only *lands* a flight later, so the impact is checked
   * before anything else — a rock in the air arrives however the two have moved
   * since, and even if the target has walked out of throwing range.
   */
  private advanceThrow(
    encounter: Encounter,
    a: CombatantSnapshot,
    b: CombatantSnapshot,
    delta: number,
    cues: Map<number, CombatCue>,
    damage: CombatFrame["damage"],
    events: CombatEvent[],
  ): void {
    const exchange = encounter.exchange;
    const attacker = exchange.attackerId === a.id ? a : b;
    const defender = exchange.defenderId === a.id ? a : b;
    const profile = THROW_PROFILES[exchange.throwType!];
    exchange.elapsed += delta;
    const distance = this.distance(attacker, defender);

    if (exchange.impactAt !== null && !exchange.impactAnnounced &&
        exchange.elapsed >= exchange.impactAt) {
      exchange.impactAnnounced = true;
      events.push(this.event(exchange, outcomeEvent(exchange.outcome)));
      if (exchange.outcome === "hit" || exchange.outcome === "glancing") {
        damage.push({
          targetId: defender.id,
          sourceId: attacker.id,
          amount: exchange.outcome === "glancing"
            ? Math.round(profile.damage * 0.35)
            : profile.damage,
          outcome: exchange.outcome,
          side: exchange.side,
          thrown: true,
        });
      }
      // A rock landing is worth a stagger even while the hurler reloads.
      if (exchange.outcome !== "whiff") {
        writeCue(cues, defender.id, this.cue(
          exchange, attacker.id,
          exchange.outcome === "blocked" ? "block" : "hit", "hold", 0.5,
        ));
      }
    }

    if (!exchange.released) {
      const band = throwTypeForDistance(distance);
      if (band === null) {
        // Out of range entirely: hold the wind-up and walk the gap down.
        exchange.elapsed = Math.min(exchange.elapsed, exchange.measureDuration);
        writeCue(cues, attacker.id, this.cue(exchange, defender.id, "size-up", "close", 0));
        return;
      }
      // While still judging, a changed gap changes the throw. Once the motion
      // has started the hurler is committed, the way a real thrower is.
      if (band !== exchange.throwType && exchange.elapsed < exchange.measureDuration) {
        encounter.exchange = this.planThrow(attacker, defender);
        this.announcePlan(encounter.exchange, events);
        writeCue(cues, attacker.id, this.cue(
          encounter.exchange, defender.id, "size-up", "hold", 0,
        ));
        return;
      }
    }

    if (exchange.elapsed < exchange.measureDuration) {
      // Free to shuffle toward the range it wants to work from.
      writeCue(cues, attacker.id, this.cue(
        exchange, defender.id, "size-up", "hold",
        exchange.elapsed / exchange.measureDuration,
      ));
      return;
    }

    const motionElapsed = exchange.elapsed - exchange.measureDuration;
    if (motionElapsed <= exchange.attackDuration) {
      const phase = clamp01(motionElapsed / exchange.attackDuration);
      if (!exchange.released && phase >= exchange.releasePhase) {
        this.release(exchange, defender, profile, distance, events);
      }
      writeCue(cues, attacker.id, this.cue(
        exchange, defender.id, "attack",
        // Planted through the throw itself; the feet are doing the work.
        phase > 0.15 && phase < 0.85 ? "plant" : "hold",
        phase,
      ));
      return;
    }

    const recoveryPhase = clamp01(
      (motionElapsed - exchange.attackDuration) / exchange.recoveryDuration,
    );
    writeCue(cues, attacker.id, this.cue(exchange, defender.id, "recover", "hold", recoveryPhase));
    if (recoveryPhase < 1) return;
    encounter.exchange = this.planThrow(attacker, defender);
    this.announcePlan(encounter.exchange, events);
  }

  /**
   * The rock leaves the hand. The outcome is rolled here rather than on arrival
   * so the release event can carry it: presentation launches a rock that is
   * already going to hit or already going to sail past, and the landing is a
   * replay rather than a second decision.
   */
  private release(
    exchange: Exchange,
    defender: CombatantSnapshot,
    profile: ThrowProfile,
    distance: number,
    events: CombatEvent[],
  ): void {
    exchange.released = true;
    exchange.swingAnnounced = true;
    exchange.outcome = this.resolveThrow(profile, defender);
    const flightTime = Math.max(0.06, distance / profile.speed);
    exchange.impactAt = exchange.elapsed + flightTime;
    // The exchange has to outlast the rock, or it would re-plan out from under
    // a strike still in the air.
    const motionRemaining =
      exchange.measureDuration + exchange.attackDuration - exchange.elapsed;
    exchange.recoveryDuration = Math.max(
      exchange.recoveryDuration, flightTime - motionRemaining + 0.15,
    );
    events.push({
      ...this.event(exchange, "throw"),
      projectile: {
        throwType: exchange.throwType!,
        speed: profile.speed,
        flightTime,
        outcome: exchange.outcome as Exclude<CombatOutcome, "pending">,
      },
    });
  }

  /**
   * A rock is either swatted aside, missed with, or worn. There is no riposte
   * to be had against one, so this is a flatter roll than a cut's: the throw's
   * own accuracy dominates, and the target's defence only shades it.
   */
  private resolveThrow(profile: ThrowProfile, defender: CombatantSnapshot): CombatOutcome {
    const roll = this.random();
    const missChance = profile.miss + defender.profile.adaptability * 0.06;
    if (roll < missChance) return "whiff";
    const deflectChance = missChance + profile.deflect + defender.profile.defense * 0.08;
    if (roll < deflectChance) return "blocked";
    if (roll < deflectChance + 0.1) return "glancing";
    return "hit";
  }

  private advanceEncounter(
    encounter: Encounter,
    a: CombatantSnapshot,
    b: CombatantSnapshot,
    delta: number,
    cues: Map<number, CombatCue>,
    damage: CombatFrame["damage"],
    events: CombatEvent[],
  ): void {
    const exchange = encounter.exchange;
    const attacker = exchange.attackerId === a.id ? a : b;
    const defender = exchange.defenderId === a.id ? a : b;
    const distance = this.distance(attacker, defender);
    exchange.elapsed += delta;

    if (distance > ATTACK_RANGE) {
      exchange.elapsed = Math.min(exchange.elapsed, exchange.measureDuration);
      writeCue(cues, attacker.id, this.cue(exchange, defender.id, "size-up", "close", 0));
      if (!encounter.support) {
        writeCue(cues, defender.id, this.cue(exchange, attacker.id, "size-up", "hold", 0));
      }
      return;
    }

    // A supporting attacker waits its turn while the target is busy trading with
    // somebody else. A hurler is never busy in that sense: it is always mid-throw
    // at someone twelve metres away, and deferring to that left swordsmen
    // standing next to a hurler watching it work.
    const occupiedCue = cues.get(defender.id);
    const occupiedByMelee = !isThrow(occupiedCue?.strategy ?? null);
    if (encounter.support && occupiedByMelee && exchange.elapsed >= exchange.measureDuration &&
        (occupiedCue?.action === "attack" || occupiedCue?.action === "block")) {
      exchange.elapsed = exchange.measureDuration;
      writeCue(cues, attacker.id, this.cue(
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
      writeCue(cues, attacker.id, this.cue(exchange, defender.id, "size-up", attackerMove, phase));
      if (!encounter.support) {
        writeCue(cues, defender.id, this.cue(
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
      if (!exchange.swingAnnounced) {
        exchange.swingAnnounced = true;
        events.push(this.event(exchange, "swing"));
      }
      if (exchange.outcome === "pending" && phase >= 0.46) {
        exchange.outcome = this.resolveOutcome(exchange, attacker, defender);
        if (exchange.outcome !== "pending") {
          events.push(this.event(
            exchange,
            exchange.outcome === "blocked" ? "block" :
            exchange.outcome === "glancing" ? "glance" :
            exchange.outcome === "whiff" ? "whiff" : "hit",
          ));
        }
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
      writeCue(cues, attacker.id, this.cue(exchange, defender.id, "attack", "hold", phase));
      if (!encounter.support || (phase >= 0.48 && exchange.outcome !== "whiff")) {
        writeCue(cues, defender.id, this.cue(exchange, attacker.id, defenderAction, defenderMove, phase));
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
            sourceId: attacker.id,
            amount: exchange.outcome === "glancing" ? Math.round(base * 0.35) : base,
            outcome: exchange.outcome,
            side: exchange.side,
            thrown: false,
          });
        }
        exchange.damageApplied = true;
      }
      return;
    }

    const recoveryPhase = clamp01(
      (attackElapsed - exchange.attackDuration) / exchange.recoveryDuration,
    );
    writeCue(cues, attacker.id, this.cue(exchange, defender.id, "recover", "retreat", recoveryPhase));
    if (!encounter.support) {
      writeCue(cues, defender.id, this.cue(exchange, attacker.id, "recover", "hold", recoveryPhase));
    }
    if (recoveryPhase < 1) return;

    this.recordExchange(exchange);
    if (encounter.support) {
      encounter.exchange = this.planExchange(a, b, 0, undefined, true);
      this.announcePlan(encounter.exchange, events);
      return;
    }
    if ((exchange.outcome === "blocked" || exchange.outcome === "whiff") &&
        exchange.chainDepth < 2 && this.random() < (exchange.outcome === "whiff" ? 0.9 : 0.78)) {
      encounter.exchange = this.planExchange(defender, attacker, exchange.chainDepth + 1, "riposte");
      // The defender just turned a failed attack around: worth announcing so
      // presentation can telegraph the counter before it lands.
      events.push(this.event(encounter.exchange, "riposte"));
    } else {
      const nextAttacker =
        exchange.outcome === "hit" && this.random() < 0.58 ? attacker :
        this.random() < 0.5 ? attacker : defender;
      const nextDefender = nextAttacker.id === attacker.id ? defender : attacker;
      encounter.exchange = this.planExchange(nextAttacker, nextDefender, 0);
      this.announcePlan(encounter.exchange, events);
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
      feintLine: exchange.feintLine,
      side: exchange.side,
      intensity: action === "hit" && exchange.outcome === "glancing" ? 0.42 :
        action === "block" ? 0.78 :
        this.swingWeight(exchange),
      outcome: exchange.outcome,
      preferredDistance: exchange.preferredDistance,
    };
  }

  private swingWeight(exchange: Exchange): number {
    if (exchange.throwType) return THROW_PROFILES[exchange.throwType].intensity;
    return exchange.strategy === "rush" ? 1 : exchange.strategy === "riposte" ? 0.88 : 0.72;
  }

  private event(exchange: Exchange, type: CombatEventType): CombatEvent {
    // A rock's arrival reads as loudly as the throw that sent it, so a swatted
    // hurl is a bigger moment than a swatted pebble.
    const weight = exchange.throwType ? this.swingWeight(exchange) : 1;
    return {
      type,
      attackerId: exchange.attackerId,
      defenderId: exchange.defenderId,
      line: exchange.line,
      strategy: exchange.strategy,
      side: exchange.side,
      intensity:
        type === "plan" ? 0.55 :
        type === "block" ? 0.78 * weight :
        type === "glance" ? 0.42 * weight :
        type === "whiff" ? 0.3 * weight :
        type === "riposte" ? 0.9 :
        this.swingWeight(exchange),
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
