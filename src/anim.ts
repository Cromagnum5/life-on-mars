import * as THREE from "three";
import {
  BASE_FIGHT_DISTANCE,
  MEDIUM_THROW_RANGE,
  THROW_PROFILES,
  type AttackLine,
  type CombatAction,
  type CombatCue,
  type CombatRole,
  type CombatStrategy,
  type ThrowType,
} from "./combat";
import {
  POSE_TUNING,
  serializePoseTuning,
  type Beat,
  type PoseTuning,
  type ThrowArmKey,
} from "./pose-tuning";
import { createRigwalker, describeFeet, hurlStep, type Rigwalker } from "./rigwalker";
import { loadRigwalkerAsset } from "./rigwalker-assets";
import {
  addMarsLighting,
  applyMarsAtmosphere,
  DEFAULT_FOV,
  createCameraOrbit,
  createMarsRenderer,
  createPerspectiveCamera,
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
import "./anim.css";

/**
 * An animation workbench. One Rigwalker, one motion, and a phase you hold still
 * — plus the numbers that motion is made of, as controls that move the rig while
 * you drag them.
 *
 * It is the combat sim with the fight taken out. A fight is the wrong instrument
 * for a pose: the phase you want to look at goes past in a tenth of a second and
 * never comes back at the same value, and the director decides when. Here the
 * phase is a slider, so the same frame can be looked at from every angle, argued
 * about, adjusted and looked at again.
 *
 * What it is **not** is a keyframe editor for the GLB. The combat poses are not
 * in the model; they are written in `src/rigwalker.ts` as offsets from the rest
 * pose, driven by beats. So this edits `src/pose-tuning.ts` — the timing of
 * those beats and the keys of the throwing arm's arc — and **Save** writes that
 * file back through the dev server, because a LAN address is not a secure
 * context and the clipboard is not available there.
 *
 * It poses the rig by handing the real `Rigwalker.update` a hand-written cue,
 * so what is on screen has been through `applyThrowPose`, the balance layer and
 * the model offset — the same three layers the game draws, which is what makes
 * this the same instrument as `tools/capture_sim.sh` rather than a fourth
 * opinion. The Blender tools stop after the first layer, and never agree.
 *
 * URL parameters, all optional:
 *   motion=hurl   which motion is loaded; see `MOTIONS`
 *   phase=0.58    where to hold it, 0..1
 *   play=1        run it instead of holding still
 *   line=flank    which line a sword motion cuts on
 *   zoom=5        how much of the frame the body fills
 *   yaw=90 pitch=-20   degrees the view is swung and tipped
 *   camera=perspective fov=70   the sim's projection toggle, same keys
 *   hud=0         hide the panels
 */

/** Nothing here is a fight, so the arena only has to hold one fighter and a mark. */
const ARENA_SIZE = 24;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 14;
const ORBIT_STEP = THREE.MathUtils.degToRad(15);
/** One frame at sixty, which is what `,` and `.` step. */
const FRAME_STEP = 1 / 60;
/**
 * Which way the subject faces, in radians about the vertical. Chosen against the
 * default three-quarter view so a motion crosses the frame rather than being
 * thrown away from the camera: the arm's arc is what is being looked at, and an
 * arc coming straight at the eye is a dot.
 */
const SUBJECT_BEARING = Math.PI * 0.75;
/**
 * How far the mark stands, by what the motion is. A sword cut wants its opponent
 * in the frame, at the distance the director actually holds a duel, so a blade
 * falling short is visible as falling short. A throw does not: its target is tens
 * of metres off and would only drag the eye away from the thrower.
 */
const MARK_DISTANCE: Record<CombatRole, number> = {
  melee: BASE_FIGHT_DISTANCE,
  hurler: MEDIUM_THROW_RANGE,
};

/**
 * A motion is one cue held at a phase. `seconds` is how long the director gives
 * it in a real fight, so playback runs at the speed the game plays it; `release`
 * is the phase the rock leaves, drawn on the timeline because it is the frame
 * every throw is really judged on.
 *
 * `tunable` names the throw whose numbers the editor panel opens. The sword
 * poses have none yet — `applyCombatPose` still sums its coefficients inline —
 * so those motions scrub but do not edit.
 */
type Motion = {
  label: string;
  role: CombatRole;
  action: CombatAction;
  strategy: CombatStrategy | null;
  seconds: number;
  release: number | null;
  tunable: ThrowType | null;
  /** Uses the line picker, which only means anything to a sword. */
  lined: boolean;
};

function throwMotion(type: ThrowType): Motion {
  const profile = THROW_PROFILES[type];
  return {
    label: type,
    role: "hurler",
    action: "attack",
    strategy: type,
    seconds: profile.motion,
    release: profile.release,
    tunable: type,
    lined: false,
  };
}

const MOTIONS: Record<string, Motion> = {
  hurl: throwMotion("hurl"),
  pitch: throwMotion("pitch"),
  toss: throwMotion("toss"),
  // The aim that precedes a throw, and the stance a hurler holds between them —
  // which is the pose it is in for most of a fight, and so the one most worth
  // looking at. Both are the ready end of the arm arc, so they move when it does.
  aim: {
    label: "aim", role: "hurler", action: "size-up", strategy: "hurl",
    seconds: 0.8, release: null, tunable: "hurl", lined: false,
  },
  ready: {
    label: "ready", role: "hurler", action: "recover", strategy: "hurl",
    seconds: 2, release: null, tunable: "hurl", lined: false,
  },
  // The sword, for comparison. A hurler's stance has to read as a different unit
  // at a glance, and that is only judgeable against the thing it differs from.
  cut: {
    label: "cut", role: "melee", action: "attack", strategy: "rush",
    seconds: 1.08, release: null, tunable: null, lined: true,
  },
  guard: {
    label: "guard", role: "melee", action: "block", strategy: "react",
    seconds: 0.6, release: null, tunable: null, lined: true,
  },
  struck: {
    label: "struck", role: "melee", action: "hit", strategy: null,
    seconds: 0.42, release: null, tunable: null, lined: true,
  },
};

const MOTION_KEYS = Object.keys(MOTIONS);

const params = new URLSearchParams(window.location.search);

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Anim tool markup is missing ${selector}.`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#stage");
const motionBar = requireElement<HTMLElement>("#motions");
const editorPanel = requireElement<HTMLElement>("#editor");
const measureList = requireElement<HTMLElement>("#measures");
const trackList = requireElement<HTMLElement>("#tracks");
const playhead = requireElement<HTMLElement>("#playhead");
const releaseMark = requireElement<HTMLElement>("#release");
const clockValue = requireElement<HTMLElement>("#clock");
const projectionValue = requireElement<HTMLElement>("#projection");
const motionValue = requireElement<HTMLElement>("#motion-name");
const playButton = requireElement<HTMLButtonElement>("#play");
const speedInput = requireElement<HTMLInputElement>("#speed");
const speedValue = requireElement<HTMLElement>("#speed-value");
const loopInput = requireElement<HTMLInputElement>("#loop");
const lineInput = requireElement<HTMLSelectElement>("#line");
const intensityInput = requireElement<HTMLInputElement>("#intensity");
const intensityValue = requireElement<HTMLElement>("#intensity-value");
const saveButton = requireElement<HTMLButtonElement>("#save");
const revertButton = requireElement<HTMLButtonElement>("#revert");
const saveStatus = requireElement<HTMLElement>("#save-status");
const exportBox = requireElement<HTMLTextAreaElement>("#export");

if (params.get("hud") === "0") {
  document.querySelectorAll(".sim-bar, .sim-readout, .sim-help, .anim-editor, .anim-timeline")
    .forEach((panel) => panel.remove());
}

/** What the page loaded with, so **Revert** can put every number back. */
const loadedTuning: PoseTuning = structuredClone(POSE_TUNING);

const asset = await loadRigwalkerAsset("/models/rigwalker.glb");

const scene = new THREE.Scene();
applyMarsAtmosphere(scene);
addMarsLighting(scene, 16);
// No scatter of rocks: at this zoom one would sit in front of the fighter's
// feet, and the feet are what is being looked at.
scene.add(createTerrain(ARENA_SIZE, 64));

const renderer = createMarsRenderer(canvas);
const fov = Number(params.get("fov") ?? DEFAULT_FOV);
const orthographicCamera = createTabletopCamera(1);
const perspectiveCamera = createPerspectiveCamera(1, fov);
let camera: TabletopCamera = params.get("camera") === "perspective"
  ? perspectiveCamera
  : orthographicCamera;
const orbit = createCameraOrbit();
/** The view the `yaw` and `pitch` parameters are measured from. */
const defaultOrbit = createCameraOrbit();
let zoomLevel = Number(params.get("zoom") ?? 5);
orbitBy(
  orbit,
  THREE.MathUtils.degToRad(Number(params.get("yaw") ?? 0)),
  THREE.MathUtils.degToRad(Number(params.get("pitch") ?? 0)),
);
const cameraOffset = new THREE.Vector3();
/** Chest height, so the body is centred in the frame rather than sat on the floor. */
const FOCUS_HEIGHT = 1.9;
const focus = new THREE.Vector3(0, FOCUS_HEIGHT, 0);
const rockProbe = new THREE.Vector3();

/**
 * One fighter of each kind, both spawned from the same seed so neither carries a
 * personality the other does not, and a mark for them to face. A pose needs a
 * target: `Rigwalker.update` only reaches its combat poses when the cue names
 * somebody, which is also what makes this the game's own code path.
 */
function spawn(role: CombatRole, x: number, z: number): Rigwalker {
  const unit = createRigwalker(asset, role === "hurler" ? 0x32b9ff : 0xff4f57,
    role === "hurler" ? "Helios" : "Vanguard", () => 0.5, { role });
  unit.group.position.set(x, terrainHeightAt(x, z) + 0.2, z);
  scene.add(unit.group);
  return unit;
}

const hurler = spawn("hurler", 0, 0);
const swordsman = spawn("melee", 0, 0);
const mark = spawn("melee", 0, 0);
// The subject holds still — a planted cue never turns it — so it is aimed once,
// here, and the mark is only ever something to be aimed at. `placeMark` puts
// that mark where the motion's own fighting distance says it stands.
for (const unit of [hurler, swordsman]) unit.group.rotation.y = SUBJECT_BEARING;
mark.group.rotation.y = SUBJECT_BEARING + Math.PI;

function placeMark(): void {
  const distance = MARK_DISTANCE[motion().role];
  const x = Math.sin(SUBJECT_BEARING) * distance;
  const z = Math.cos(SUBJECT_BEARING) * distance;
  mark.group.position.set(x, terrainHeightAt(x, z) + 0.2, z);
}

let motionKey = MOTIONS[params.get("motion") ?? ""] ? params.get("motion")! : "hurl";
let phase = THREE.MathUtils.clamp(Number(params.get("phase") ?? 0.58), 0, 1);
let playing = params.get("play") === "1";
let speed = 0.5;
let intensity = 0.72;
let line: AttackLine = (params.get("line") as AttackLine | null) ?? "overhead";

function motion(): Motion {
  return MOTIONS[motionKey];
}

function subject(): Rigwalker {
  return motion().role === "hurler" ? hurler : swordsman;
}

/**
 * The cue the director would be writing if this motion were happening in a
 * fight. `plant` is the whole trick: it is the movement a throw already uses, so
 * the fighter stays exactly where it is put and the pose is the only thing
 * moving.
 */
function currentCue(): CombatCue {
  const current = motion();
  return {
    plannerId: subject().combatId,
    targetId: mark.combatId,
    action: current.action,
    movement: "plant",
    phase,
    strategy: current.strategy,
    line,
    feintLine: null,
    side: 1,
    intensity,
    outcome: "pending",
    preferredDistance: MARK_DISTANCE[current.role],
  };
}

/** Every unit the subject can see: itself, and the mark it is facing. */
function nearby(): readonly Rigwalker[] {
  return [subject(), mark];
}

let elapsed = 0;

function advance(delta: number): void {
  elapsed += delta;
  const current = motion();
  if (playing) {
    phase += (delta * speed) / current.seconds;
    if (phase > 1) {
      if (loopInput.checked) {
        phase -= 1;
      } else {
        phase = 1;
        setPlaying(false);
      }
    }
  }
  subject().update(
    delta, elapsed, terrainHeightAt, nearby(), [], camera.quaternion, currentCue(),
  );
  // The mark is given no cue at all, so it idles: something to face and to read
  // a stance against, with nothing of its own going on.
  mark.update(delta, elapsed, terrainHeightAt, [mark], [], camera.quaternion);
  hurler.group.visible = current.role === "hurler";
  swordsman.group.visible = current.role === "melee";
  updateCamera();
}

/**
 * The subject never moves — a planted cue sees to that — so the focus is a place
 * rather than something to be followed, and `WASD` keeps it wherever it is put.
 * It sits at chest height so the body is centred in the frame instead of resting
 * on the bottom of it.
 */
function updateCamera(): void {
  camera.position.copy(focus).add(orbitOffset(orbit, cameraOffset));
  camera.lookAt(focus);
}

/**
 * What the pose costs, in the fighter's own frame. The feet line is the same one
 * `feet=1` prints in the sim, from the same function, so a stance argued here
 * and a stance argued off a capture sheet are the same numbers.
 */
function renderReadout(): void {
  const current = motion();
  const unit = subject();
  clockValue.textContent = `${(phase * current.seconds).toFixed(2)} s`;
  projectionValue.textContent = camera === perspectiveCamera
    ? `persp ${fov.toFixed(0)}° · ${orbit.radius.toFixed(0)} m`
    : `ortho ${zoomLevel.toFixed(1)}×`;
  motionValue.textContent = current.label;

  const rows: Array<[string, string]> = [
    ["phase", phase.toFixed(3)],
  ];
  if (current.tunable && current.action === "attack") {
    const step = hurlStep(current.tunable, phase);
    rows.push(
      ["engagement", step.engagement.toFixed(2)],
      ["forward", `${step.forward >= 0 ? "+" : ""}${step.forward.toFixed(3)} m`],
      ["drop", `${step.drop >= 0 ? "+" : ""}${step.drop.toFixed(3)} m`],
    );
  }
  // The rock's height off the ground, which is the number the three throws are
  // ordered by: a hurl has to release above a pitch or they stop reading in
  // order. It is only meaningful at the release phase, marked on the timeline.
  const rock = unit.group.getObjectByName("Rigwalker held rock");
  if (rock) {
    rock.getWorldPosition(rockProbe);
    rows.push(["rock", `${rockProbe.y.toFixed(2)} m`]);
  }
  rows.push(["feet", describeFeet(unit).replace(" · feet ", "")]);

  measureList.replaceChildren(...rows.flatMap(([name, value]) => {
    const term = document.createElement("dt");
    term.textContent = name;
    const definition = document.createElement("dd");
    definition.textContent = value;
    return [term, definition];
  }));
}

// ---------------------------------------------------------------------------
// The timeline: every beat of the current motion as a band, drawn where it
// fades in and out, so what the numbers below mean can be seen at a glance.
// ---------------------------------------------------------------------------

/** A beat as a band: transparent, up to full over the fade-in, back down over the fade-out. */
function bandFor(beat: Beat): string {
  const [inStart, inEnd, outStart, outEnd] = beat;
  const stop = (value: number) => `${(THREE.MathUtils.clamp(value, 0, 1) * 100).toFixed(2)}%`;
  return "linear-gradient(90deg, transparent 0, " +
    `transparent ${stop(inStart)}, var(--band) ${stop(inEnd)}, ` +
    `var(--band) ${stop(outStart)}, transparent ${stop(outEnd)}, transparent 100%)`;
}

type Track = { name: string; beat: Beat; accent: string };

function tracksFor(current: Motion): Track[] {
  if (!current.tunable) return [];
  const drive = POSE_TUNING.throwBeats[current.tunable];
  const tracks: Track[] = [
    { name: "draw", beat: drive.draw, accent: "#ffb35d" },
    { name: "stride", beat: drive.stride, accent: "#ffb35d" },
    { name: "whip", beat: drive.whip, accent: "#ff8f5e" },
    { name: "follow", beat: drive.follow, accent: "#ff8f5e" },
  ];
  if (current.tunable === "hurl") {
    for (const name of ["tuck", "swing", "step", "heel", "drive", "home"] as const) {
      tracks.push({ name, beat: POSE_TUNING.hurlLegs[name], accent: "#9ad0ff" });
    }
    tracks.push({ name: "open", beat: POSE_TUNING.hurlLegs.open, accent: "#9d8bd8" });
  }
  return tracks;
}

function buildTimeline(): void {
  const current = motion();
  const tracks = tracksFor(current);
  // The ruler is always there, whether or not the motion has beats to draw: it
  // is what the playhead is measured against and what a drag scrubs along, and a
  // sword cut needs scrubbing exactly as much as a throw does.
  const ruler = document.createElement("div");
  ruler.className = "anim-track anim-ruler";
  const rulerLabel = document.createElement("span");
  rulerLabel.textContent = `${current.seconds.toFixed(2)} s`;
  ruler.append(rulerLabel, document.createElement("i"));
  trackList.replaceChildren(ruler, ...tracks.map((track) => {
    const row = document.createElement("div");
    row.className = "anim-track";
    const label = document.createElement("span");
    label.textContent = track.name;
    const band = document.createElement("i");
    band.style.setProperty("--band", track.accent);
    band.style.backgroundImage = bandFor(track.beat);
    row.append(label, band);
    return row;
  }));
  // The arm keys ride their own row, as ticks that can be jumped to.
  if (current.tunable) {
    const row = document.createElement("div");
    row.className = "anim-track anim-keys";
    const label = document.createElement("span");
    label.textContent = "arm";
    const band = document.createElement("i");
    for (const key of POSE_TUNING.armKeys[current.tunable]) {
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "anim-tick";
      tick.style.left = `${key.at * 100}%`;
      tick.title = `key at ${key.at.toFixed(2)}`;
      tick.addEventListener("click", () => setPhase(key.at));
      band.append(tick);
    }
    row.append(label, band);
    trackList.append(row);
  }
  releaseMark.style.display = current.release === null ? "none" : "";
  if (current.release !== null) releaseMark.style.left = alongTimeline(current.release);
}

function refreshTimelineBands(): void {
  const tracks = tracksFor(motion());
  const bands = trackList.querySelectorAll<HTMLElement>(
    ".anim-track:not(.anim-keys):not(.anim-ruler) i",
  );
  tracks.forEach((track, index) => {
    const band = bands[index];
    if (band) band.style.backgroundImage = bandFor(track.beat);
  });
}

/**
 * Phase as a position across the band area, which starts one label-column in
 * from the left edge of the strip. Everything drawn over the timeline — the
 * playhead, the release marker, a key's tick — has to agree about that inset or
 * it points at the wrong frame.
 */
function alongTimeline(at: number): string {
  return `calc(var(--label) + (100% - var(--label)) * ${THREE.MathUtils.clamp(at, 0, 1)})`;
}

function renderPlayhead(): void {
  playhead.style.left = alongTimeline(phase);
}

// ---------------------------------------------------------------------------
// The editor: one control per number, each moving the rig as it is dragged.
// ---------------------------------------------------------------------------

/** A labelled slider with the number beside it, both editable and kept in step. */
function control(
  parent: HTMLElement,
  name: string,
  value: number,
  min: number,
  max: number,
  onChange: (next: number) => void,
): void {
  const row = document.createElement("label");
  row.className = "anim-control";
  const label = document.createElement("span");
  label.textContent = name;
  const slider = document.createElement("input");
  slider.type = "range";
  const number = document.createElement("input");
  number.type = "number";
  for (const input of [slider, number]) {
    input.min = String(min);
    input.max = String(max);
    input.step = "0.01";
    input.value = String(Number(value.toFixed(3)));
  }
  const apply = (source: HTMLInputElement, other: HTMLInputElement) => {
    const next = THREE.MathUtils.clamp(Number(source.value), min, max);
    other.value = String(Number(next.toFixed(3)));
    onChange(next);
    afterEdit();
  };
  slider.addEventListener("input", () => apply(slider, number));
  number.addEventListener("input", () => apply(number, slider));
  row.append(label, slider, number);
  parent.append(row);
}

function section(title: string, note?: string): HTMLElement {
  const block = document.createElement("section");
  block.className = "anim-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  block.append(heading);
  if (note) {
    const paragraph = document.createElement("p");
    paragraph.textContent = note;
    block.append(paragraph);
  }
  editorPanel.append(block);
  return block;
}

/** The four numbers of one beat: in over the first pair, out over the second. */
function beatControls(parent: HTMLElement, name: string, beat: Beat): void {
  const group = document.createElement("div");
  group.className = "anim-beat";
  const heading = document.createElement("h3");
  heading.textContent = name;
  group.append(heading);
  const names = ["in", "full", "hold", "out"];
  beat.forEach((value, index) => {
    control(group, names[index], value, 0, 1, (next) => {
      beat[index] = next;
      refreshTimelineBands();
    });
  });
  parent.append(group);
}

/** How far a shoulder or an elbow is allowed to be pushed, in radians. */
const ANGLE_LIMIT = 2.4;

function armKeyControls(parent: HTMLElement, key: ThrowArmKey, keys: ThrowArmKey[]): void {
  const group = document.createElement("div");
  group.className = "anim-key";
  const heading = document.createElement("h3");
  const jump = document.createElement("button");
  jump.type = "button";
  jump.textContent = `at ${key.at.toFixed(2)}`;
  jump.title = "Hold the rig at this key";
  jump.addEventListener("click", () => setPhase(key.at));
  heading.append(jump);
  if (keys.length > 1) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "anim-remove";
    remove.textContent = "×";
    remove.title = "Drop this key from the arc";
    remove.addEventListener("click", () => {
      keys.splice(keys.indexOf(key), 1);
      afterEdit();
      buildEditor();
      buildTimeline();
    });
    heading.append(remove);
  }
  group.append(heading);
  // `at` is clamped inside the arc: a key at 0 or 1 would shadow the shared
  // ready pose that both ends of every arc are read from.
  control(group, "at", key.at, 0.01, 0.99, (next) => {
    key.at = next;
    keys.sort((a, b) => a.at - b.at);
    jump.textContent = `at ${next.toFixed(2)}`;
    buildTimeline();
  });
  for (const field of ["upperX", "upperY", "upperZ", "lowerX", "handX"] as const) {
    control(group, field, key[field], -ANGLE_LIMIT, ANGLE_LIMIT, (next) => {
      key[field] = next;
    });
  }
  parent.append(group);
}

function buildEditor(): void {
  editorPanel.replaceChildren();
  const current = motion();
  if (!current.tunable) {
    section(
      `${current.label} — nothing to tune yet`,
      "The sword poses are still summed inline in applyCombatPose. This motion " +
      "scrubs so a hurler's stance can be judged against the unit it has to " +
      "read differently from.",
    );
    return;
  }
  const type = current.tunable;

  const body = section(
    `${type} · body beats`,
    "Coil away, open, whip through, follow through. Each fades in over the " +
    "first pair and out over the second.",
  );
  const drive = POSE_TUNING.throwBeats[type];
  for (const name of ["draw", "stride", "whip", "follow"] as const) {
    beatControls(body, name, drive[name]);
  }

  if (type === "hurl") {
    const legs = section(
      "hurl · leg beats",
      "The legs keep their own time: a foot has to be off the ground before it " +
      "travels, or it skates.",
    );
    for (const name of ["tuck", "swing", "step", "heel", "drive", "home", "open"] as const) {
      beatControls(legs, name, POSE_TUNING.hurlLegs[name]);
    }
  }

  const arm = section(
    `${type} · arm arc`,
    "Poses along the arc, not a sum of beats: the shoulder only holds the arm " +
    "above shoulder height through a narrow band, and blending between two " +
    "poses either side of it drops the elbow to the hip on the way past.",
  );
  const keys = POSE_TUNING.armKeys[type];
  for (const key of keys) armKeyControls(arm, key, keys);
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add a key at the playhead";
  add.addEventListener("click", () => {
    const at = THREE.MathUtils.clamp(phase, 0.01, 0.99);
    const existing = keys.find((key) => Math.abs(key.at - at) < 0.005);
    if (existing) return;
    // Seeded with the pose the arm is already in at that phase, so adding a key
    // changes nothing until it is dragged.
    keys.push({ at, ...sampleArm(type, at) });
    keys.sort((a, b) => a.at - b.at);
    afterEdit();
    buildEditor();
    buildTimeline();
  });
  arm.append(add);

  const ready = section(
    "ready pose",
    "Both ends of all three arcs, and what a hurler stands in between throws. " +
    "One copy, so changing throw never jumps the arm.",
  );
  for (const field of ["upperX", "upperY", "upperZ", "lowerX", "handX"] as const) {
    control(ready, field, POSE_TUNING.ready[field], -ANGLE_LIMIT, ANGLE_LIMIT, (next) => {
      POSE_TUNING.ready[field] = next;
    });
  }
}

/**
 * The arm pose the arc already passes through at this phase, interpolated the
 * same way the rig does it. Written here rather than exported from
 * `rigwalker.ts` because that one returns a scratch object it reuses.
 */
function sampleArm(type: ThrowType, at: number): Omit<ThrowArmKey, "at"> {
  const keys = POSE_TUNING.armKeys[type];
  const ends: ThrowArmKey[] = [
    POSE_TUNING.ready, ...keys, { ...POSE_TUNING.ready, at: 1 },
  ];
  let index = 0;
  while (index < ends.length - 2 && at > ends[index + 1].at) index += 1;
  const from = ends[index];
  const to = ends[index + 1];
  const blend = THREE.MathUtils.smoothstep(at, from.at, to.at);
  const mix = (a: number, b: number) => a + (b - a) * blend;
  return {
    upperX: mix(from.upperX, to.upperX),
    upperY: mix(from.upperY, to.upperY),
    upperZ: mix(from.upperZ, to.upperZ),
    lowerX: mix(from.lowerX, to.lowerX),
    handX: mix(from.handX, to.handX),
  };
}

/** Every edit lands in `POSE_TUNING` directly, so all that is left is the export. */
function afterEdit(): void {
  exportBox.value = serializePoseTuning();
  saveStatus.textContent = "edited";
  saveStatus.className = "anim-dirty";
  savedMark = undefined;
}

/**
 * Keeps the address bar on the frame that is being looked at, the way the sim's
 * capture URLs do: what is on screen can be pasted to somebody else and be the
 * same picture.
 *
 * It also has to survive a save. Writing `src/pose-tuning.ts` is a change to a
 * module the page imports, so the dev server reloads the page on top of it —
 * which is the right thing to do, since it proves what is on disk is what is on
 * screen, but it would otherwise dump the motion, the phase and the camera every
 * time the button was pressed.
 */
let urlSignature = "";
/**
 * The last save's confirmation, kept in the URL. It has to be state rather than
 * an argument: the frame is written back to the address bar every idle frame,
 * and a marker passed in once would be rubbed out by the next one.
 */
let savedMark: string | undefined = params.get("saved") ?? undefined;

function syncUrl(): void {
  const next = new URLSearchParams();
  next.set("motion", motionKey);
  next.set("phase", phase.toFixed(3));
  next.set("zoom", zoomLevel.toFixed(2));
  const degrees = (radians: number) => THREE.MathUtils.radToDeg(radians).toFixed(1);
  if (Math.abs(orbit.yaw - defaultOrbit.yaw) > 1e-6) {
    next.set("yaw", degrees(orbit.yaw - defaultOrbit.yaw));
  }
  if (Math.abs(orbit.pitch - defaultOrbit.pitch) > 1e-6) {
    next.set("pitch", degrees(orbit.pitch - defaultOrbit.pitch));
  }
  if (camera === perspectiveCamera) next.set("camera", "perspective");
  if (motion().lined) next.set("line", line);
  if (savedMark) next.set("saved", savedMark);
  const signature = next.toString();
  if (signature === urlSignature) return;
  urlSignature = signature;
  history.replaceState(null, "", `?${signature}`);
}

// ---------------------------------------------------------------------------
// Transport, camera and saving.
// ---------------------------------------------------------------------------

function setPhase(next: number): void {
  phase = THREE.MathUtils.clamp(next, 0, 1);
  renderPlayhead();
}

function setPlaying(next: boolean): void {
  playing = next;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
}

function setMotion(key: string): void {
  motionKey = key;
  for (const button of motionBar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.motion === key));
  }
  lineInput.disabled = !motion().lined;
  placeMark();
  buildEditor();
  buildTimeline();
  renderPlayhead();
}

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

function resize(): void {
  fitCameraToViewport(camera, renderer, window.innerWidth, window.innerHeight);
}

function setPerspective(next: boolean): void {
  const wanted = next ? perspectiveCamera : orthographicCamera;
  if (wanted === camera) return;
  camera = wanted;
  applyZoom();
  resize();
  updateCamera();
}

for (const key of MOTION_KEYS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.motion = key;
  button.textContent = MOTIONS[key].label;
  button.addEventListener("click", () => setMotion(key));
  motionBar.append(button);
}

playButton.addEventListener("click", () => setPlaying(!playing));
speedInput.addEventListener("input", () => {
  speed = Number(speedInput.value);
  speedValue.textContent = `${speed.toFixed(2)}×`;
});
intensityInput.addEventListener("input", () => {
  intensity = Number(intensityInput.value);
  intensityValue.textContent = intensity.toFixed(2);
});
lineInput.addEventListener("change", () => {
  line = lineInput.value as AttackLine;
});

// Dragging anywhere on the timeline scrubs, which is the gesture the whole page
// is for. Pointer capture keeps the drag alive off the edge of the strip.
const timeline = requireElement<HTMLElement>(".anim-timeline");
function scrubFrom(event: PointerEvent): void {
  const band = trackList.querySelector(".anim-ruler i");
  if (!band) return;
  const bounds = band.getBoundingClientRect();
  setPhase((event.clientX - bounds.left) / bounds.width);
}
timeline.addEventListener("pointerdown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  setPlaying(false);
  timeline.setPointerCapture(event.pointerId);
  scrubFrom(event);
});
timeline.addEventListener("pointermove", (event) => {
  if (timeline.hasPointerCapture(event.pointerId)) scrubFrom(event);
});
timeline.addEventListener("pointerup", (event) => {
  timeline.releasePointerCapture(event.pointerId);
});

/**
 * Writes `src/pose-tuning.ts`, through a dev-server route rather than the
 * clipboard: this page is meant to be opened from another machine over plain
 * HTTP, and `navigator.clipboard` does not exist outside a secure context. The
 * text is in the panel either way, for a build where the route is not there.
 */
saveButton.addEventListener("click", async () => {
  saveStatus.textContent = "saving…";
  saveStatus.className = "";
  try {
    const response = await fetch("/__anim/pose-tuning", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: serializePoseTuning(),
    });
    const text = (await response.text()).trim();
    if (!response.ok) throw new Error(text || `${response.status}`);
    savedMark = text || "saved";
    saveStatus.textContent = savedMark;
    saveStatus.className = "anim-saved";
    // Carried in the URL because the reload that is about to land would take any
    // other kind of confirmation with it.
    syncUrl();
  } catch (error) {
    saveStatus.textContent = `${error instanceof Error ? error.message : error}`;
    saveStatus.className = "anim-failed";
  }
});

revertButton.addEventListener("click", () => {
  const restored = structuredClone(loadedTuning);
  POSE_TUNING.ready = restored.ready;
  POSE_TUNING.throwBeats = restored.throwBeats;
  POSE_TUNING.armKeys = restored.armKeys;
  POSE_TUNING.hurlLegs = restored.hurlLegs;
  buildEditor();
  buildTimeline();
  exportBox.value = serializePoseTuning();
  saveStatus.textContent = "reverted";
  saveStatus.className = "";
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return;
  }
  const current = motion();
  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!playing);
  } else if (event.code === "Comma" || event.code === "Period") {
    // A frame of this motion, at the rate the game plays it.
    setPlaying(false);
    setPhase(phase + (event.code === "Period" ? 1 : -1) * (FRAME_STEP / current.seconds));
  } else if (event.code === "BracketLeft" || event.code === "BracketRight") {
    if (!current.tunable) return;
    setPlaying(false);
    const stops = [0, ...POSE_TUNING.armKeys[current.tunable].map((key) => key.at), 1];
    setPhase(event.code === "BracketRight"
      ? stops.find((stop) => stop > phase + 0.001) ?? 1
      : [...stops].reverse().find((stop) => stop < phase - 0.001) ?? 0);
  } else if (/^Digit[1-9]$/.test(event.code)) {
    const key = MOTION_KEYS[Number(event.code.slice(5)) - 1];
    if (key) setMotion(key);
  } else if (/^Key[WASD]$/.test(event.code)) {
    const pan = 1.6 / zoomLevel;
    if (event.code === "KeyA") panFocus(orbit, focus, 0, -1, pan);
    if (event.code === "KeyD") panFocus(orbit, focus, 0, 1, pan);
    if (event.code === "KeyW") panFocus(orbit, focus, 1, 0, pan);
    if (event.code === "KeyS") panFocus(orbit, focus, -1, 0, pan);
  } else if (event.code === "KeyP") {
    setPerspective(camera === orthographicCamera);
  } else if (/^Arrow(Left|Right|Up|Down)$/.test(event.code)) {
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

window.addEventListener("resize", resize);

speedInput.value = String(speed);
speedValue.textContent = `${speed.toFixed(2)}×`;
intensityInput.value = String(intensity);
intensityValue.textContent = intensity.toFixed(2);
lineInput.value = line;
exportBox.value = serializePoseTuning();
setMotion(motionKey);
setPlaying(playing);
applyZoom();
resize();
// A save reloads the page, so the confirmation for the one that just happened
// arrives in the URL rather than in the status line it wrote before reloading.
if (savedMark) {
  saveStatus.textContent = savedMark;
  saveStatus.className = "anim-saved";
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  advance(Math.min(clock.getDelta(), 0.05));
  renderPlayhead();
  renderReadout();
  renderer.render(scene, camera);
  // Only while it is standing still: a playing motion would rewrite the address
  // bar sixty times a second and the frame it names would never be the one you
  // wanted anyway.
  if (!playing) syncUrl();
});
