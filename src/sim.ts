import * as THREE from "three";
import { BattleRuntime } from "./battle";
import { STRATEGY_LABELS, type CombatCue } from "./combat";
import { PerfMonitor, PerfReadout, type DrawCount } from "./perf";
import { createSeededRandom } from "./random";
import { createRigwalker, describeFeet, type Rigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
import { RigwalkerBatch } from "./unit-render";
import {
  addMarsLighting,
  applyMarsAtmosphere,
  DEFAULT_FOV,
  createCameraOrbit,
  createMarsRenderer,
  createPerspectiveCamera,
  createRocks,
  createTabletopCamera,
  createTerrain,
  fitCameraToViewport,
  orbitBy,
  orbitOffset,
  panFocus,
  VIEW_HEIGHT,
  radiusForFov,
  terrainHeightAt,
  type TabletopCamera,
} from "./world";
import "./sim.css";

/**
 * A combat workbench. It stages a matchup on an empty patch of Mars, runs the
 * same `BattleRuntime` the game does, and shows what the director is actually
 * deciding: every fighter's plan, its phase, and a timestamped event log.
 *
 * Nothing here is gameplay. Production, selection, and orders are deliberately
 * absent so a fight can be watched, seeded, replayed, and stepped one frame at
 * a time.
 *
 * URL parameters, all optional:
 *   matchup=3v2  seed=7  speed=0.35  zoom=2.6
 *   t=9.5        run headless to that sim time and render one frame
 *   step=0.0166  fixed timestep used by `t`
 *   hud=0        hide the panels for a clean render
 *   yaw=90       degrees the view is swung from the default three-quarter one,
 *   pitch=-30    and degrees it is tipped; the arrow keys do the same live
 *   camera=perspective   draw through a perspective projection instead, which
 *                `P` also toggles live. The default view is orthographic and
 *                nothing changes size with distance in it; this is how that
 *                choice gets questioned against the same seeded fight
 *   fov=70       vertical field of view for that projection, in degrees. The
 *                default frames what the orthographic view frames, so a swap
 *                holds the focus and changes only depth; a wider lens comes in
 *                closer for the same framing and reads as deeper
 *   on=HR1       ride one fighter by its label instead of the centre of the
 *                fight, which is what makes a pose judgeable: at a zoom that
 *                fills the frame with a body, the centroid frames nobody
 *   feet=1       show each fighter's feet in its own frame, after every pose
 *                layer, so a stance can be read as numbers off the same frame
 *   contacts=1   log where each strike throws its sparks, in the attacker's
 *                own frame, for checking that a swing lands on the opponent
 *
 * Everything here renders through the game's own renderer, so a frame captured
 * from a URL is the frame that URL shows in a browser. That is the only way to
 * settle an argument about a pose: the Blender tools draw a hand-ported pose
 * that stops short of `applyBalancePose`, and the game never looks like them.
 */

/**
 * Wide enough that a sixty-four a side line pulled back to fit still has ground
 * under it and out to the horizon behind it. The ground itself does not move
 * when this does — `terrainHeightAt` is a function of world position, not of
 * the patch drawn around it — so every seeded fight lands on exactly the height
 * it always did and only the backdrop is bigger.
 */
const ARENA_SIZE = 112;
/** Low enough to hold a sixty-four a side line in frame. */
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 7;
/** How far one arrow key swings the view. Twenty-four presses make a circuit. */
const ORBIT_STEP = THREE.MathUtils.degToRad(15);
/** Fixed timestep for reproducible headless captures. */
const CAPTURE_STEP = 1 / 60;
const LOG_LIMIT = 22;
const RESTART_DELAY = 2.5;
/** Cardinal spacing of a team's starting line. */
const LINE_SPACING = 2.7;
/** Front to back between ranks. A line is wide before it is deep. */
const RANK_SPACING = 2;
/** The widest a block stands before it starts a second rank. */
const MAX_FILES = 16;
/**
 * How many fighters are still worth a card each. Past this the readout says
 * what each side has left instead: a hundred and twenty-eight cards is not a
 * readout anybody reads, and rebuilding them is the most expensive thing on the
 * page — which the `hud` row of the perf panel will now tell you to your face.
 */
const MAX_FIGHTER_CARDS = 12;

const TEAMS = [
  { corporation: "Helios", accent: 0x32b9ff, tag: "H", side: -1 },
  { corporation: "Vanguard", accent: 0xff4f57, tag: "V", side: 1 },
] as const;

/**
 * A matchup is per-team counts of swordsmen and hurlers, plus how far apart the
 * two lines start and how far the camera pulls back. A hurler works from about
 * sixteen metres, so a fight involving one needs both a longer approach and a
 * wider view than two swordsmen walking into each other do.
 */
type Matchup = {
  teams: readonly [Roster, Roster];
  standoff: number;
  zoom: number;
  /**
   * How far behind the screen a hurler starts, which is what makes a mixed team
   * read as swords in front with the throwers working over them. A matchup
   * staging the close fight has no screen and no use for it: set-back, a hurler
   * put on the line at three metres still opens six and a half away and spends
   * the first seconds throwing, which is the thing the matchup exists to skip.
   */
  setback?: number;
  /**
   * Cardinal spacing across a rank. The small matchups stand loose because
   * there is nothing to be crowded by; a line of sixteen at that spacing is
   * forty metres wide and will not fit on a screen with the fight in it.
   */
  spacing?: number;
};

const HURLER_SETBACK = 3.5;
type Roster = { melee: number; hurlers: number };

/**
 * Three swords to a hurler.
 *
 * Measured rather than picked: over a round-robin of every mix from all-sword
 * to all-hurler, sixteen a side, both sides of the field, eight seeds each way,
 * twelve-and-four is the mix that comes out level against the field (net −10 of
 * a possible ±96). It is also what the game itself fields — the Assembly Bay
 * puts out three swords an opening and the Stoneworks one hurler — so a sim
 * roster built on it stages the army the player actually gets.
 *
 * What it is *not* is an equilibrium. The field it is level against is a
 * slope: all-sword loses to every mix 0–16, and each further hurler is worth
 * more than the sword it replaced, right up to an all-hurler army that beats
 * everything. Three to one is the even point on a curve that never turns over,
 * and if massed hurlers are ever meant to be beatable that is a combat
 * question, not a roster one.
 */
const SWORDS_PER_HURLER = 3;

/** Splits a team of `total` into swords and hurlers at that ratio. */
function mixedRoster(total: number): Roster {
  const hurlers = Math.round(total / (SWORDS_PER_HURLER + 1));
  return { melee: total - hurlers, hurlers };
}

const MATCHUPS: Record<string, Matchup> = {
  "1v1": { teams: [{ melee: 1, hurlers: 0 }, { melee: 1, hurlers: 0 }], standoff: 7.5, zoom: 3.2 },
  "2v2": { teams: [{ melee: 2, hurlers: 0 }, { melee: 2, hurlers: 0 }], standoff: 7.5, zoom: 3.2 },
  "3v2": { teams: [{ melee: 3, hurlers: 0 }, { melee: 2, hurlers: 0 }], standoff: 7.5, zoom: 3.2 },
  "3v3": { teams: [{ melee: 3, hurlers: 0 }, { melee: 3, hurlers: 0 }], standoff: 7.5, zoom: 3.2 },
  "5v5": { teams: [{ melee: 5, hurlers: 0 }, { melee: 5, hurlers: 0 }], standoff: 7.5, zoom: 3.2 },
  // One hurler against one sword: the whole point of the unit in one fight.
  // It opens at maximum range and is walked down through all three throws.
  "1h v 1": {
    teams: [{ melee: 0, hurlers: 1 }, { melee: 1, hurlers: 0 }], standoff: 9.5, zoom: 1.7,
  },
  // Two hurlers trading at standoff: nothing but big wind-ups.
  "1h v 1h": {
    teams: [{ melee: 0, hurlers: 1 }, { melee: 0, hurlers: 1 }], standoff: 9, zoom: 1.7,
  },
  // Screened: the swords hold the line while the rocks come over the top.
  "2h+2 v 4": {
    teams: [{ melee: 2, hurlers: 2 }, { melee: 4, hurlers: 0 }], standoff: 10, zoom: 1.6,
  },
  "2h v 3": {
    teams: [{ melee: 0, hurlers: 2 }, { melee: 3, hurlers: 0 }], standoff: 10, zoom: 1.6,
  },
  // The close fight, staged rather than waited for. Started inside stone reach,
  // so the hurler is fighting with the rock from the first second instead of
  // spending fifteen of them being walked down to it — which is the only way to
  // look at the strikes and the arm guard at any length.
  "1h in close": {
    teams: [{ melee: 0, hurlers: 1 }, { melee: 1, hurlers: 0 }],
    standoff: 1.5, zoom: 3.2, setback: 0,
  },
  // Crowded from two sides, which is what puts both forearms up.
  "1h v 2 close": {
    teams: [{ melee: 0, hurlers: 1 }, { melee: 2, hurlers: 0 }],
    standoff: 1.8, zoom: 2.6, setback: 0,
  },
  // Armies, at the ratio the game produces. Nothing about the fight is new —
  // these exist so the frame has enough bodies in it to be worth profiling, and
  // so a line of swords with rocks coming over the top can be looked at as a
  // battle rather than as a duel with witnesses.
  "16v16": {
    teams: [mixedRoster(16), mixedRoster(16)], standoff: 13, zoom: 1.2, spacing: 1.9,
  },
  "32v32": {
    teams: [mixedRoster(32), mixedRoster(32)], standoff: 14, zoom: 1, spacing: 1.9,
  },
  "64v64": {
    teams: [mixedRoster(64), mixedRoster(64)], standoff: 16, zoom: 0.8, spacing: 1.9,
  },
};

/**
 * The most bodies any matchup here can put on the field, so the instanced draw
 * buffers are allocated once at the size the biggest fight needs rather than
 * grown a rank at a time while it is being staged.
 */
const LARGEST_MATCHUP = Math.max(...Object.values(MATCHUPS).map((setup) =>
  setup.teams.reduce((sum, roster) => sum + roster.melee + roster.hurlers, 0)));

/**
 * Where the `index`-th body of a block of `count` stands: how far across its
 * rank, how many ranks back, and how wide that rank is.
 *
 * Ranks are evened out rather than filled to the brim, so a block of
 * twenty-four is twelve and twelve rather than sixteen and a ragged eight, and
 * each rank is centred on its own width rather than on the widest one.
 */
function formationSlot(index: number, count: number): {
  file: number; rank: number; width: number;
} {
  const ranks = Math.max(1, Math.ceil(count / MAX_FILES));
  const files = Math.ceil(count / ranks);
  const rank = Math.floor(index / files);
  return { file: index % files, rank, width: Math.min(files, count - rank * files) };
}

/** How many ranks deep a block of `count` stands. */
function rankDepth(count: number): number {
  return count === 0 ? 0 : Math.max(1, Math.ceil(count / MAX_FILES));
}

type LogEntry = { time: number; kind: string; text: string };

const params = new URLSearchParams(window.location.search);
const captureTime = params.has("t") ? Number(params.get("t")) : null;
const captureStep = Number(params.get("step") ?? CAPTURE_STEP);

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Combat sim markup is missing ${selector}.`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#arena");
const fighterList = requireElement<HTMLElement>("#fighters");
const tallyList = requireElement<HTMLElement>("#tally");
const logList = requireElement<HTMLElement>("#log");
const clockValue = requireElement<HTMLElement>("#clock");
const verdictValue = requireElement<HTMLElement>("#verdict");
const projectionValue = requireElement<HTMLElement>("#projection");
const speedInput = requireElement<HTMLInputElement>("#speed");
const speedValue = requireElement<HTMLElement>("#speed-value");
const seedInput = requireElement<HTMLInputElement>("#seed");
const pauseButton = requireElement<HTMLButtonElement>("#pause");
const followInput = requireElement<HTMLInputElement>("#follow");
const loopInput = requireElement<HTMLInputElement>("#loop");
const muteInput = requireElement<HTMLInputElement>("#mute");
// Looked up here with the rest of the bar rather than beside the listeners they
// are given further down, because `hud=0` removes the bar on the next line —
// and a `requireElement` that ran after that threw, which took the whole page
// with it. Every headless capture asking for a clean frame came back as an
// empty canvas, `EXTRA='hud=0'` in `tools/capture_sim.sh` included.
const restartButton = requireElement("#restart");
const reseedButton = requireElement("#reseed");
const stepButton = requireElement("#step");

if (params.get("hud") === "0") {
  document.querySelectorAll(".sim-bar, .sim-readout, .sim-log, .sim-help")
    .forEach((panel) => panel.remove());
}

const rigwalkerAsset = await loadRigwalkerAsset("/models/rigwalker.glb");

const scene = new THREE.Scene();
applyMarsAtmosphere(scene);
addMarsLighting(scene, 26);
// Segments track the size, so the ground stays about as finely tessellated as
// it was when the arena was a third smaller rather than getting coarser.
scene.add(createTerrain(ARENA_SIZE, 144), createRocks(ARENA_SIZE, 40, [new THREE.Vector2()], 13));

const renderer = createMarsRenderer(canvas);
const startingZoom = Number(params.get("zoom") ?? 3.2);
const fov = Number(params.get("fov") ?? DEFAULT_FOV);
// Both projections exist from the start and the view swaps between them, so a
// comparison is one keystroke on the same frame of the same seeded fight rather
// than two runs that have to be trusted to match.
const orthographicCamera = createTabletopCamera(startingZoom);
const perspectiveCamera = createPerspectiveCamera(startingZoom, fov);
let camera: TabletopCamera = params.get("camera") === "perspective"
  ? perspectiveCamera
  : orthographicCamera;
const orbit = createCameraOrbit();
/**
 * How much the view is magnified, held here rather than on a camera because the
 * two projections spend it differently: orthographic narrows its frustum on the
 * spot, perspective walks the eye in and leaves the lens alone.
 */
let zoomLevel = startingZoom;
// A headless capture cannot press a key, so the angle is a URL parameter too:
// degrees swung from the default three-quarter view.
orbitBy(
  orbit,
  THREE.MathUtils.degToRad(Number(params.get("yaw") ?? 0)),
  THREE.MathUtils.degToRad(Number(params.get("pitch") ?? 0)),
);
const cameraOffset = new THREE.Vector3();
const focus = new THREE.Vector3();
const centroid = new THREE.Vector3();
// Scratch for the `contacts=1` diagnostic: where a strike's sparks are thrown,
// in the attacker's own frame. Reach is toward the opponent.
const contactPoint = new THREE.Vector3();
const contactForward = new THREE.Vector3();
const contactRight = new THREE.Vector3();
const contactOffset = new THREE.Vector3();

const accentByCorporation = new Map<string, number>(
  TEAMS.map((team) => [team.corporation, team.accent]),
);
// Shared with the runtime, so `ai`, `physics` and `fx` are charged against the
// same frame this page charges `render` and `hud` to.
const perf = new PerfMonitor();
const battle = new BattleRuntime(scene, {
  // Read through a mutable holder so restarting reseeds the director without
  // rebuilding its effect pools.
  random: () => directorRandom(),
  accentOf: (corporation) => accentByCorporation.get(corporation) ?? 0xffb35d,
  perf,
});
/**
 * Draws the whole army through one call a part instead of thirty-three calls a
 * body. `batch=0` turns it off and puts the bodies back on their own meshes,
 * which is how a picture drawn this way is checked against the picture it
 * replaced — the two must be identical.
 */
const batch = params.get("batch") === "0"
  ? null
  : new RigwalkerBatch(scene, LARGEST_MATCHUP);

// Absent when `hud=0` has stripped the panels for a clean render, and dropped
// for a headless capture too: that mode bursts the whole fight through in one
// synchronous go and then redraws a frozen frame, so it has no frame rate to
// report and a panel full of dashes in a screenshot reads as a broken page.
const perfPanel = document.querySelector<HTMLElement>("#perf");
if (captureTime !== null) perfPanel?.remove();
const perfReadout = perfPanel && captureTime === null ? new PerfReadout(perfPanel) : null;
/**
 * What the renderer drew, reused between frames rather than rebuilt. It counts
 * the shadow pass as well as the colour one, because `createMarsRenderer` stops
 * the renderer clearing the counters between the two; the frame resets it once
 * it has been read.
 */
const drawCount: DrawCount = { calls: 0, triangles: 0 };
function readDraws(): DrawCount {
  drawCount.calls = renderer.info.render.calls;
  drawCount.triangles = renderer.info.render.triangles;
  return drawCount;
}
battle.audio.installUnlockHandlers();

let directorRandom = createSeededRandom(1);
let matchup = params.get("matchup") ?? "1v1";
let seed = Number(params.get("seed") ?? 1);
let speed = Number(params.get("speed") ?? 1);
const showContacts = params.get("contacts") === "1";
/** Label of the one fighter the camera rides, e.g. `on=HR1`. */
const pinnedLabel = params.get("on");
const showFeet = params.get("feet") === "1";
let paused = false;
let stepRequested = false;
let simTime = 0;
let verdict: string | null = null;
let verdictTime = 0;
const labels = new Map<number, string>();
const log: LogEntry[] = [];
const tally = {
  swing: 0, throw: 0, block: 0, glance: 0, hit: 0, whiff: 0, riposte: 0, plan: 0, damage: 0,
};
let cues = new Map<number, CombatCue>();

if (!MATCHUPS[matchup]) matchup = "1v1";
seedInput.value = String(seed);
speedInput.value = String(speed);

function record(kind: string, text: string): void {
  log.push({ time: simTime, kind, text });
  if (log.length > LOG_LIMIT) log.shift();
}

function labelOf(unit: Rigwalker | undefined): string {
  return unit ? labels.get(unit.combatId) ?? "?" : "?";
}

function startMatch(): void {
  battle.reset();
  labels.clear();
  log.length = 0;
  simTime = 0;
  verdict = null;
  verdictTime = 0;
  for (const key of Object.keys(tally) as Array<keyof typeof tally>) tally[key] = 0;
  // A sixty-four a side restart must not spend half a second reading like the
  // duel it replaced.
  perf.reset();

  directorRandom = createSeededRandom(seed);
  // A separate stream for temperaments keeps a fighter's personality stable
  // when only the director's rolls change.
  const spawnRandom = createSeededRandom(seed * 2654435761 + 17);
  const setup = MATCHUPS[matchup];
  zoomLevel = Number(params.get("zoom") ?? setup.zoom);
  applyZoom();

  TEAMS.forEach((team, teamIndex) => {
    const roster = setup.teams[teamIndex];
    const spacing = setup.spacing ?? LINE_SPACING;
    // Measured from the back of the screen rather than from the front of it, so
    // adding ranks of swords does not walk the throwers into them.
    const setback = Math.max(0, rankDepth(roster.melee) - 1) * RANK_SPACING +
      (setup.setback ?? HURLER_SETBACK);
    let index = 0;
    for (const hurler of [false, true]) {
      const count = hurler ? roster.hurlers : roster.melee;
      for (let n = 0; n < count; n += 1) {
        const unit = createRigwalker(
          rigwalkerAsset, team.accent, team.corporation, spawnRandom,
          { role: hurler ? "hurler" : "melee" },
        );
        // Each role forms its own block, so the swords stand in front of the
        // hurlers rather than alongside them in one long mixed line.
        const { file, rank, width } = formationSlot(n, count);
        const lateral = (file - (width - 1) / 2) * spacing;
        const x = team.side *
          (setup.standoff + rank * RANK_SPACING + (hurler ? setback : 0));
        unit.group.position.set(x, terrainHeightAt(x, lateral) + 0.2, lateral);
        // Walk in rather than starting inside awareness range, so the approach
        // and the first sizing-up read as part of the fight.
        unit.moveTo(new THREE.Vector3(team.side * 1.6, 0, lateral * 0.35));
        battle.spawn(unit);
        index += 1;
        labels.set(unit.combatId, `${team.tag}${hurler ? "R" : ""}${index}`);
      }
    }
  });

  focus.set(0, 0, 0);
  record("start", `${matchup} · seed ${seed}`);
}

function livingByTeam(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unit of battle.units) {
    if (!unit.isAlive) continue;
    counts.set(unit.corporation, (counts.get(unit.corporation) ?? 0) + 1);
  }
  return counts;
}

function advance(delta: number): void {
  simTime += delta;
  const frame = battle.update(delta, simTime, {
    camera,
    focus,
    drawingBufferHeight: renderer.domElement.height,
    terrainHeightAt,
    obstacles: [],
  });
  cues = frame.cues;

  const byId = new Map(battle.units.map((unit) => [unit.combatId, unit]));
  for (const event of frame.events) {
    tally[event.type] += 1;
    const attacker = labelOf(byId.get(event.attackerId));
    const defender = labelOf(byId.get(event.defenderId));
    record(
      event.type,
      event.type === "swing"
        ? `${attacker} → ${defender} · ${event.line} · ${event.strategy}`
        : event.type === "throw"
          ? `${attacker} lets go a ${event.strategy} at ${defender} · ` +
            `${event.projectile?.speed} m/s · ${event.projectile?.flightTime.toFixed(2)} s`
        : event.type === "plan"
          ? `${attacker} commits to ${event.strategy}`
        : event.type === "riposte"
          ? `${attacker} turns it around on ${defender}`
          : `${defender} ${event.type === "whiff" ? "slips" : "takes it"} from ${attacker}`,
    );
  }
  if (showContacts) {
    for (const event of frame.events) {
      const attacker = byId.get(event.attackerId);
      const defender = byId.get(event.defenderId);
      if (!attacker || !defender) continue;
      attacker.getContactPoint(contactPoint);
      contactForward.copy(defender.group.position).sub(attacker.group.position)
        .setY(0).normalize();
      contactRight.set(0, 1, 0).cross(contactForward);
      contactOffset.copy(contactPoint).sub(attacker.group.position);
      record("contact", `${event.type}:${event.line} · reach ` +
        `${contactOffset.dot(contactForward).toFixed(2)} · side ` +
        `${contactOffset.dot(contactRight).toFixed(2)} · height ${contactOffset.y.toFixed(2)}`);
    }
  }
  for (const damage of frame.damage) {
    tally.damage += damage.amount;
    const target = byId.get(damage.targetId);
    record("damage", `${labelOf(target)} −${damage.amount} → ${Math.ceil(target?.health ?? 0)} HP`);
  }
  for (const unit of frame.defeats) {
    record("defeat", `${labelOf(unit)} is down`);
  }

  if (!verdict) {
    const living = livingByTeam();
    if (living.size <= 1 && battle.units.some((unit) => !unit.isAlive)) {
      const winner = [...living.keys()][0];
      verdict = winner ? `${winner} wins` : "Mutual destruction";
      verdictTime = simTime;
      record("start", `${verdict} at ${simTime.toFixed(1)} s`);
    }
  } else if (loopInput.checked && simTime - verdictTime > RESTART_DELAY) {
    seed += 1;
    seedInput.value = String(seed);
    startMatch();
    return;
  }

  updateCamera(delta);
}

function updateCamera(delta: number): void {
  const living = battle.units.filter((unit) => unit.isAlive);
  if (followInput.checked && living.length > 0) {
    centroid.set(0, 0, 0);
    // `on=HR1` pins the view to one fighter instead of the centre of the fight.
    // Judging a pose needs the unit to fill the frame, and at any useful zoom
    // the centroid of two fighters twelve metres apart frames neither of them.
    const pinned = pinnedLabel
      ? living.find((unit) => labels.get(unit.combatId) === pinnedLabel)
      : undefined;
    if (pinned) {
      centroid.copy(pinned.group.position);
    } else {
      for (const unit of living) centroid.add(unit.group.position);
      centroid.divideScalar(living.length);
    }
    centroid.y = 0;
    // Damped so a defeat that moves the centroid does not snap the view.
    focus.lerp(centroid, 1 - Math.exp(-3.2 * delta));
  }
  camera.position.copy(focus).add(orbitOffset(orbit, cameraOffset));
  camera.lookAt(focus);
}

function describeCue(cue: CombatCue | undefined): { action: string; detail: string } {
  if (!cue || cue.targetId === null) return { action: "idle", detail: "no contact" };
  const strategy = cue.strategy ? STRATEGY_LABELS[cue.strategy] : "—";
  const feint = cue.feintLine ? ` (shows ${cue.feintLine})` : "";
  return {
    action: cue.action,
    detail: `${strategy} · ${cue.line}${feint} · ${cue.movement}`,
  };
}

function renderReadout(): void {
  clockValue.textContent = `${simTime.toFixed(2)} s`;
  projectionValue.textContent = describeProjection();
  verdictValue.textContent = verdict ?? (paused ? "paused" : "fighting");

  renderRoster();

  tallyList.replaceChildren(...Object.entries(tally).flatMap(([key, value]) => {
    const term = document.createElement("dt");
    term.textContent = key;
    const definition = document.createElement("dd");
    definition.textContent = String(value);
    return [term, definition];
  }));

  logList.replaceChildren(...log.map((entry) => {
    const item = document.createElement("li");
    item.className = entry.kind;
    const time = document.createElement("time");
    time.textContent = entry.time.toFixed(2);
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = entry.kind;
    const text = document.createElement("span");
    text.textContent = entry.text;
    item.append(time, kind, text);
    return item;
  }));
}

/**
 * A card each while a fight is small enough to be followed fighter by fighter,
 * and what each side has left once it is not. An army's worth of cards is not a
 * readout, and building it is the single most expensive thing on this page.
 */
function renderRoster(): void {
  if (battle.units.length > MAX_FIGHTER_CARDS) {
    fighterList.replaceChildren(...TEAMS.map((team) => {
      const roster = battle.units.filter(
        (unit) => unit.corporation === team.corporation,
      );
      const living = roster.filter((unit) => unit.isAlive);
      const hurlers = living.filter((unit) => unit.role === "hurler").length;
      const health = living.reduce((sum, unit) => sum + unit.health, 0);
      const maxHealth = living.reduce((sum, unit) => sum + unit.maxHealth, 0);

      const card = document.createElement("div");
      card.className = living.length > 0 ? "fighter" : "fighter down";
      card.style.setProperty("--accent", `#${team.accent.toString(16).padStart(6, "0")}`);
      card.innerHTML =
        `<span class="name">${team.corporation}</span>` +
        `<span class="hp"><span style="width:${
          maxHealth > 0 ? (health / maxHealth) * 100 : 0
        }%"></span></span>` +
        `<span class="line"><b>${living.length}</b> of ${roster.length} up · ` +
        `${living.length - hurlers} sword · ${hurlers} hurling</span>`;
      return card;
    }));
    return;
  }

  const byId = new Map(battle.units.map((unit) => [unit.combatId, unit]));
  fighterList.replaceChildren(...battle.units.map((unit) => {
    const cue = cues.get(unit.combatId);
    const { action, detail } = describeCue(cue);
    const target = cue?.targetId != null ? byId.get(cue.targetId) : undefined;

    const card = document.createElement("div");
    card.className = unit.isAlive ? "fighter" : "fighter down";
    card.style.setProperty(
      "--accent",
      `#${(accentByCorporation.get(unit.corporation) ?? 0xffb35d).toString(16).padStart(6, "0")}`,
    );
    card.innerHTML =
      `<span class="name">${labelOf(unit)}${unit.role === "hurler" ? " ⟡" : ""}</span>` +
      `<span class="hp"><span style="width:${(unit.health / unit.maxHealth) * 100}%"></span></span>` +
      `<span class="line"><b>${Math.ceil(unit.health)} HP</b> · ${unit.combatProfile.temperament}` +
      `${target ? ` · vs ${labelOf(target)} @ ${unit.group.position.distanceTo(target.group.position).toFixed(2)} m` : ""}</span>` +
      `<span class="line"><b>${action}</b> · ${detail}${showFeet ? describeFeet(unit) : ""}</span>` +
      `<span class="phase"><span style="width:${(cue?.phase ?? 0) * 100}%"></span></span>`;
    return card;
  }));
}

