/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG.
 *
 * The combat director and fighter temperaments both take an injected random
 * function so a sim can replay the same fight from a seed. Nothing about
 * gameplay depends on this being cryptographic.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
