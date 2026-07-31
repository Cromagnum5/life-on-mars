/**
 * Where a frame goes, in milliseconds and in fractions of the frame it had.
 *
 * The point of this file is to make a slow frame answerable rather than
 * arguable. A frame is carved into a handful of named paths, each one timed
 * around the call that owns it, and what is left over is the browser's — vsync
 * waits, compositing, garbage collection, page layout. So a path reading 4 ms
 * at 15% is a path that costs 4 ms out of a 27 ms frame, not 4 ms out of the
 * 16.7 ms budget somebody was hoping for.
 *
 * Two rules this is built around:
 *
 * - **Wall clock, not sim time.** The sim's speed slider and its pause button
 *   scale the delta the fight is stepped by, and neither of them makes a frame
 *   cheaper. FPS and every share here are measured against real elapsed time.
 * - **Nothing here may reach the fight.** `performance.now()` is the wall clock
 *   and no unit may ever move by it — the seeded fights depend on that. This
 *   module only reads it, and hands the number to the HUD.
 */

/**
 * The paths a frame is carved into, in the order they are reported. They are
 * meant to be exhaustive over the work this project controls; anything not
 * named here shows up in the leftover.
 */
export const PERF_PATHS = ["ai", "physics", "fx", "render", "hud"] as const;

export type PerfPath = (typeof PERF_PATHS)[number];

/** What each path is, for the HUD and for anyone reading a number off it. */
export const PERF_PATH_LABELS: Record<PerfPath, string> = {
  ai: "ai",
  physics: "physics",
  fx: "fx",
  render: "render",
  hud: "hud",
};

export type PerfPathSample = {
  path: PerfPath;
  /** Milliseconds of CPU this path costs in a recent average frame. */
  milliseconds: number;
  /** That cost over the wall-clock frame interval. */
  share: number;
};

export type PerfSample = {
  /** Frames a second, from the wall clock. */
  fps: number;
  /** Wall-clock milliseconds between frames. */
  frameMilliseconds: number;
  /** Everything the timed paths add up to. */
  cpuMilliseconds: number;
  /** That total over the frame interval; the rest is the browser's. */
  cpuShare: number;
  paths: readonly PerfPathSample[];
};

/**
 * How long an average is worth remembering. Short enough that walking the
 * camera into a crowd shows up while it is happening, long enough that the
 * numbers can be read rather than watched flickering.
 */
const SMOOTHING_SECONDS = 0.5;
/**
 * The longest gap that counts as a frame. A tab left in the background, a
 * breakpoint, or the sim's headless burst all produce intervals of seconds,
 * and averaging those in leaves the readout wrong long after the stall.
 */
const MAX_FRAME_SECONDS = 0.5;

function emptyCosts(): Record<PerfPath, number> {
  return { ai: 0, physics: 0, fx: 0, render: 0, hud: 0 };
}

/**
 * Times named paths and reports a smoothed frame.
 *
 * Costs accumulate, so a path split across two loops — the unit update and the
 * blade sampling that has to follow it — is timed as one path rather than
 * whichever half was measured last.
 */
export class PerfMonitor {
  /** This frame's accumulated cost per path. */
  private readonly costs = emptyCosts();
  /** The smoothed cost per path, in milliseconds. */
  private readonly averages = emptyCosts();
  private smoothedFrameMs = 0;
  private lastFrameStamp: number | null = null;
  private readonly samples: PerfPathSample[] = PERF_PATHS.map((path) => ({
    path, milliseconds: 0, share: 0,
  }));
  private readonly sample: PerfSample = {
    fps: 0, frameMilliseconds: 0, cpuMilliseconds: 0, cpuShare: 0, paths: this.samples,
  };

  /** Injected so the smoothing can be tested without waiting for real frames. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * Runs `work`, charging what it costs to `path`, and returns whatever it
   * returned. A callback rather than a begin/end pair because a mismatched pair
   * misattributes silently, and a profiler that lies is worse than none.
   */
  measure<T>(path: PerfPath, work: () => T): T {
    const started = this.now();
    try {
      return work();
    } finally {
      this.costs[path] += this.now() - started;
    }
  }

  /**
   * Closes the frame and folds it into the averages. Called once per frame,
   * last, so the interval it measures is the whole frame including whatever the
   * browser did between them.
   */
  endFrame(): void {
    const stamp = this.now();
    const previous = this.lastFrameStamp;
    this.lastFrameStamp = stamp;
    // The first frame has nothing to be an interval from, and a stall is not a
    // frame. Either way the costs are dropped rather than averaged in.
    const frameSeconds = previous === null ? 0 : (stamp - previous) / 1000;
    if (frameSeconds <= 0 || frameSeconds > MAX_FRAME_SECONDS) {
      Object.assign(this.costs, emptyCosts());
      return;
    }

    const alpha = 1 - Math.exp(-frameSeconds / SMOOTHING_SECONDS);
    this.smoothedFrameMs += (frameSeconds * 1000 - this.smoothedFrameMs) * alpha;
    for (const path of PERF_PATHS) {
      this.averages[path] += (this.costs[path] - this.averages[path]) * alpha;
      this.costs[path] = 0;
    }
  }