/**
 * Spends the zoom on whichever projection is drawing.
 *
 * Orthographic scales its frustum and stays where it is; distance means nothing
 * to it. Perspective must not do that. Narrowing the lens to magnify is what a
 * telephoto does, and a telephoto flattens depth — at the sim's usual 3.2× that
 * is a fourteen-degree lens sixty-six metres out, which is orthographic in all
 * but name and made the whole toggle look broken. So the lens is left alone and
 * the eye walks in until the focus is framed the same, which is the one way to
 * magnify that keeps the perspective it was turned on for.
 */
function applyZoom(): void {
  if (camera === perspectiveCamera) {
    perspectiveCamera.zoom = 1;
    orbit.radius = radiusForFov(fov, VIEW_HEIGHT / zoomLevel);
  } else {
    orthographicCamera.zoom = zoomLevel;
    orbit.radius = radiusForFov(fov);
  }
  camera.updateProjectionMatrix();
}

/**
 * What the view is being drawn through. Perspective also reports the lens and
 * how far out the eye ended up, because those are what decide how much depth
 * the picture has — and because a mode with no readout is a mode that looks
 * like it did nothing.
 */
function describeProjection(): string {
  return camera === perspectiveCamera
    ? `persp ${fov.toFixed(0)}° · ${orbit.radius.toFixed(0)} m`
    : `ortho ${zoomLevel.toFixed(1)}×`;
}

