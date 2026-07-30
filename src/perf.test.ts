import { describe, expect, it } from "vitest";
import { PERF_PATHS, PerfMonitor } from "./perf";

/**
 * The clock is injected, so a frame here is whatever this file says it is and
 * no test has to wait for one.
 */
function stepped(): { advance: (ms: number) => void; monitor: PerfMonitor } {
  let stamp = 0;
  const monitor = new PerfMonitor(() => stamp);
  return { advance: (ms) => { stamp += ms; }, monitor };
}

/** Runs `frames` frames, each costing `cost` ms on `path` out of `frameMs`. */
function run(
  monitor: PerfMonitor,
  advance: (ms: number) => void,
  frames: number,
  frameMs: number,
  cost: number,
  path: (typeof PERF_PATHS)[number] = "ai",
): void {
  for (let index = 0; index < frames; index += 1) {
    monitor.measure(path, () => advance(cost));
    advance(frameMs - cost);
    monitor.endFrame();
  }
}

describe("PerfMonitor", () => {
  it("reports nothing until it has seen a frame interval", () => {
    const { monitor, advance } = stepped();
    monitor.measure("render", () => advance(4));
    monitor.endFrame();
    const sample = monitor.read();
    expect(sample.fps).toBe(0);
    expect(sample.cpuMilliseconds).toBe(0);
  });

  it("settles on the frame rate and the share each path costs", () => {
    const { monitor, advance } = stepped();
    // 5 ms of work in a 20 ms frame: 50 fps, a quarter of the frame.
    run(monitor, advance, 400, 20, 5, "physics");

    const sample = monitor.read();
    expect(sample.fps).toBeCloseTo(50, 1);
    expect(sample.frameMilliseconds).toBeCloseTo(20, 1);
    expect(sample.cpuMilliseconds).toBeCloseTo(5, 1);
    expect(sample.cpuShare).toBeCloseTo(0.25, 2);

    const physics = sample.paths.find((entry) => entry.path === "physics")!;
    expect(physics.milliseconds).toBeCloseTo(5, 1);
    expect(physics.share).toBeCloseTo(0.25, 2);
    // What the frame was not spent on has to read as zero, or a share is
    // meaningless.
    for (const entry of sample.paths) {
      if (entry.path !== "physics") expect(entry.milliseconds).toBeCloseTo(0, 3);
    }
  });

  it("adds up a path measured more than once in a frame", () => {
    const { monitor, advance } = stepped();
    for (let index = 0; index < 400; index += 1) {
      monitor.measure("fx", () => advance(2));
      monitor.measure("ai", () => advance(1));
      monitor.measure("fx", () => advance(3));
      advance(10);
      monitor.endFrame();
    }
    const sample = monitor.read();
    // Split across two calls with something else between them, `fx` is still
    // one path costing five milliseconds rather than whichever half was last.
    expect(sample.paths.find((entry) => entry.path === "fx")!.milliseconds)
      .toBeCloseTo(5, 1);
    expect(sample.paths.find((entry) => entry.path === "ai")!.milliseconds)
      .toBeCloseTo(1, 1);
  });

  it("charges a path that throws before the error leaves it", () => {
    const { monitor, advance } = stepped();
    expect(() => monitor.measure("render", () => {
      advance(6);
      throw new Error("draw failed");
    })).toThrow("draw failed");
    advance(10);
    monitor.endFrame();
    // The first frame is dropped for want of an interval; the point is that the
    // cost was banked rather than lost with the stack.
    run(monitor, advance, 200, 16, 6, "render");
    expect(monitor.read().paths.find((entry) => entry.path === "render")!.milliseconds)
      .toBeCloseTo(6, 1);
  });

  it("throws away a stall rather than averaging it in", () => {
    const { monitor, advance } = stepped();
    run(monitor, advance, 400, 16, 4);
    const before = monitor.read().fps;

    // A backgrounded tab, a breakpoint, or the sim's headless burst.
    monitor.measure("ai", () => advance(3000));
    advance(1000);
    monitor.endFrame();

    expect(monitor.read().fps).toBeCloseTo(before, 1);
    // And the stalled frame's cost went with it, rather than landing on the
    // next frame that does have an interval.
    monitor.measure("ai", () => advance(4));
    advance(12);
    monitor.endFrame();
    expect(monitor.read().paths.find((entry) => entry.path === "ai")!.milliseconds)
      .toBeLessThan(5);
  });

  it("tracks a frame that gets more expensive", () => {
    const { monitor, advance } = stepped();
    run(monitor, advance, 400, 16, 2, "ai");
    expect(monitor.read().paths.find((entry) => entry.path === "ai")!.milliseconds)
      .toBeCloseTo(2, 1);

    // Half a second of smoothing: a second of the new cost is most of the way
    // there, which is the responsiveness the panel is tuned for.
    run(monitor, advance, 60, 16, 9, "ai");
    expect(monitor.read().paths.find((entry) => entry.path === "ai")!.milliseconds)
      .toBeGreaterThan(7.5);
    // And a few more time constants sit on it.
    run(monitor, advance, 200, 16, 9, "ai");
    expect(monitor.read().paths.find((entry) => entry.path === "ai")!.milliseconds)
      .toBeCloseTo(9, 1);
  });

  it("forgets everything on reset", () => {
    const { monitor, advance } = stepped();
    run(monitor, advance, 400, 16, 4);
    monitor.reset();
    const sample = monitor.read();
    expect(sample.fps).toBe(0);
    expect(sample.frameMilliseconds).toBe(0);
    for (const entry of sample.paths) expect(entry.milliseconds).toBe(0);
  });
});
