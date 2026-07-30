export type CombatTemperament = "bold" | "reactive" | "patient" | "adaptive";

/** What a fighter does for a living. Melee cuts; a hurler throws rocks. */
export type CombatRole = "melee" | "hurler";

/** The three throws, longest first. A hurler picks one from the current gap. */
export type ThrowType = "hurl" | "pitch" | "toss";

/**
 * The four ways a hurler uses the rock once somebody is inside its guard,
 * heaviest first. A stone is not a missile it has run out of: it is a weight in
 * the hand, and the fight it makes is the one a weight in the hand makes.
 *
 * They are ordered by how much warning each one needs, which is the whole of the
 * decision — see `STONE_PROFILES.load`.
 */
export type StoneStrike = "hammer" | "swing" | "jab" | "punch";

export type CombatStrategy =
  | "rush"
  | "react"
  | "size-up"
  | "feint"
  | "distance-trap"
  | "beat"
  | "riposte"
  | ThrowType
  | StoneStrike;

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
  /**
   * Both arms up rather than one. A fighter with a single blow to answer puts an
   * arm on it and keeps the other hand working; blows arriving from more than one
   * bearing at once cannot each be met, so they are taken behind a cover instead.
   *
   * Only a hurler is posed from it — a swordsman answers with the blade, and
   * `applyCombatPose` has a parry for that.
   */
  doubleGuard: boolean;
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
  /**
   * A hurler shelling `b` from range. One-sided, and never promoted: the pair is
   * not trading and `b` may be too far away to have noticed. A hurler that is
   * charged gets a separate, ordinary encounter and fights back with the stone.
   */
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
  hammer: "Hammering two-handed",
  swing: "Swinging the stone",
  jab: "Driving the stone in",
  punch: "Punching",
};

export const THROW_TYPES: readonly ThrowType[] = ["hurl", "pitch", "toss"];
/** Heaviest first, which is also slowest first. `weightedChoice` falls back to the last. */
export const STONE_STRIKES: readonly StoneStrike[] = ["hammer", "swing", "jab", "punch"];

export function isThrow(strategy: CombatStrategy | null): strategy is ThrowType {
  return strategy === "hurl" || strategy === "pitch" || strategy === "toss";
}

