/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
// The file as it is checked in, so the serializer can be held against it. Read
// through the bundler rather than `node:fs`, which the browser build has no
// types for.
import source from "./pose-tuning.ts?raw";
import {
  POSE_TUNING,
  TUNING_MARKER,
  restorePoseTuning,
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

  /**
   * The tool's **Revert**. This is written against *every* key rather than the
   * ones that existed when it was written, because the version that named them
   * shipped broken the day the free arm arrived: reverting restored the beats
   * and the arm arc and quietly left the free arm edited.
   */
  it("restores every field, including ones added after the restore was written", () => {
    const original = structuredClone(POSE_TUNING);
    const target = structuredClone(POSE_TUNING);
    // Scribble on all of it, one leaf per top-level key, so a key the restore
    // forgets cannot come back looking untouched.
    target.ready.upperX = 9;
    target.throwBeats.hurl.draw[0] = 9;
    target.armKeys.pitch[0].at = 0.99;
    target.freeArm.toss.upperX.base = 9;
    target.freeArm.hurl.handX = 9;
    target.readyArm.upperZ = 9;
    target.hurlLegs.tuck[3] = 0.99;
    for (const key of Object.keys(original) as Array<keyof PoseTuning>) {
      expect(target[key], `nothing was changed under ${key}`).not.toEqual(original[key]);
    }

    restorePoseTuning(original, target);
    expect(target).toEqual(original);
  });

  it("hands the restore its own copy, so the next edit cannot reach it", () => {
    const held = structuredClone(POSE_TUNING);
    const target = structuredClone(POSE_TUNING);
    restorePoseTuning(held, target);
    target.freeArm.hurl.upperX.whip = 9;
    expect(held.freeArm.hurl.upperX.whip).not.toBe(9);
  });

  it("round-trips numbers a slider has nudged", () => {
    const nudged: PoseTuning = structuredClone(POSE_TUNING);
    nudged.hurlLegs.step[0] = 0.1 + 0.2;
    expect(serializePoseTuning(nudged)).toContain("step: [0.3, 0.46, 0.74, 1]");
  });
});
