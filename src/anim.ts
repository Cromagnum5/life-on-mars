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
  FREE_ARM_DRIVES,
  POSE_TUNING,
  restorePoseTuning,
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
 * Every slider carries a pale mark at the value in the file, and a double-click
 * on the row goes back to it — one number at a time, where **Revert** is all of
 * them at once. The mark moves only when the file is written, so it is the thing
 * an edit is being judged against rather than a record of what was touched.
 *
 * Scrubbing is what the page is for, so it has as many ways in as it needs:
 * drag the bar at the top of the timeline, step a frame with `,` and `.`, ten
 * with those held under shift, jump to an arm key with `[` and `]`, or go to
 * either end with `Home` and `End`. The camera keys are the sim's, unchanged.
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

const torsoBox = new THREE.Box3();
const torsoCentre = new THREE.Vector3();
const torsoHalf = new THREE.Vector3();
const partProbe = new THREE.Vector3();

/**
 * How far clear of the torso the free arm is, in metres. Negative means it is
 * inside the body.
 *
 * This is the one pose fault a picture cannot show you. The free arm folds
 * across the chest on purpose, so the difference between going round the ribs
 * and going through them is a few centimetres of one Euler angle — and the arm
 * is drawn in front of the chest either way. Held across while the shoulder
 * drove it down and back, the elbow once sat a quarter of a metre inside the
 * torso for a fifth of the motion, and the only reason anybody found out was a
 * measurement.
 *
 * It is a port of `inside_torso` in `tools/render_rigwalker_throw.py`, sign
 * flipped so bigger is safer, and measured against the same three parts. The box
 * is taken in the torso's **own** space, because the chest is twisted through
 * most of a hurl and an axis-aligned box round a turned chest is a box round
 * nothing.
 */