function resize(): void {
  fitCameraToViewport(camera, renderer, window.innerWidth, window.innerHeight);
}

/**
 * Swaps the projection under the running fight. Zoom carries across, so the
 * framing at the focus is held and the only thing that changes is what depth
 * does to everything in front of and behind it — which is the question.
 */
function setPerspective(next: boolean): void {
  const wanted = next ? perspectiveCamera : orthographicCamera;
  if (wanted === camera) return;
  camera = wanted;
  applyZoom();
  resize();
  updateCamera(0);
}

window.addEventListener("resize", resize);
resize();

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-matchup]")) {
  button.addEventListener("click", () => {
    matchup = button.dataset.matchup!;
    syncMatchupButtons();
    startMatch();
  });
}

function syncMatchupButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-matchup]")) {
    button.setAttribute("aria-pressed", String(button.dataset.matchup === matchup));
  }
}

function setPaused(next: boolean): void {
  paused = next;
  pauseButton.textContent = paused ? "Resume" : "Pause";
}

restartButton.addEventListener("click", startMatch);
reseedButton.addEventListener("click", () => {
  seed = Math.floor(Math.random() * 100000);
  seedInput.value = String(seed);
  startMatch();
});
seedInput.addEventListener("change", () => {
  seed = Number(seedInput.value) || 0;
  startMatch();
});
stepButton.addEventListener("click", () => {
  setPaused(true);
  stepRequested = true;
});
pauseButton.addEventListener("click", () => setPaused(!paused));
speedInput.addEventListener("input", () => {
  speed = Number(speedInput.value);
  speedValue.textContent = `${speed.toFixed(2)}×`;
});
muteInput.addEventListener("change", () => battle.audio.setMuted(muteInput.checked));

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    setPaused(!paused);
  } else if (event.code === "Period") {
    setPaused(true);
    stepRequested = true;
  } else if (event.code === "KeyR") {
    startMatch();
  } else if (/^Digit[1-9]$/.test(event.code)) {
    matchup = Object.keys(MATCHUPS)[Number(event.code.slice(5)) - 1] ?? matchup;
    syncMatchupButtons();
    startMatch();
  } else if (/^Key[WASD]$/.test(event.code)) {
    // Panning is an explicit choice to stop following the fight.
    followInput.checked = false;
    const pan = (2.4 * Math.SQRT2) / zoomLevel;
    if (event.code === "KeyA") panFocus(orbit, focus, 0, -1, pan);
    if (event.code === "KeyD") panFocus(orbit, focus, 0, 1, pan);
    if (event.code === "KeyW") panFocus(orbit, focus, 1, 0, pan);
    if (event.code === "KeyS") panFocus(orbit, focus, -1, 0, pan);
  } else if (event.code === "KeyP") {
    setPerspective(camera === orthographicCamera);
  } else if (/^Arrow(Left|Right|Up|Down)$/.test(event.code)) {
    // Swinging the view is not a pan: the fight stays framed, the angle on it
    // changes. Following is left alone so a fight can be circled while it runs.
    event.preventDefault();
    if (event.code === "ArrowLeft") orbitBy(orbit, -ORBIT_STEP, 0);
    if (event.code === "ArrowRight") orbitBy(orbit, ORBIT_STEP, 0);
    if (event.code === "ArrowUp") orbitBy(orbit, 0, ORBIT_STEP);
    if (event.code === "ArrowDown") orbitBy(orbit, 0, -ORBIT_STEP);
  }
});

