import { describe, expect, it } from "vitest";
import { STRATEGY_KEYS, keyTones } from "./audio";
import { STRATEGY_LABELS } from "./combat";

describe("keypad tones", () => {
  it("matches the touch-tone frequency pairs", () => {
    // The published DTMF grid. A keypad tone only sounds right if both
    // partials come from the real row and column groups.
    expect(keyTones(1)).toEqual([697, 1209]);
    expect(keyTones(2)).toEqual([697, 1336]);
    expect(keyTones(3)).toEqual([697, 1477]);
    expect(keyTones(4)).toEqual([770, 1209]);
    expect(keyTones(5)).toEqual([770, 1336]);
    expect(keyTones(6)).toEqual([770, 1477]);
    expect(keyTones(7)).toEqual([852, 1209]);
  });

  it("gives every strategy its own key", () => {
    const strategies = Object.keys(STRATEGY_LABELS);
    const keys = strategies.map((strategy) => STRATEGY_KEYS[strategy]);
    expect(keys.every((key) => key >= 1 && key <= 9)).toBe(true);
    expect(new Set(keys).size).toBe(strategies.length);
    expect(new Set(keys.map((key) => keyTones(key).join("+"))).size)
      .toBe(strategies.length);
  });
});
