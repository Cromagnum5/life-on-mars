import * as THREE from "three";
import { BattleRuntime } from "./battle";
import { STRATEGY_LABELS, type CombatCue } from "./combat";
import { createSeededRandom } from "./random";
import { createRigwalker, type Rigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
import {
  addMarsLighting,
  applyMarsAtmosphere,
  createMarsRenderer,
  createRocks,
  createTabletopCamera,
  createTerrain,
  fitCameraToViewport,
  terrainHeightAt,
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
 *   contacts=1   log where each strike throws its sparks, in the attacker's
 *                own frame, for checking that a swing lands on the opponent
 */

const ARENA_SIZE = 72;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 7;
/** Fixed timestep for reproducible headless captures. */
const CAPTURE_STEP = 1 / 60;
const LOG_LIMIT = 22;
const RESTART_DELAY = 2.5;
/** Cardinal spacing of a team's starting line. */
const LINE_SPACING = 2.7;

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
};
type Roster = { melee: number; hurlers: number };

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
};

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
const speedInput = requireElement<HTMLInputElement>("#speed");
const speedValue = requireElement<HTMLElement>("#speed-value");
const seedInput = requireElement<HTMLInputElement>("#seed");
const pauseButton = requireElement<HTMLButtonElement>("#pause");
const followInput = requireElement<HTMLInputElement>("#follow");
const loopInput = requireElement<HTMLInputElement>("#loop");
const muteInput = requireElement<HTMLInputElement>("#mute");

if (params.get("hud") === "0") {
  document.querySelectorAll(".sim-bar, .sim-readout, .sim-log, .sim-help")
    .forEach((panel) => panel.remove());
}

const rigwalkerAsset = await loadRigwalkerAsset("/models/rigwalker.glb");

const scene = new THREE.Scene();
applyMarsAtmosphere(scene);
addMarsLighting(scene, 26);
scene.add(createTerrain(ARENA_SIZE, 96), createRocks(ARENA_SIZE, 26, [new THREE.Vector2()], 13));

const renderer = createMarsRenderer(canvas);
const camera = createTabletopCamera(Number(params.get("zoom") ?? 3.2));
const cameraOffset = camera.position.clone();
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
const battle = new BattleRuntime(scene, {
  // Read through a mutable holder so restarting reseeds the director without
  // rebuilding its effect pools.
  random: () => directorRandom(),
  accentOf: (corporation) => accentByCorporation.get(corporation) ?? 0xffb35d,
});
battle.audio.installUnlockHandlers();

let directorRandom = createSeededRandom(1);
let matchup = params.get("matchup") ?? "1v1";
let seed = Number(params.get("seed") ?? 1);
let speed = Number(params.get("speed") ?? 1);
const showContacts = params.get("contacts") === "1";
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

  directorRandom = createSeededRandom(seed);
  // A separate stream for temperaments keeps a fighter's personality stable
  // when only the director's rolls change.
  const spawnRandom = createSeededRandom(seed * 2654435761 + 17);
  const setup = MATCHUPS[matchup];
  camera.zoom = Number(params.get("zoom") ?? setup.zoom);
  camera.updateProjectionMatrix();

  TEAMS.forEach((team, teamIndex) => {
    const roster = setup.teams[teamIndex];
    const count = roster.melee + roster.hurlers;
    for (let index = 0; index < count; index += 1) {
      // Hurlers take the back of the line, so a mixed team reads as a screen
      // with the throwers behind it rather than an even mix walking forward.
      const hurler = index >= roster.melee;
      const unit = createRigwalker(
        rigwalkerAsset, team.accent, team.corporation, spawnRandom,
        { role: hurler ? "hurler" : "melee" },
      );
      const lateral = (index - (count - 1) / 2) * LINE_SPACING;
      const x = team.side * (setup.standoff + (hurler ? 3.5 : 0));
      unit.group.position.set(x, terrainHeightAt(x, lateral) + 0.2, lateral);
      // Walk in rather than starting inside awareness range, so the approach
      // and the first sizing-up read as part of the fight.
      unit.moveTo(new THREE.Vector3(team.side * 1.6, 0, lateral * 0.35));
      battle.spawn(unit);
      labels.set(unit.combatId, `${team.tag}${hurler ? "R" : ""}${index + 1}`);
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
    for (const unit of living) centroid.add(unit.group.position);
    centroid.divideScalar(living.length);
    centroid.y = 0;
    // Damped so a defeat that moves the centroid does not snap the view.
    focus.lerp(centroid, 1 - Math.exp(-3.2 * delta));
  }
  camera.position.copy(focus).add(cameraOffset);
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
  verdictValue.textContent = verdict ?? (paused ? "paused" : "fighting");

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
      `<span class="line"><b>${action}</b> · ${detail}</span>` +
      `<span class="phase"><span style="width:${(cue?.phase ?? 0) * 100}%"></span></span>`;
    return card;
  }));

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

function resize(): void {
  fitCameraToViewport(camera, renderer, window.innerWidth, window.innerHeight);
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

requireElement("#restart").addEventListener("click", startMatch);
requireElement("#reseed").addEventListener("click", () => {
  seed = Math.floor(Math.random() * 100000);
  seedInput.value = String(seed);
  startMatch();
});
seedInput.addEventListener("change", () => {
  seed = Number(seedInput.value) || 0;
  startMatch();
});
requireElement("#step").addEventListener("click", () => {
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
    const pan = 2.4 / camera.zoom;
    if (event.code === "KeyA") focus.x -= pan, focus.z += pan;
    if (event.code === "KeyD") focus.x += pan, focus.z -= pan;
    if (event.code === "KeyW") focus.x -= pan, focus.z -= pan;
    if (event.code === "KeyS") focus.x += pan, focus.z += pan;
  }
});

canvas.addEventListener("wheel", (event) => {
  camera.zoom = THREE.MathUtils.clamp(
    camera.zoom * Math.exp(-event.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM,
  );
  camera.updateProjectionMatrix();
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
  document.title = `${matchup} seed ${seed} @ ${simTime.toFixed(2)}s — ${verdict ?? "fighting"}`;
  Object.assign(window, { __simCapture: { matchup, seed, time: simTime, verdict, tally } });
  // Redraw the frozen frame every tick. A canvas rendered once is empty by the
  // time a screenshot is taken, and screenshots are the point of this mode.
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
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
    renderReadout();
    renderer.render(scene, camera);
  });
}
