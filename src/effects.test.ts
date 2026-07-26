import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { writeTrailColors, writeTrailSample } from "./effects";

const MAX = 4;

function pairAt(positions: Float32Array, sample: number): number[] {
  return Array.from(positions.slice(sample * 6, sample * 6 + 6));
}

function push(positions: Float32Array, samples: number, value: number): number {
  return writeTrailSample(
    positions,
    samples,
    new THREE.Vector3(value, 0, 0),
    new THREE.Vector3(value, 1, 0),
    MAX,
  );
}

describe("writeTrailSample", () => {
  it("pads every unfilled slot with the newest pair", () => {
    const positions = new Float32Array(MAX * 6);
    const samples = push(positions, 0, 7);
    expect(samples).toBe(1);
    // Nothing may be left at the origin, or the strip renders triangles
    // stretching back to world zero.
    for (let sample = 0; sample < MAX; sample += 1) {
      expect(pairAt(positions, sample)).toEqual([7, 0, 0, 7, 1, 0]);
    }
  });

  it("keeps the oldest sample first while filling", () => {
    const positions = new Float32Array(MAX * 6);
    let samples = 0;
    for (const value of [1, 2, 3]) samples = push(positions, samples, value);
    expect(samples).toBe(3);
    expect(pairAt(positions, 0)[0]).toBe(1);
    expect(pairAt(positions, 1)[0]).toBe(2);
    expect(pairAt(positions, 2)[0]).toBe(3);
    expect(pairAt(positions, 3)[0]).toBe(3);
  });

  it("drops the oldest pair once the ribbon is full", () => {
    const positions = new Float32Array(MAX * 6);
    let samples = 0;
    for (const value of [1, 2, 3, 4, 5, 6]) samples = push(positions, samples, value);
    expect(samples).toBe(MAX);
    expect([0, 1, 2, 3].map((sample) => pairAt(positions, sample)[0])).toEqual([3, 4, 5, 6]);
  });

  it("never exceeds the buffer regardless of how long a swing runs", () => {
    const positions = new Float32Array(MAX * 6);
    let samples = 0;
    for (let index = 0; index < 200; index += 1) samples = push(positions, samples, index);
    expect(samples).toBe(MAX);
    expect(pairAt(positions, MAX - 1)[0]).toBe(199);
  });
});

describe("writeTrailColors", () => {
  it("fades the tail to nothing and leaves the newest sample at full accent", () => {
    const colors = new Float32Array(MAX * 6);
    writeTrailColors(colors, new THREE.Color(1, 1, 1), MAX);
    expect(colors[3]).toBe(0);
    expect(colors[(MAX - 1) * 6 + 3]).toBeCloseTo(1);
  });

  it("keeps the hilt edge dimmer than the tip edge", () => {
    const colors = new Float32Array(MAX * 6);
    writeTrailColors(colors, new THREE.Color(1, 1, 1), MAX);
    const newest = (MAX - 1) * 6;
    expect(colors[newest]).toBeLessThan(colors[newest + 3]);
  });
});