export function isStoneStrike(strategy: CombatStrategy | null): strategy is StoneStrike {
  return strategy === "hammer" || strategy === "swing" ||
    strategy === "jab" || strategy === "punch";
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
/**
 * Acquire slack for a target nobody is on yet, so a fighter reaches a little
 * further to meet a second charger rather than crowding the one its partner
 * already has. Two swords screening four only hold two of them if the sword
 * that acquires second can see past the enemy the first one took.
 *
 * It has to stay under `RELEASE_SLACK` for the same reason `ACQUIRE_SLACK`
 * does, and it is what sets the narrowest hysteresis band in the director, so
 * it buys the smallest reach that does the job rather than the largest one the
 * release range would allow.
 */
const UNCLAIMED_ACQUIRE_SLACK = 1.25;
/** Slack on the range an encounter survives to, which sets the hysteresis band. */
const RELEASE_SLACK = 1.35;

/**
 * How far a stone held in the hand reaches. A broadsword is 2.65 m of steel; an
 * arm and a rock are most of a metre short of that, so a hurler that wants to use
 * the stone has to stand inside the band a swordsman is happiest in. That is the
 * trade the close fight is made of, and it is why crossing a hurler's standoff is
 * still how a hurler is killed.
 */
export const STONE_RANGE = 3.2;
/**
 * Where a hurler stands to use it. All but on the floor of the readable band, and
 * that is not taste: the grip only reaches about 1.65 m in front of the fighter,
 * measured on the rig, and a strike lunges for the rest. Any further out and the
 * stone resolves in the air between them. Held clear of `STONE_RANGE` by more
 * than the jitter, so a pair drifting cannot cross the range check and rewind the
 * exchange every frame.
 */
export const STONE_FIGHT_DISTANCE = 2.7;
/**
 * How far a pair trading stone blows may drift before it stops being a trade.
 * The band between this and `STONE_RANGE` is the hysteresis: a charge becomes a
 * duel at reach and the duel is let go a good half-metre further out, so a hurler
 * shoved a step back is still fighting rather than flickering between the two.
 *
 * Presentation reads it too — `rigwalker.ts` swaps the hurler's whole stance on
 * this band — so it is one number rather than two that have to agree.
 */
export const STONE_RELEASE_RANGE = STONE_RANGE * RELEASE_SLACK;

export type StoneProfile = {
  /**
   * How much warning the strike needs, as a fraction of `STONE_REACTION_WINDOW`.
   * A fighter with less room than this will not choose it, which is the whole of
   * "swings when it has time and punches when it does not": the punch needs none,
   * so there is always something left to throw.
   */
  load: number;
  /** Seconds spent judging the strike, as a base plus a random span. */
  measure: readonly [number, number];
  /** Seconds the striking motion itself runs. */
  motion: number;
  /**
   * Seconds of recovery. A heavy head needs room to come back — the one real
   * cost of choosing the big strike, and what makes committing to it a decision.
   */
  recovery: number;
  damage: number;
  /** How hard the strike is to stop, before the defender's own qualities. */
  pressure: number;
  /** How loudly it reads when it lands. */
  intensity: number;
};

/**
 * The four stone strikes.
 *
 * They mirror how a weight in the hand is actually fought with. Power comes from
 * the ground up — the rear foot drives, the hips turn ahead of the shoulders, and
 * the arm arrives last — which is slow and has to be bought with time. The
 * two-handed blow is the extreme of that: slower still, and the hardest thing in
 * the fight to stand under. At the other end, a short thrust straight from the
 * shoulder is the Māori patu's whole technique, and a punch is what is left when
 * there is no time to pick.
 *
 * Damage per second is deliberately *not* flat across them: with time to load,
 * the big strikes are worth having, and the fighter denied that time is reduced
 * to the fast ones. Every one of them is under what a swordsman does in the same
 * second, because the hurler's job is still to be somewhere else.
 */
export const STONE_PROFILES: Record<StoneStrike, StoneProfile> = {
  hammer: {
    load: 0.62, measure: [0.34, 0.3], motion: 1.22, recovery: 0.68,
    damage: 38, pressure: 0.16, intensity: 1,
  },
  swing: {
    load: 0.44, measure: [0.26, 0.26], motion: 1.02, recovery: 0.54,
    damage: 28, pressure: 0.11, intensity: 0.88,
  },
  jab: {
    load: 0.16, measure: [0.14, 0.18], motion: 0.56, recovery: 0.28,
    damage: 14, pressure: 0.05, intensity: 0.6,
  },
  punch: {
    load: 0, measure: [0.05, 0.1], motion: 0.36, recovery: 0.2,
    damage: 9, pressure: 0, intensity: 0.42,
  },
};

/** How each strike reads on the body it lands against, and which way it topples one. */
const STONE_LINES: Record<StoneStrike, AttackLine> = {
  hammer: "overhead", swing: "forehand", jab: "rising", punch: "flank",
};

/**
 * How long a fighter has to see a blow coming and answer it with something
 * better than a reflex. Anything landing sooner than this is pressure; anything
 * further off is room. It is a shade under a full swing's motion on purpose — a
 * fighter that could load a swing inside the time one takes to arrive would never
 * be caught short, and being caught short is the point.
 */
const STONE_REACTION_WINDOW = 0.85;
/**
 * How far apart two attackers have to be working from before one guard cannot
 * answer both.
 *
 * Measured rather than picked. Two swordsmen on one target at fighting distance
 * are held apart by the clearance floor and subtend about 39°; pushed out to a
 * flanking pair, about 51°. At the fifty degrees this started at, the common
 * case never qualified and the cover was seen roughly once a fight — reported
 * from play as only ever seeing it on a corpse, which is exactly what it looked
 * like, because a defeated fighter keeps the last pose it was given.
 *
 * Twenty-nine degrees is what two bodies genuinely on different sides of you
 * comes to. One attacker can never reach it: two bearings are needed.
 */
const STONE_COVER_ARC = 0.5;
/**
 * How much further than its reach an attacker counts as working a fighter. A
 * supporter circling for an opening is not swinging, but it is why the guard
 * stays up.
 */
const STONE_COVER_SLACK = 1.35;
/**
 * Where in a cut the blow arrives, for working out how long there is left. The
 * outcome resolves at 0.46 and the damage lands at 0.54, so it is between them.
 */
const MELEE_CONTACT_PHASE = 0.5;
/**
 * What defending with arms rather than steel costs, and what getting the second
 * arm up buys back. A hurler stops fewer cuts than a swordsman does however well
 * it reads them, which is why closing on one still works.
 */
const STONE_GUARD_PENALTY = -0.13;
const STONE_COVER_RECOVERY = 0.09;
const MAX_SUPPORTERS_PER_TARGET = 2;
/**
 * What each body already on a target adds to the cost of choosing it, so a
 * fighter spreads onto a free enemy rather than doubling up on the nearest.
 * Priced as one sword's reach: worth walking that much further for a target of
 * your own, and no further. Kept under the bonus for silencing a hurler, which
 * is still the thing most worth crossing ground for.
 */
const CLAIMED_TARGET_COST = ATTACK_RANGE;
/**
 * What a target at full health costs the battery, priced in metres of range, so
 * a crowd is worked through weakest-first and a body already down to a sliver
 * is finished rather than left walking. Deliberately under the range band it
 * competes against: a fresh swordsman closing to sword reach still outscores a
 * near-dead one at the back of the crowd, because keeping the crowd off the
 * throwers is what the battery is for.
 */
const FOCUS_HEALTH_WEIGHT = 8;
/**
 * What the target the battery is already on is worth when it is scored against
 * the alternatives. Two enemies of similar health and range would otherwise
 * trade the focus back and forth every time one of them took a step.
 */
const FOCUS_HYSTERESIS = 2.5;
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
  doubleGuard: false,
};

