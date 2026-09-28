import { describe, expect, it } from "vitest";
import { analyzeTrack } from "../src/engine/analyze";
import { scoreVirality } from "../src/engine/virality";
import { buildAdvice } from "../src/engine/advice";
import { DEVICES, deviceReport } from "../src/engine/devices";
import { master, PRESETS } from "../src/dsp/master";
import { noise, sine } from "./helpers";

const fs = 22050;

function fullPipeline(L: Float32Array, R: Float32Array) {
  const f = analyzeTrack([L, R], fs);
  const v = scoreVirality(f, "pop");
  const a = buildAdvice(f, "rap");
  const d = DEVICES.map((x) => deviceReport(f, x, "pop"));
  return { f, v, a, d };
}

describe("robustness on degenerate input", () => {
  it("handles pure silence", () => {
    const z = new Float32Array(fs * 5);
    const { f, v } = fullPipeline(z, z);
    expect(f.loudness.integrated).toBe(-Infinity);
    expect(Number.isFinite(v.score)).toBe(true);
    const p = PRESETS.streaming.settings;
    const m = master([z, z], fs, { ...p, eq: [] });
    expect(m.channels[0].every((x) => x === 0)).toBe(true);
  });

  for (const sec of [0.3, 1, 3]) {
    it(`handles a ${sec} s clip`, () => {
      const x = sine(220, 0.3, sec, fs);
      const { f, v, a } = fullPipeline(x, x);
      expect(f.structure.sections.length).toBeGreaterThanOrEqual(1);
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(a.blueprints.length).toBeGreaterThan(0);
    });
  }

  it("handles noise without a beat or key", () => {
    const l = noise(20, fs, 0.2, 3), r = noise(20, fs, 0.2, 4);
    const { f, v, d } = fullPipeline(l, r);
    expect(f.stereo.correlation).toBeLessThan(0.2);
    expect(Number.isFinite(v.score)).toBe(true);
    expect(d.every((x) => Number.isFinite(x.score))).toBe(true);
  });

  it("handles a mono file passed as a single channel", () => {
    const x = sine(440, 0.3, 4, fs);
    const f = analyzeTrack([x], fs);
    expect(f.stereo.correlation).toBeCloseTo(1, 3);
  });
});
