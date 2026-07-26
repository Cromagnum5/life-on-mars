import { describe, expect, it } from "vitest";
import { BalanceController, MARS_GRAVITY } from "./balance";

describe("BalanceController", () => {
  it("uses Martian surface gravity", () => {
    expect(MARS_GRAVITY).toBeCloseTo(3.71);
  });

  it("leans into acceleration and settles after stopping", () => {
    const controller = new BalanceController();
    let pose = controller.update({ delta: 1 / 60, localVelocityX: 3, localVelocityZ: 0 });
    for (let index = 0; index < 20; index += 1) {
      pose = controller.update({ delta: 1 / 60, localVelocityX: 3, localVelocityZ: 0 });
    }
    expect(pose.leanX).toBeGreaterThan(0);
    for (let index = 0; index < 180; index += 1) {
      pose = controller.update({ delta: 1 / 60, localVelocityX: 0, localVelocityZ: 0 });
    }
    expect(Math.abs(pose.leanX)).toBeLessThan(0.02);
    expect(pose.stepSide).toBe(0);
  });

  it("widens its stance and takes a recovery step after an impact", () => {
    const controller = new BalanceController();
    let widestStance = 0;
    let sawStep = false;
    for (let index = 0; index < 90; index += 1) {
      const pose = controller.update({
        delta: 1 / 60,
        localVelocityX: 0,
        localVelocityZ: 0,
        impactX: index === 0 ? 0.34 : 0,
      });
      widestStance = Math.max(widestStance, pose.stance);
      sawStep ||= pose.stepSide !== 0;
    }
    expect(sawStep).toBe(true);
    expect(widestStance).toBeGreaterThan(0.08);
  });
});
