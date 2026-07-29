/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
// The file as it is checked in, so the serializer can be held against it. Read
// through the bundler rather than `node:fs`, which the browser build has no
// types for.
import source from "./pose-tuning.ts?raw";
import {
  POSE_TUNING,
  TUNING_MARKER,
  serializePoseTuning,
  type PoseTuning,
} from "./pose-tuning";

describe("pose tuning", () => {
  /**
   * The animation tool saves by replacing everything from the marker to the end
   * of this file with `serializePoseTuning`. If the two ever disagree about
   * shape, a save with nothing edited would rewrite the file — so this pins that
   * the serializer emits exactly what is checked in.
   */
  it("serializes to the source it was loaded from", () => {
    expect(source.slice(source.lastIndexOf(TUNING_MARKER))).toBe(serializePoseTuning());
  });

  it("declares the marker exactly twice: the constant, and the marker itself", () => {
    expect(source.split(TUNING_MARKER).length - 1).toBe(2);
  });

  /**
   * The three throws share one ready pose, and the arc's ends are read from it
   * rather than stored. A key at phase 0 or 1 would shadow that and let one
   * throw's ready pose drift from another's, which jumps the arm the moment a
   * hurler changes throw for a new gap.
   */
  it("keeps every arm key strictly inside the arc, in order", () => {
    for (const keys of Object.values(POSE_TUNING.armKeys)) {
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key.at).toBeGreaterThan(0);
        expect(key.at).toBeLessThan(1);
      }
      for (let index = 1; index < keys.length; index += 1) {
        expect(keys[index].at).toBeGreaterThan(keys[index - 1].at);
      }
    }
    expect(POSE_TUNING.ready.at).toBe(0);
  });

  /** A beat fades in before it fades out, or `beat()` returns nonsense for it. */
  it("keeps every beat monotonic", () => {
    const beats = [
      ...Object.values(POSE_TUNING.throwBeats).flatMap((drive) => Object.values(drive)),
      ...Object.values(POSE_TUNING.hurlLegs),
    ];
    for (const [inStart, inEnd, outStart, outEnd] of beats) {
      expect(inStart).toBeLessThanOrEqual(inEnd);
      expect(inEnd).toBeLessThanOrEqual(outStart);
      expect(outStart).toBeLessThanOrEqual(outEnd);
    }
  });

  it("round-trips numbers a slider has nudged", () => {
    const nudged: PoseTuning = structuredClone(POSE_TUNING);
    nudged.hurlLegs.step[0] = 0.1 + 0.2;
    expect(serializePoseTuning(nudged)).toContain("step: [0.3, 0.46, 0.74, 1]");
  });
});
