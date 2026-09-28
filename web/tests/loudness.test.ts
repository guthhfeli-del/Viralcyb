import { describe, expect, it } from "vitest";
import { measureLoudness, truePeakLinear, integratedLoudness } from "../src/dsp/loudness";
import { ampDb } from "../src/dsp/util";
import { sine, concat } from "./helpers";

describe("BS.1770 loudness", () => {
  for (const fs of [44100, 48000]) {
    it(`EBU Tech 3341 case 1: stereo 1 kHz @ -23 dBFS reads -23.0 LUFS (${fs} Hz)`, () => {
      const s = sine(1000, Math.pow(10, -23 / 20), 20, fs);
      const r = measureLoudness([s, s], fs);
      expect(r.integrated).toBeCloseTo(-23, 1);
      expect(Math.abs(r.momentaryMax - -23)).toBeLessThan(0.1);
      expect(Math.abs(r.shortTermMax - -23)).toBeLessThan(0.1);
    });
  }

  it("EBU Tech 3341 case 2: -33 dBFS reads -33.0 LUFS", () => {
    const s = sine(1000, Math.pow(10, -33 / 20), 20, 48000);
    expect(integratedLoudness([s, s], 48000)).toBeCloseTo(-33, 1);
  });

  it("gating: 10 s @ -36 + 60 s @ -23 + 10 s @ -36 reads -23 (EBU case 3 style)", () => {
    const fs = 48000;
    const lo = sine(1000, Math.pow(10, -36 / 20), 10, fs);
    const hi = sine(1000, Math.pow(10, -23 / 20), 60, fs);
    const s = concat([lo, hi, lo]);
    expect(integratedLoudness([s, s], fs)).toBeCloseTo(-23, 1);
  });

  it("silence gates out to -Infinity", () => {
    const s = new Float32Array(48000 * 3);
    expect(integratedLoudness([s, s], 48000)).toBe(-Infinity);
  });

  it("LRA of a stepped signal (-20/-30 LUFS) is ~10 LU", () => {
    const fs = 48000;
    const a = sine(1000, Math.pow(10, -20 / 20), 20, fs);
    const b = sine(1000, Math.pow(10, -30 / 20), 20, fs);
    const s = concat([a, b]);
    const r = measureLoudness([s, s], fs);
    expect(r.lra).toBeGreaterThan(9);
    expect(r.lra).toBeLessThan(11);
  });
});

describe("true peak", () => {
  it("detects inter-sample peaks of a fs/4 sine sampled at 45°", () => {
    const fs = 48000;
    const s = sine(fs / 4, 0.5, 1, fs, Math.PI / 4);
    let sp = 0;
    for (const v of s) sp = Math.max(sp, Math.abs(v));
    expect(ampDb(sp)).toBeLessThan(-8.5); // sample peak ≈ -9.03 dB
    const tp = ampDb(truePeakLinear(s));
    expect(tp).toBeGreaterThan(-6.6);
    expect(tp).toBeLessThan(-5.6); // true peak ≈ -6.02 dB
  });

  it("reports clipping", () => {
    const fs = 44100;
    const s = sine(100, 1.4, 1, fs).map((v) => Math.max(-1, Math.min(1, v)));
    const r = measureLoudness([s, s], fs);
    expect(r.clippedSamples).toBeGreaterThan(100);
  });
});