canvas.addEventListener("wheel", (event) => {
  zoomLevel = THREE.MathUtils.clamp(
    zoomLevel * Math.exp(-event.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM,
  );
  applyZoom();
  event.preventDefault();
}, { passive: false });

speedValue.textContent = `${speed.toFixed(2)}×`;
syncMatchupButtons();
startMatch();

if (captureTime !== null) {
  // Headless capture: step the whole fight in one synchronous burst with a
  // fixed timestep, then draw a single frame. Skipping the intermediate draws
  // is what makes a nine-second fight capturable in a second.
  battle.audio.setMuted(true);
  // Auto-restart would reset the clock the loop is waiting on, so a capture
  // past the end of a fight would never finish. A capture shows one fight.
  loopInput.checked = false;
  while (simTime < captureTime) advance(captureStep);
  updateCamera(captureStep);
  renderReadout();
  document.title = `${matchup} seed ${seed} @ ${simTime.toFixed(2)}s` +
    ` · ${describeProjection()} — ${verdict ?? "fighting"}`;
  Object.assign(window, { __simCapture: { matchup, seed, time: simTime, verdict, tally } });
  // Redraw the frozen frame every tick. A canvas rendered once is empty by the
  // time a screenshot is taken, and screenshots are the point of this mode.
  // The batch is synced inside the loop rather than once before it: it owns the
  // scene's matrix update, so a draw that skipped it would draw stale matrices.
  renderer.setAnimationLoop(() => {
    batch?.sync(battle.units);
    renderer.render(scene, camera);
    renderer.info.reset();
  });
} else {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const frameDelta = Math.min(clock.getDelta(), 0.05);
    if (stepRequested) {
      stepRequested = false;
      advance(CAPTURE_STEP);
    } else if (!paused) {
      advance(frameDelta * speed);
    } else {
      updateCamera(frameDelta);
    }
    perf.measure("hud", () => renderReadout());
    // Filling the instances is charged to `render` because that is what it is:
    // work done to put this frame on the screen, not work the fight asked for.
    perf.measure("render", () => {
      batch?.sync(battle.units);
      renderer.render(scene, camera);
    });
    // The perf panel is charged to `hud` like the rest of the readout: an
    // instrument that leaves its own cost out of the picture is an instrument
    // that reports a frame nobody has.
    perf.measure("hud", () => perfReadout?.update(
      frameDelta, perf, battle.units.length, readDraws(),
    ));
    renderer.info.reset();
    perf.endFrame();
  });
}