  /**
   * The current reading. The returned object is reused between calls, so read
   * it or copy it; do not hold it and expect it to keep saying this.
   */
  read(): PerfSample {
    const frameMs = this.smoothedFrameMs;
    let cpu = 0;
    for (const [index, path] of PERF_PATHS.entries()) {
      const milliseconds = this.averages[path];
      cpu += milliseconds;
      this.samples[index].milliseconds = milliseconds;
      this.samples[index].share = frameMs > 0 ? milliseconds / frameMs : 0;
    }
    this.sample.fps = frameMs > 0 ? 1000 / frameMs : 0;
    this.sample.frameMilliseconds = frameMs;
    this.sample.cpuMilliseconds = cpu;
    this.sample.cpuShare = frameMs > 0 ? cpu / frameMs : 0;
    return this.sample;
  }

  /** Forgets everything, for a restart that should not carry its old average. */
  reset(): void {
    Object.assign(this.costs, emptyCosts());
    Object.assign(this.averages, emptyCosts());
    this.smoothedFrameMs = 0;
    this.lastFrameStamp = null;
  }
}

/**
 * A HUD panel over a `PerfMonitor`.
 *
 * Updated on its own slow clock rather than every frame, for the obvious
 * reason: a readout that rewrites six rows of text sixty times a second is
 * itself a measurable share of the frame it claims to be reporting on. Ten
 * updates a second is faster than the eye wants and cheap enough to ignore.
 */
/**
 * What the renderer was asked to draw. Read off `WebGLRenderer.info.render`,
 * but taken as a plain pair so this module stays free of three.js and goes on
 * being testable without a GL context.
 *
 * It earns its row because the count of *things* is what a frame is spent on
 * long before the count of triangles is: a Rigwalker is thirty-three separate
 * meshes carrying nine hundred and sixty triangles between them, so an army is
 * thousands of draws for a hundred thousand triangles, and only one of those
 * two numbers explains the frame.
 */
export type DrawCount = {
  calls: number;
  triangles: number;
};

export class PerfReadout {
  private readonly rows = new Map<PerfPath, HTMLElement>();
  private readonly fpsValue: HTMLElement;
  private readonly unitValue: HTMLElement;
  private readonly drawValue: HTMLElement;
  private readonly frameValue: HTMLElement;
  private nextUpdate = 0;

  /**
   * @param host   an empty element to fill; it is given the `perf` class.
   * @param period how often the text is rewritten, in seconds.
   */
  constructor(private readonly host: HTMLElement, private readonly period = 0.1) {
    host.classList.add("perf");
    this.fpsValue = this.addRow("fps");
    this.unitValue = this.addRow("units");
    this.drawValue = this.addRow("draws");
    this.frameValue = this.addRow("frame");
    for (const path of PERF_PATHS) {
      this.rows.set(path, this.addRow(PERF_PATH_LABELS[path], "perf-path"));
    }
  }

  private addRow(label: string, className = ""): HTMLElement {
    const row = document.createElement("div");
    row.className = `perf-row ${className}`.trim();
    const name = document.createElement("span");
    name.className = "perf-name";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "perf-value";
    value.textContent = "—";
    row.append(name, value);
    this.host.append(row);
    return value;
  }

  /**
   * Rewrites the panel if enough wall time has passed. `delta` is wall-clock
   * seconds, not sim seconds, so pausing the sim does not freeze the readout of
   * a renderer that is still drawing every frame.
   */
  update(
    delta: number,
    monitor: PerfMonitor,
    unitCount: number,
    draws?: DrawCount,
  ): void {
    this.nextUpdate -= delta;
    if (this.nextUpdate > 0) return;
    this.nextUpdate = this.period;

    const sample = monitor.read();
    this.fpsValue.textContent = sample.fps.toFixed(0);
    this.unitValue.textContent = String(unitCount);
    this.drawValue.textContent = draws
      ? `${draws.calls} · ${(draws.triangles / 1000).toFixed(0)}k tri`
      : "—";
    this.frameValue.textContent = `${sample.frameMilliseconds.toFixed(1)} ms · ` +
      `${(sample.cpuShare * 100).toFixed(0)}%`;
    for (const entry of sample.paths) {
      const row = this.rows.get(entry.path);
      if (row) {
        row.textContent = `${entry.milliseconds.toFixed(2)} ms · ` +
          `${(entry.share * 100).toFixed(0)}%`;
      }
    }
  }
}
