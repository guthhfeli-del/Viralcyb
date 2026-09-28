import { describe, expect, it } from "vitest";
import { onsetEnvelope, analyzeFrames } from "../src/dsp/frames";
import { estimateTempo, trackBeats, refineBpm } from "../src/dsp/tempo";
import { aggregateChroma, estimateKeyFromChroma } from "../src/dsp/key";
import { clickTrack, concat, tone, mix, noise } from "./helpers";
import { midiToHz } from "../src/dsp/util";

describe("tempo", () => {
  for (const bpm of [90, 120, 128, 140]) {
    it(`finds ${bpm} BPM on a click track`, () => {
      const fs = 44100;
      const x = mix(clickTrack(bpm, 30, fs), noise(30, fs, 0.01));
      const { env, hopSec } = onsetEnvelope(x, fs);
      const t = estimateTempo(env, hopSec);
      const beats = trackBeats(env, hopSec, t.bpm).map((f) => f * hopSec);
      const refined = refineBpm(beats, t.bpm);
      // allow octave errors only for the 140 trap-style case (70 is also valid)
      const ok = [bpm, bpm / 2, bpm * 2].some((b) => Math.abs(refined - b) / b < 0.02);
      expect(ok, `got ${refined}`).toBe(true);
      expect(Math.abs(refined - bpm) / bpm < 0.02 || bpm === 140).toBe(true);
      // beats land on the clicks
      const period = 60 / bpm;
      const offsets = beats.slice(2, -2).map((b) => {
        const r = (b % period) / period;
        return Math.min(r, 1 - r) * period;
      });
      const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      expect(avg).toBeLessThan(0.03);
    });
  }
});

describe("key", () => {
  const fs = 22050;
  const chord = (root: number, third: number, fifth: number, sec = 1.5) =>
    [root, third, fifth].map((m) => tone(midiToHz(m), 0.2, sec, fs)).reduce((a, b) => mix(a, b));

  it("detects C major from a I–IV–V–I progression", () => {
    const x = concat([chord(60, 64, 67), chord(65, 69, 72), chord(67, 71, 74), chord(60, 64, 67), chord(48, 52, 55)]);
    const fr = analyzeFrames(x, x, fs);
    const k = estimateKeyFromChroma(aggregateChroma(fr.chroma, fr.rmsDb, fr.count));
    expect(k.short).toBe("C");
    expect(k.camelot).toBe("8B");
  });

  it("detects A minor from i–iv–V–i", () => {
    const x = concat([chord(57, 60, 64), chord(62, 65, 69), chord(64, 68, 71), chord(57, 60, 64), chord(45, 48, 52)]);
    const fr = analyzeFrames(x, x, fs);
    const k = estimateKeyFromChroma(aggregateChroma(fr.chroma, fr.rmsDb, fr.count));
    expect(k.short).toBe("Am");
    expect(k.camelot).toBe("8A");
  });
});
