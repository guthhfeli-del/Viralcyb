import { describe, expect, it } from "vitest";
import { centerCut } from "../src/dsp/centercut";
import { tone } from "./helpers";
import { pearson } from "../src/dsp/util";

describe("centre extraction", () => {
  it("pulls the centre-panned source out of a stereo mix", () => {
    const fs = 22050;
    const voice = tone(440, 0.3, 3, fs, 8); // centre
    const guitar = tone(330, 0.3, 3, fs, 8); // panned left
    const L = new Float32Array(voice.length), R = new Float32Array(voice.length);
    for (let i = 0; i < L.length; i++) {
      L[i] = voice[i] + 0.95 * guitar[i];
      R[i] = voice[i] + 0.1 * guitar[i];
    }
    const { center, sides } = centerCut(L, R, fs, { lo: 20, hi: 11000 });
    const seg = (x: Float32Array) => x.subarray(fs * 0.5, fs * 2.5);
    expect(pearson(seg(center), seg(voice))).toBeGreaterThan(0.85);
    expect(Math.abs(pearson(seg(center), seg(guitar)))).toBeLessThan(0.3);
    expect(pearson(seg(sides[0]), seg(guitar))).toBeGreaterThan(0.8);
  });
});