/**
 * What is on its way to one fighter this frame: the bearing every committed
 * strike is arriving on, and how little time there is before the soonest of them
 * lands. A hurler reads its whole close fight off this — the strike it picks
 * comes off the urgency and the guard it puts up comes off the bearings.
 */
type Incoming = {
  /**
   * Bearings of every enemy engaged on this fighter in melee, whether or not it
   * has committed to a blow yet. Deliberately looser than `urgency`: whether to
   * get the second arm up is a slower judgement than which strike to make. One
   * is "who is working me", the other is "what lands soonest", and sharing a
   * window between them is what made the cover a single-frame flinch.
   */
  bearings: number[];
  /** How little time before the soonest *committed* blow lands. */
  urgency: number;
};

/** Nothing arriving, shared rather than allocated per lookup. */
const NOTHING_INCOMING: Incoming = { bearings: [], urgency: 0 };

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
  /** The body each team's hurlers are working on together, by corporation. */
  private readonly hurlerFocus = new Map<string, number>();
  /** What is arriving at each fighter, rebuilt every frame. See `Incoming`. */
  private readonly incoming = new Map<number, Incoming>();

  constructor(private readonly random: () => number = Math.random) {}

  /** Forgets every encounter and all tactical memory. Used to restart a sim. */
  reset(): void {
    this.encounters.clear();
    this.fighters.clear();
    this.hurlerFocus.clear();
    this.incoming.clear();
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
          this.distance(a, b) > this.releaseRange(encounter, a, b)) {
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
      // fighter standing twelve metres away.
      if (!encounter.support || encounter.ranged ||
          primaryParticipants.has(encounter.b) || promotedTargets.has(encounter.b)) {
        continue;
      }
      // A hurler is promoted only once the fight has actually reached it. Out at
      // throwing range it has no answer to a swordsman walking at it, and a
      // mutual pair would hand its cue to somebody it cannot touch; inside stone
      // reach the rock in its hand stops being a missile and becomes a weapon,
      // and the pair is a trade like any other. This is the one way into a duel
      // a hurler ever gets — it is charged into one, never walks into one.
      const charged = byId.get(encounter.a);
      const target = byId.get(encounter.b);
      if (target?.role === "hurler" &&
          (!charged || this.distance(charged, target) > STONE_RANGE)) {
        continue;
      }
      encounter.support = false;
      primaryParticipants.add(encounter.a);
      primaryParticipants.add(encounter.b);
      promotedTargets.add(encounter.b);
      // Turning to fight is now the whole of what the target does, so whatever
      // it was walking at is let go: a fighter driving one encounter while
      // defending another writes two cues a frame and reads as neither. This is
      // what lets a screen hold. The fighter it drops re-acquires as soon as
      // this pair breaks, and the target it drops is only ever a one-sided one,
      // since anything mutual is already a primary participant.
      for (const [key, other] of this.encounters) {
        if (other.a === encounter.b) this.encounters.delete(key);
      }
    }

    const reserved = new Set<number>();
    const supportCounts = new Map<number, number>();
    // Every body already committed to a target, the mutual partner included.
    // `supportCounts` leaves that one out on purpose, since the cap it drives is
    // stated as a primary fighter plus supporters; spreading has to count heads.
    const attackerCounts = new Map<number, number>();
    const addAttacker = (id: number) =>
      attackerCounts.set(id, (attackerCounts.get(id) ?? 0) + 1);
    for (const encounter of this.encounters.values()) {
      reserved.add(encounter.a);
      if (!encounter.support) {
        reserved.add(encounter.b);
        addAttacker(encounter.a);
        addAttacker(encounter.b);
      } else if (!encounter.ranged) {
        // Rocks arriving from range do not crowd a target the way bodies do, so
        // a hurler does not spend one of its team's melee support slots.
        supportCounts.set(encounter.b, (supportCounts.get(encounter.b) ?? 0) + 1);
        addAttacker(encounter.b);
      }
    }

    const candidates: Array<{ a: CombatantSnapshot; b: CombatantSnapshot; distance: number }> = [];
    for (let aIndex = 0; aIndex < living.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < living.length; bIndex += 1) {
        const a = living[aIndex];
        const b = living[bIndex];
        if (a.corporation === b.corporation || reserved.has(a.id) || reserved.has(b.id)) continue;
        // A hurler pairs off only with somebody already inside stone reach.
        // Further out it is throwing, and a mutual pair would hand its cue to a
        // fighter it cannot touch; nearer than that the rock in its hand is a
        // weapon like any other and the two are simply fighting.
        //
        // This is the second way into a duel and it is not redundant with the
        // promotion pass. A hurler does not throw at a body standing on top of
        // it, so it may have no encounter at all to be promoted out of — and
        // with nothing published, nobody would ever engage it.
        const bound = a.role === "hurler" || b.role === "hurler"
          ? STONE_RANGE
          : AWARENESS_RANGE;
        const distance = this.distance(a, b);
        if (distance <= bound) candidates.push({ a, b, distance });
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
      // A fresh duel is a mutual pair like a promoted one, and the battery pass
      // below reads this to know which of its throwers are busy. Left out, a
      // hurler that paired off here was handed a second, ranged encounter on the
      // same frame and drove both — throwing at the far flank while trading
      // blows with the body in front of it.
      primaryParticipants.add(candidate.a.id);
      primaryParticipants.add(candidate.b.id);
    }

    // A team's hurlers work as one battery. They pick a body together, walk it
    // down, and swing onto the next one together, which is both the way massed
    // throwers actually work and the only way the volleys read as a group
    // decision rather than four fighters each minding their own business.
    const throwTargets = new Map<number, CombatantSnapshot>();
    const batteries = new Map<string, CombatantSnapshot[]>();
    for (const fighter of living) {
      if (fighter.role !== "hurler") continue;
      const battery = batteries.get(fighter.corporation);
      if (battery) battery.push(fighter);
      else batteries.set(fighter.corporation, [fighter]);
    }
    for (const [corporation, battery] of batteries) {
      // A hurler with somebody inside its guard has put the rock to another use
      // and is out of the battery until it is free again. Left in, it would drag
      // the whole team's focus onto the body standing on top of it and have its
      // teammates throwing rocks into their own melee.
      const free = battery.filter((hurler) => !primaryParticipants.has(hurler.id));
      const focus = free.length
        ? this.chooseFocus(free, living, this.hurlerFocus.get(corporation) ?? null)
        : null;
      if (focus) this.hurlerFocus.set(corporation, focus.id);
      else this.hurlerFocus.delete(corporation);
      for (const hurler of free) {
        const target = this.throwTarget(hurler, focus, living);
        if (!target) continue;
        throwTargets.set(hurler.id, target);
        if (this.encounters.has("ranged:" + hurler.id)) continue;
        const encounter = this.createRangedEncounter(hurler, target);
        this.announcePlan(encounter.exchange, events);
        this.encounters.set("ranged:" + hurler.id, encounter);
        reserved.add(hurler.id);
      }
    }

    const threats: Array<{
      ally: CombatantSnapshot; target: CombatantSnapshot; ranged: boolean;
    }> = [];
    for (const encounter of this.encounters.values()) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      if (encounter.ranged) {
        // The fighter being shelled is the ally worth helping, and the hurler is
        // the thing to walk at.
        threats.push({ ally: b, target: a, ranged: true });
      } else if (encounter.support) {
        // A one-sided attacker threatens the fighter it is walking at like any
        // other. Leaving these out made a fighter that already had a target
        // invisible to the enemy it walked past to reach it: four swordsmen
        // charging the hurlers behind a screen gave that screen nothing to do,
        // because every one of them was busy. Only the fighter under attack is
        // published — the attacker is already somebody's target.
        threats.push({ ally: b, target: a, ranged: false });
      } else {
        threats.push(
          { ally: a, target: b, ranged: false }, { ally: b, target: a, ranged: false },
        );
      }
    }
    for (const helper of living) {
      // A hurler is never drafted into this. It has no sword to help with, and
      // being handed a melee plan is what sent one walking out of its own
      // standoff and into the crowd with a `beat` it could not throw.
      if (reserved.has(helper.id) || helper.role === "hurler") continue;
      const choices = threats
        .filter(({ ally, target, ranged }) =>
          ally.corporation === helper.corporation &&
          // A fighter cannot help itself against a swordsman it is already
          // paired with, but it certainly may charge the hurler shelling it.
          (ranged || ally.id !== helper.id) &&
          target.corporation !== helper.corporation &&
          this.distance(helper, target) <= this.awareness(helper, target) *
            ((attackerCounts.get(target.id) ?? 0) === 0
              ? UNCLAIMED_ACQUIRE_SLACK : ACQUIRE_SLACK) &&
          (supportCounts.get(target.id) ?? 0) < MAX_SUPPORTERS_PER_TARGET)
        .map(({ ally, target, ranged }) => ({
          ally, target,
          score: this.distance(helper, target) +
            (ally.health / ally.maxHealth) * 2 +
            (target.health / target.maxHealth) * 0.35 +
            // A body nobody is on holds a fighter that is otherwise free to walk
            // on past. Two swords screening four chargers stop two of them by
            // taking one each and one by both taking the nearest.
            (attackerCounts.get(target.id) ?? 0) * CLAIMED_TARGET_COST -
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
      addAttacker(choice.target.id);
    }

    // Read before anything is advanced, because a plan made this frame is made
    // against what is already on its way — not against what this frame's own
    // exchanges are about to become.
    this.readIncoming(byId);

    for (const encounter of this.encounters.values()) {
      const a = byId.get(encounter.a);
      const b = byId.get(encounter.b);
      if (!a || !b) continue;
      if (encounter.ranged) {
        this.advanceThrow(
          encounter, a, b, delta, cues, damage, events, throwTargets.get(encounter.a),
        );
      } else this.advanceEncounter(encounter, a, b, delta, cues, damage, events);
    }

    // The second arm, and only once the whole frame's cues are in: which fighters
    // are being worked by two enemies cannot be known while the encounters are
    // still being walked, because the second one may not have written its cue.
    //
    // A cover is a posture and not a flinch, so it is held for as long as two
    // bodies are on the fighter rather than only on the frames a blow lands.
    // Gated to `block` and `hit` it was up for one per cent of a crowded fight —
    // and the one place it lasted was on a corpse, which keeps whatever pose it
    // died in. The one thing it is not compatible with is swinging: a fighter
    // committed to a strike has that arm doing something else.
    for (const [id, cue] of cues) {
      if (cue.action === "attack" || cue.action === "idle") continue;
      cue.doubleGuard = this.isCovering(id);
    }

    return { cues, damage, events };
  }

  /**
   * Everything committed to a strike, filed under the fighter it is arriving at:
   * which bearing it comes in on and how long there is left before it lands.
   *
   * Only committed strikes count. A rock still being wound up twelve metres away
   * is not pressure — it can be re-aimed, and the hurler holding it may never
   * throw — but a rock already in the air is, and so is a blade halfway through
   * its cut. That distinction is the whole value of the reading: it is what a
   * fighter could actually see coming.
   */
  private readIncoming(byId: Map<number, CombatantSnapshot>): void {
    this.incoming.clear();
    const entryFor = (id: number) => {
      let entry = this.incoming.get(id);
      if (!entry) {
        entry = { bearings: [], urgency: 0 };
        this.incoming.set(id, entry);
      }
      return entry;
    };
    for (const encounter of this.encounters.values()) {
      const exchange = encounter.exchange;
      // Who is working whom, which is what the guard is decided from. A charge
      // is one-sided, so only the target is being worked; a trade is both ways.
      // A supporter circling for an opening is filed too — it is not swinging,
      // and it is exactly why the guard stays up.
      if (!encounter.ranged) {
        const a = byId.get(encounter.a);
        const b = byId.get(encounter.b);
        const reach = exchange.attackRange * STONE_COVER_SLACK;
        if (a && b && this.distance(a, b) <= reach) {
          entryFor(b.id).bearings.push(Math.atan2(a.x - b.x, a.z - b.z));
          if (!encounter.support) {
            entryFor(a.id).bearings.push(Math.atan2(b.x - a.x, b.z - a.z));
          }
        }
      }
      // And what is actually on its way, which is what the *strike* is chosen
      // from. Strict on purpose: a rock still being wound up twelve metres away
      // can be re-aimed and may never be thrown, so it is not pressure, while a
      // rock already in the air is, and so is a blade halfway through its cut.
      const remaining = this.timeToContact(exchange);
      if (remaining === null || remaining > STONE_REACTION_WINDOW) continue;
      const defender = byId.get(exchange.defenderId);
      if (!defender) continue;
      const entry = entryFor(defender.id);
      entry.urgency = Math.max(entry.urgency, 1 - remaining / STONE_REACTION_WINDOW);
    }
  }

  /**
   * Seconds until this exchange's blow lands, or null when there is no blow left
   * in it — one already resolved, or one still loose enough that the attacker
   * could change its mind.
   */
  private timeToContact(exchange: Exchange): number | null {
    if (exchange.throwType) {
      if (!exchange.released || exchange.impactAnnounced) return null;
      return Math.max(0, exchange.impactAt! - exchange.elapsed);
    }
    if (exchange.damageApplied) return null;
    return Math.max(0, exchange.measureDuration +
      exchange.attackDuration * MELEE_CONTACT_PHASE - exchange.elapsed);
  }

  /**
   * Whether this fighter has more on it than one guard can answer: two enemies
   * working it from bearings far enough apart that turning into one turns the
   * body away from the other. The answer to two is to stop choosing and cover.
   */
  private isCovering(id: number): boolean {
    const bearings = this.incoming.get(id)?.bearings;
    if (!bearings || bearings.length < 2) return false;
    for (let left = 0; left < bearings.length; left += 1) {
      for (let right = left + 1; right < bearings.length; right += 1) {
        let apart = Math.abs(bearings[left] - bearings[right]) % (Math.PI * 2);
        if (apart > Math.PI) apart = Math.PI * 2 - apart;
        if (apart > STONE_COVER_ARC) return true;
      }
    }
    return false;
  }

  /**
   * How far apart a pair may drift before the encounter is let go.
   *
   * A charge on a hurler reaches as far as the hurler throws, because crossing
   * that ground is the whole of the fight. A pair actually trading blows is held
   * to reach instead — and when one of them is a hurler, reach is the stone's,
   * which is the shorter of the two. That is what lets a hurler shoved clear of
   * a swordsman go back to throwing rather than staying locked in a duel it has
   * walked out of.
   */
  private releaseRange(
    encounter: Encounter, a: CombatantSnapshot, b: CombatantSnapshot,
  ): number {
    if (!encounter.support && !encounter.ranged &&
        (a.role === "hurler" || b.role === "hurler")) {
      return STONE_RELEASE_RANGE;
    }
    return this.awareness(a, b) * RELEASE_SLACK;
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

  /**
   * The one body a team's hurlers all throw at. Scored in metres: how close the
   * candidate has got to the nearest thrower, plus what its remaining health is
   * worth, less a little for being the body they are already on.
   */
  private chooseFocus(
    battery: readonly CombatantSnapshot[],
    living: readonly CombatantSnapshot[],
    current: number | null,
  ): CombatantSnapshot | null {
    let best: CombatantSnapshot | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of living) {
      if (candidate.corporation === battery[0].corporation) continue;
      let reach = Number.POSITIVE_INFINITY;
      for (const hurler of battery) reach = Math.min(reach, this.distance(hurler, candidate));
      if (reach > LONG_THROW_RANGE * ACQUIRE_SLACK) continue;
      const score = reach +
        (candidate.health / candidate.maxHealth) * FOCUS_HEALTH_WEIGHT -
        (candidate.id === current ? FOCUS_HYSTERESIS : 0);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * What one hurler throws at. The battery's focus whenever it can reach it, so
   * the volleys land together; otherwise the best body it can actually hit,
   * since a thrower standing idle because the group is working the far flank is
   * a thrower wasted. It rejoins the focus as soon as that comes into range.
   */
  private throwTarget(
    hurler: CombatantSnapshot,
    focus: CombatantSnapshot | null,
    living: readonly CombatantSnapshot[],
  ): CombatantSnapshot | null {
    const reach = LONG_THROW_RANGE * ACQUIRE_SLACK;
    // Nothing standing inside arm's length. A rock is not thrown at a body that
    // close — it is hit with — and the frame between a charger arriving and the
    // duel being struck used to be spent flicking a pebble at somebody already
    // on top of the thrower, plan ring and all.
    const throwable = (candidate: CombatantSnapshot) => {
      const distance = this.distance(hurler, candidate);
      return distance > STONE_RANGE && distance <= reach;
    };
    if (focus && throwable(focus)) return focus;
    let best: CombatantSnapshot | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of living) {
      if (candidate.corporation === hurler.corporation) continue;
      const distance = this.distance(hurler, candidate);
      if (!throwable(candidate)) continue;
      const score = distance + (candidate.health / candidate.maxHealth) * FOCUS_HEALTH_WEIGHT;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
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

  /**
   * A stone strike, picked by how much room the fighter has to make it.
   *
   * This is the reactive half of the close fight and the reason it is planned
   * rather than played back. Power in a weight-in-the-hand blow comes from the
   * ground up — rear foot, then hips, then shoulders, with the arm arriving
   * last — and that sequence takes time somebody has to give you. Given it, a
   * hurler turns its whole body into the blow; given none, it hits with the fist
   * the rock is already in. The `load` on each profile is that price, and the
   * urgency reading is what it is paid out of.
   *
   * A riposte is the extreme case: the fighter has just taken a cut off its arms
   * and the window is whatever is left of the attacker's recovery, so it is
   * planned with no room at all and comes out short.
   */
  private planStone(
    attacker: CombatantSnapshot,
    defender: CombatantSnapshot,
    chainDepth: number,
    riposting: boolean,
  ): Exchange {
    const state = this.ensureFighter(attacker.id);
    state.plans += 1;
    const room = riposting
      ? 0
      : 1 - (this.incoming.get(attacker.id) ?? NOTHING_INCOMING).urgency;
    const p = attacker.profile;
    const weights = STONE_STRIKES.map((strike) => {
      // Nothing it has not got the warning for. A punch needs none, which is why
      // there is always something left on the table.
      if (room < STONE_PROFILES[strike].load) return 0;
      let weight =
        strike === "hammer" ? p.aggression + p.patience * 0.5 :
        strike === "swing" ? p.aggression * 0.8 + p.initiative * 0.6 :
        strike === "jab" ? p.adaptability + p.deception * 0.5 :
        p.initiative + p.defense * 0.4;
      if (p.temperament === "bold" && (strike === "swing" || strike === "hammer")) weight += 0.9;
      if (p.temperament === "patient" && strike === "hammer") weight += 0.8;
      if (p.temperament === "adaptive" && strike === "jab") weight += 0.8;
      if (p.temperament === "reactive" && strike === "punch") weight += 0.7;
      if (state.recentStrategies.includes(strike)) weight *= 0.55;
      return weight;
    });
    const strike = weightedChoice(STONE_STRIKES, weights, this.random);
    const profile = STONE_PROFILES[strike];
    const line = STONE_LINES[strike];
    return {
      plannerId: attacker.id,
      attackerId: attacker.id,
      defenderId: defender.id,
      strategy: strike,
      line,
      feintLine: null,
      side: line === "backhand" || line === "rising" ? -1 : 1,
      measureDuration: profile.measure[0] + this.random() * profile.measure[1],
      attackDuration: profile.motion,
      recoveryDuration: profile.recovery,
      elapsed: 0,
      outcome: "pending",
      damageApplied: false,
      swingAnnounced: false,
      chainDepth,
      // A stone reaches less far than a blade, so a hurler that means to use one
      // has to stand where the swordsman wants it. See `STONE_FIGHT_DISTANCE`.
      preferredDistance: Math.max(
        MIN_FIGHT_DISTANCE,
        Math.min(
          STONE_RANGE - 0.35,
          STONE_FIGHT_DISTANCE + (this.random() - 0.5) * 0.3,
        ),
      ),
      throwType: null,
      attackRange: STONE_RANGE,
      releasePhase: 0,
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
    // A hurler plans with what it is holding. Every way into an exchange comes
    // through here — the first plan, the one after it, and the riposte — so this
    // is the one place the close fight has to be handed over, and a hurler can
    // never be dealt a sword plan it has no sword for.
    if (attacker.role === "hurler") {
      return this.planStone(attacker, defender, chainDepth, forcedStrategy === "riposte");
    }
    const state = this.ensureFighter(attacker.id);
    const healthRatio = attacker.health / attacker.maxHealth;
    const opponentRatio = defender.health / defender.maxHealth;
    const firstExchange = state.plans === 0;
    state.plans += 1;
    // Waiting to counter hands the attack to the other fighter, and what a
    // hurler attacks with is a stone strike planned by the hurler itself. Left
    // on the table against one, `react` and `distance-trap` made the hurler the
    // attacker of a sword exchange — a fighter cutting with a weapon it does not
    // carry, announcing plans it cannot execute. Sizing one up is still fine:
    // that leaves the attack where it was.
    const strategies: readonly CombatStrategy[] = offensiveOnly
      ? ["rush", "feint", "beat"]
      : defender.role === "hurler"
        ? ["rush", "size-up", "feint", "beat"]
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
    desired?: CombatantSnapshot,
  ): void {
    // Swinging onto the body the rest of the battery is on, while there is
    // still time to. A thrower that has started the motion is committed, the
    // same rule the throw band already follows — a rock in the air cannot be
    // re-aimed, and a wind-up that snapped to a new bearing mid-swing would
    // read as the model glitching rather than as the group changing its mind.
    if (desired && desired.id !== b.id && this.canReaim(encounter.exchange)) {
      encounter.b = desired.id;
      b = desired;
      encounter.exchange = this.planThrow(a, desired);
      this.announcePlan(encounter.exchange, events);
    }
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
    // The throw is done, so the next one is aimed wherever the battery is now.
    const next = desired ?? defender;
    encounter.b = next.id;
    encounter.exchange = this.planThrow(attacker, next);
    this.announcePlan(encounter.exchange, events);
  }

  /**
   * Whether a thrower can still change who it is throwing at: only while it is
   * judging the gap, before the throwing motion has started and before the rock
   * has left the hand.
   */
  private canReaim(exchange: Exchange): boolean {
    return !exchange.released && exchange.elapsed < exchange.measureDuration;
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

    // A cut reaches 4.3 m and a stone in the hand a good deal less, so the gate
    // is the exchange's own reach rather than the sword's.
    if (distance > exchange.attackRange) {
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
            isStoneStrike(exchange.strategy) ? STONE_PROFILES[exchange.strategy].damage :
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
      isStoneStrike(exchange.strategy) ? STONE_PROFILES[exchange.strategy].pressure :
      exchange.strategy === "feint" ? attacker.profile.deception * 0.25 :
      exchange.strategy === "beat" ? 0.12 + attacker.profile.aggression * 0.12 :
      exchange.strategy === "rush" ? attacker.profile.initiative * 0.1 :
      exchange.strategy === "size-up" ? attacker.profile.adaptability * 0.1 :
      exchange.strategy === "riposte" ? 0.18 : 0;
    // Arms, not steel. A hurler meeting a cut on its forearms turns fewer of
    // them than a swordsman with a blade to put in the way, however well it
    // reads the line — which is why walking one down still works. Getting the
    // second arm up buys most of that back, and costs it the hand it strikes
    // with for as long as it is up.
    const armedDefense = defender.role !== "hurler" ? 0
      : this.isCovering(defender.id) ? STONE_GUARD_PENALTY + STONE_COVER_RECOVERY
      : STONE_GUARD_PENALTY;
    const defenseChance = clamp01(
      0.17 + defender.profile.defense * 0.25 +
      defender.profile.adaptability * learnedLine * 0.25 + tacticalDefense +
      armedDefense - attackPressure,
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
      // Filled in once every encounter has had its say; see the pass at the foot
      // of `update`.
      doubleGuard: false,
    };
  }

  private swingWeight(exchange: Exchange): number {
    if (exchange.throwType) return THROW_PROFILES[exchange.throwType].intensity;
    if (isStoneStrike(exchange.strategy)) return STONE_PROFILES[exchange.strategy].intensity;
    return exchange.strategy === "rush" ? 1 : exchange.strategy === "riposte" ? 0.88 : 0.72;
  }

  private event(exchange: Exchange, type: CombatEventType): CombatEvent {
    // A rock's arrival reads as loudly as the throw that sent it, so a swatted
    // hurl is a bigger moment than a swatted pebble — and a two-handed hammer
    // turned aside is a bigger one than a punch that went nowhere.
    const weight = exchange.throwType || isStoneStrike(exchange.strategy)
      ? this.swingWeight(exchange)
      : 1;
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