function freeArmClearance(unit: Rigwalker): number | null {
  const torso = unit.group.getObjectByName("Torso");
  if (!(torso instanceof THREE.Mesh)) return null;
  torso.geometry.computeBoundingBox();
  const bounds = torso.geometry.boundingBox;
  if (!bounds) return null;
  torsoBox.copy(bounds);
  torsoBox.getCenter(torsoCentre);
  torsoBox.getSize(torsoHalf).multiplyScalar(0.5);
  let worst = Number.POSITIVE_INFINITY;
  for (const name of ["Elbow.L", "Forearm.L", "Hand.L"]) {
    // The glTF loader strips the dots out of a node's name, which is the same
    // fallback `findCombatBones` needs. Without it this measured nothing at all
    // and reported it as nothing to report.
    const part = unit.group.getObjectByName(name) ??
      unit.group.getObjectByName(name.replaceAll(".", ""));
    if (!part) continue;
    part.getWorldPosition(partProbe);
    torso.worldToLocal(partProbe);
    // Inside the box on every axis at once is inside the body; clear on any one
    // of them is clear, so the axis with the most room is the one that decides.
    const clearance = Math.max(
      Math.abs(partProbe.x - torsoCentre.x) - torsoHalf.x,
      Math.abs(partProbe.y - torsoCentre.y) - torsoHalf.y,
      Math.abs(partProbe.z - torsoCentre.z) - torsoHalf.z,
    );
    worst = Math.min(worst, clearance);
  }
  return Number.isFinite(worst) ? worst : null;
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
  const clearance = current.role === "hurler" ? freeArmClearance(unit) : null;
  if (clearance !== null) {
    rows.push(["free arm", `${clearance >= 0 ? "clear " : "BURIED "}` +
      `${Math.abs(clearance).toFixed(3)} m`]);
  }
  rows.push(["feet", describeFeet(unit).replace(" · feet ", "")]);

  measureList.replaceChildren(...rows.flatMap(([name, value]) => {
    const term = document.createElement("dt");
    term.textContent = name;
    const definition = document.createElement("dd");
    definition.textContent = value;
    // The one row that is a pass or a fail rather than a reading.
    if (name === "free arm") definition.className = clearance! < 0 ? "anim-failed" : "";
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
type ControlSpec = {
  name: string;
  value: number;
  min: number;
  max: number;
  /**
   * What this number is on disk, marked on the track so a slider can be pushed
   * around and put back by eye. Null when there is nothing to compare against —
   * an arm key that has been added since the file was last written has no saved
   * counterpart, and a mark drawn from a guess is worse than no mark.
   */
  saved: number | null;
  onChange: (next: number) => void;
};

function control(parent: HTMLElement, spec: ControlSpec): void {
  const { name, value, min, max, saved, onChange } = spec;
  const row = document.createElement("label");
  row.className = "anim-control";
  const label = document.createElement("span");
  label.textContent = name;
  const track = document.createElement("i");
  track.className = "anim-slider";
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
  track.append(slider);
  if (saved !== null) {
    // Along the track the thumb's *centre* travels, which is inset by half a
    // thumb at each end — measuring the mark against the full width puts it
    // visibly wide of the thumb at either extreme, which is exactly where the
    // interesting values sit.
    const mark = document.createElement("b");
    mark.className = "anim-saved-mark";
    const fraction = THREE.MathUtils.clamp((saved - min) / (max - min), 0, 1);
    mark.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${fraction})`;
    mark.title = `saved: ${Number(saved.toFixed(3))}`;
    track.append(mark);
  }
  const apply = (next: number) => {
    const clamped = THREE.MathUtils.clamp(next, min, max);
    slider.value = String(clamped);
    number.value = String(Number(clamped.toFixed(3)));
    onChange(clamped);
    afterEdit();
  };
  slider.addEventListener("input", () => apply(Number(slider.value)));
  number.addEventListener("input", () => apply(Number(number.value)));
  // Double-click puts one number back to the mark, which is the other half of
  // being able to push a slider around freely: Revert is all or nothing.
  if (saved !== null) {
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      apply(saved);
    });
  }
  row.append(label, track, number);
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
function beatControls(
  parent: HTMLElement, name: string, beat: Beat, saved: Beat | null,
): void {
  const group = document.createElement("div");
  group.className = "anim-beat";
  const heading = document.createElement("h3");
  heading.textContent = name;
  group.append(heading);
  const names = ["in", "full", "hold", "out"];
  beat.forEach((value, index) => {
    control(group, {
      name: names[index], value, min: 0, max: 1, saved: saved ? saved[index] : null,
      onChange: (next) => {
        beat[index] = next;
        refreshTimelineBands();
      },
    });
  });
  parent.append(group);
}

/** How far a shoulder or an elbow is allowed to be pushed, in radians. */
const ANGLE_LIMIT = 2.4;

/**
 * The saved counterpart of an arm key, matched by its place in the arc.
 *
 * Only while the arc is the same length as the one on disk. Add or drop a key
 * and every index past it means a different pose, so the marks would point at
 * the neighbours of what they claim to be — and a mark that is quietly wrong is
 * worse than one that is missing. They come back on the next save.
 */
function savedArmKey(type: ThrowType, index: number): ThrowArmKey | null {
  const saved = loadedTuning.armKeys[type];
  if (saved.length !== POSE_TUNING.armKeys[type].length) return null;
  return saved[index] ?? null;
}

function armKeyControls(
  parent: HTMLElement, key: ThrowArmKey, keys: ThrowArmKey[], saved: ThrowArmKey | null,
): void {
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
  control(group, {
    name: "at", value: key.at, min: 0.01, max: 0.99, saved: saved ? saved.at : null,
    onChange: (next) => {
      key.at = next;
      keys.sort((a, b) => a.at - b.at);
      jump.textContent = `at ${next.toFixed(2)}`;
      buildTimeline();
    },
  });
  for (const field of ["upperX", "upperY", "upperZ", "lowerX", "handX"] as const) {
    control(group, {
      name: field, value: key[field], min: -ANGLE_LIMIT, max: ANGLE_LIMIT,
      saved: saved ? saved[field] : null,
      onChange: (next) => { key[field] = next; },
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
    "first pair and out over the second. The pale line on every track is what " +
    "that number is in the file — push a slider anywhere and double-click the " +
    "row to put it back.",
  );
  const drive = POSE_TUNING.throwBeats[type];
  for (const name of ["draw", "stride", "whip", "follow"] as const) {
    beatControls(body, name, drive[name], loadedTuning.throwBeats[type][name]);
  }

  if (type === "hurl") {
    const legs = section(
      "hurl · leg beats",
      "The legs keep their own time: a foot has to be off the ground before it " +
      "travels, or it skates.",
    );
    for (const name of ["tuck", "swing", "step", "heel", "drive", "home", "open"] as const) {
      beatControls(legs, name, POSE_TUNING.hurlLegs[name], loadedTuning.hurlLegs[name]);
    }
  }

  const arm = section(
    `${type} · arm arc`,
    "Poses along the arc, not a sum of beats: the shoulder only holds the arm " +
    "above shoulder height through a narrow band, and blending between two " +
    "poses either side of it drops the elbow to the hip on the way past.",
  );
  const keys = POSE_TUNING.armKeys[type];
  keys.forEach((key, index) => armKeyControls(arm, key, keys, savedArmKey(type, index)));
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

  const free = section(
    `${type} · free arm`,
    "The counterweight. Summed from the beats rather than keyed, because it has " +
    "no arc to trace: it lifts, folds across the chest, and is driven down and " +
    "back as the body untwists. Each row is one joint; each slider is how much " +
    "of that beat it takes. Watch the free-arm clearance in the readout — this " +
    "is the arm that goes through the ribs, and a silhouette will not show it.",
  );
  const drives = FREE_ARM_DRIVES[type];
  const freeArm = POSE_TUNING.freeArm[type];
  const savedFreeArm = loadedTuning.freeArm[type];
  for (const joint of ["upperX", "upperZ", "lowerX"] as const) {
    const group = document.createElement("div");
    group.className = "anim-beat";
    const heading = document.createElement("h3");
    heading.textContent = FREE_ARM_LABELS[joint];
    group.append(heading);
    // Only the drives this throw has. A pitch has no aim and a toss has no wind,
    // and a slider that multiplies zero is a slider that lies about doing
    // something.
    for (const drive of drives) {
      control(group, {
        name: drive, value: freeArm[joint][drive],
        min: -ANGLE_LIMIT, max: ANGLE_LIMIT, saved: savedFreeArm[joint][drive],
        onChange: (next) => { freeArm[joint][drive] = next; },
      });
    }
    free.append(group);
  }
  const held = document.createElement("div");
  held.className = "anim-beat";
  const heldHeading = document.createElement("h3");
  heldHeading.textContent = "held";
  held.append(heldHeading);
  control(held, {
    name: "forearm", value: freeArm.lowerZ, min: -ANGLE_LIMIT, max: ANGLE_LIMIT,
    saved: savedFreeArm.lowerZ, onChange: (next) => { freeArm.lowerZ = next; },
  });
  control(held, {
    name: "wrist", value: freeArm.handX, min: -ANGLE_LIMIT, max: ANGLE_LIMIT,
    saved: savedFreeArm.handX, onChange: (next) => { freeArm.handX = next; },
  });
  free.append(held);

  const ready = section(
    "ready pose",
    "What a hurler stands in between throws, which is most of a fight. The " +
    "throwing arm's is both ends of all three arcs as well — one copy, so " +
    "changing throw never jumps it.",
  );
  const throwing = document.createElement("div");
  throwing.className = "anim-beat";
  const throwingHeading = document.createElement("h3");
  throwingHeading.textContent = "throwing arm";
  throwing.append(throwingHeading);
  for (const field of ["upperX", "upperY", "upperZ", "lowerX", "handX"] as const) {
    control(throwing, {
      name: field, value: POSE_TUNING.ready[field], min: -ANGLE_LIMIT, max: ANGLE_LIMIT,
      saved: loadedTuning.ready[field],
      onChange: (next) => { POSE_TUNING.ready[field] = next; },
    });
  }
  ready.append(throwing);
  const readyFree = document.createElement("div");
  readyFree.className = "anim-beat";
  const readyFreeHeading = document.createElement("h3");
  readyFreeHeading.textContent = "free arm";
  readyFree.append(readyFreeHeading);
  for (const field of ["upperX", "upperAim", "upperZ", "lowerX"] as const) {
    control(readyFree, {
      name: field, value: POSE_TUNING.readyArm[field], min: -ANGLE_LIMIT, max: ANGLE_LIMIT,
      saved: loadedTuning.readyArm[field],
      onChange: (next) => { POSE_TUNING.readyArm[field] = next; },
    });
  }
  ready.append(readyFree);
}

/** Which bone each free-arm row drives, in words rather than in axes. */
const FREE_ARM_LABELS: Record<"upperX" | "upperZ" | "lowerX", string> = {
  upperX: "shoulder · up",
  upperZ: "shoulder · across",
  lowerX: "elbow",
};

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
/**
 * Hands the keyboard back to the page. A slider keeps focus after it is dragged,
 * and a focused slider answers the arrow keys itself — so going back to the
 * stage or the timeline has to be what puts the camera and the transport back in
 * charge, or the next arrow press quietly edits the number you just set.
 */
function releaseFocus(): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
}

canvas.addEventListener("pointerdown", releaseFocus);
timeline.addEventListener("pointerdown", (event) => {
  releaseFocus();
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
  restorePoseTuning(loadedTuning);
  buildEditor();
  buildTimeline();
  exportBox.value = serializePoseTuning();
  saveStatus.textContent = "reverted";
  saveStatus.className = "";
});

/**
 * Whether a key belongs to whatever has focus rather than to the page.
 *
 * Only the controls you *type* into get that: a number field and the line
 * picker. A slider must not, and this used to say "any input", which meant that
 * touching one slider killed every shortcut on the page until something else was
 * clicked — the transport keys did nothing, and the arrow keys moved the slider
 * you last touched instead of the camera. Dragging a value and then stepping
 * through the frames it changed is the whole loop this tool is for; it cannot go
 * through a click somewhere else first.
 */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type === "number";
}

window.addEventListener("keydown", (event) => {
  if (isTyping(event.target)) return;
  const current = motion();
  // One frame of this motion at the rate the game plays it, or ten with shift —
  // a frame of a toss is a third of a percent of it, and stepping across the
  // whole motion one of those at a time is not scrubbing.
  const frames = event.shiftKey ? 10 : 1;
  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!playing);
  } else if (event.code === "Comma" || event.code === "Period") {
    event.preventDefault();
    setPlaying(false);
    setPhase(phase + (event.code === "Period" ? frames : -frames) * (FRAME_STEP / current.seconds));
  } else if (event.code === "Home" || event.code === "End") {
    event.preventDefault();
    setPlaying(false);
    setPhase(event.code === "Home" ? 0 : 1);
  } else if (event.code === "BracketLeft" || event.code === "BracketRight") {
    event.preventDefault();
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

/**
 * A way in for a headless check, the way the sim exposes `__simCapture`. The
 * measurements on this page are the ones a pose gets argued from, so something
 * driving a browser has to be able to read them without scraping the panel.
 */
Object.assign(window, {
  __anim: {
    scene,
    get subject() { return subject(); },
    get phase() { return phase; },
    get motion() { return motionKey; },
    freeArmClearance: () => freeArmClearance(subject()),
    tuning: POSE_TUNING,
  },
});

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
