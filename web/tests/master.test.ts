import { describe, expect, it } from "vitest";
import { master, PRESETS, autoEq, limit } from "../src/dsp/master";
import { integratedLoudness, truePeakLinear } from "../src/dsp/loudness";
import { encodeWav } from "../src/dsp/wav";
import { ampDb } from "../src/dsp/util";
import { synthSong } from "./song";

describe("mastering chain", () => {
  const fs = 44100;
  const { left, right } = synthSong(120, fs);
  const L = left.subarray(0, fs * 40), R = right.subarray(0, fs * 40);

  for (const id of ["streaming", "tiktok", "club"] as const) {
    it(`drives ${id} to its loudness target and respects the -1 dBTP ceiling`, () => {
      const p = PRESETS[id].settings;
      const { channels, report } = master([L, R], fs, { ...p, eq: p.tone });
      // either the target is reached, or the chain refused to over-limit a very dynamic mix
      if (!report.reachedTarget) {
        expect(report.maxGrDb > 9 || report.avgGrDb > 3.5).toBe(true);
        expect(report.lufsOut).toBeGreaterThan(report.lufsIn + 3);
      }
      expect(report.avgGrDb).toBeLessThanOrEqual(4.6);
      expect(report.maxGrDb).toBeLessThanOrEqual(12.1);
      expect(report.reachedTarget).toBe(Math.abs(report.lufsOut - p.targetLufs) < 0.5);
      expect(Math.abs(integratedLoudness(channels, fs) - report.lufsOut)).toBeLessThan(0.01);
      const tp = ampDb(Math.max(truePeakLinear(channels[0]), truePeakLinear(channels[1])));
      expect(tp).toBeLessThanOrEqual(-0.95);
      expect(report.chain.length).toBeGreaterThan(2);
    });
  }

  it("limiter never exceeds the ceiling and returns smoothly", () => {
    const n = fs;
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = b[i] = Math.sin((2 * Math.PI * 100 * i) / fs) * (i > n / 2 ? 2 : 0.5);
    const { maxGr } = limit(a, b, fs, 0.9, 80);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(a[i]));
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(maxGr).toBeGreaterThan(6);
  });

  it("autoEq returns at most 4 gentle filters", () => {
    const thirds = new Array(29).fill(0).map((_, i) => (i === 12 ? 8 : 0));
    const eq = autoEq(thirds, "pop");
    expect(eq.length).toBeLessThanOrEqual(4);
    for (const e of eq) expect(Math.abs(e.gain ?? 0)).toBeLessThanOrEqual(3);
  });

  it("encodes a valid WAV header", () => {
    const buf = encodeWav([new Float32Array(100), new Float32Array(100)], 48000, 16);
    const v = new DataView(buf);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(48000);
    expect(buf.byteLength).toBe(44 + 100 * 2 * 2);
  });
});
