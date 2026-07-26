import { describe, expect, it } from "vitest";
import { STRATEGY_KEYS, keyTones } from "./audio";
import { STRATEGY_LABELS } from "./combat";

// Kept for interface sounds rather than the battlefield; the grid still has to
// be right the day a menu reaches for it.
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

  it("gives every mapped strategy its own key on the pad", () => {
    const mapped = Object.entries(STRATEGY_KEYS);
    // Everything on the pad has to name a real plan; a keypad cannot speak the
    // vocabulary of the fighting if it is keyed to something that never happens.
    for (const [strategy] of mapped) expect(STRATEGY_LABELS).toHaveProperty(strategy);
    const keys = mapped.map(([, key]) => key);
    expect(keys.every((key) => key >= 1 && key <= 9)).toBe(true);
    expect(new Set(keys).size).toBe(mapped.length);
    expect(new Set(keys.map((key) => keyTones(key).join("+"))).size).toBe(mapped.length);
  });

  it("covers the sword plans, which are what a keypad has room for", () => {
    // Nine keys, and the fighting now has ten plans: the hurler's three throws
    // are what a unit does at range, not a menu a player picks from.
    for (const strategy of
      ["rush", "react", "size-up", "feint", "distance-trap", "beat", "riposte"]) {
      expect(STRATEGY_KEYS[strategy]).toBeGreaterThan(0);
    }
    for (const strategy of ["hurl", "pitch", "toss"]) {
      expect(STRATEGY_KEYS[strategy]).toBeUndefined();
    }
  });
});
