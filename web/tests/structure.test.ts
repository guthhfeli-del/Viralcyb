import { describe, expect, it } from "vitest";
import { eigSym, kmeans } from "../src/dsp/segment";
import { analyzeTrack } from "../src/engine/analyze";
import { withSectionKind } from "../src/engine/edit";
import { synthSong, type SynthSection } from "./song";
import { rng } from "./helpers";

describe("spectral clustering helpers", () => {
  it("diagonalises a symmetric matrix", () => {
    const r = rng(11);
    const n = 24;
    const A = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++)
      for (let j = i; j < n; j++) A[i][j] = A[j][i] = r() * 2 - 1;
    const { values, V } = eigSym(A);
    for (let i = 1; i < n; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    for (let c = 0; c < n; c += 5) {
      // A v = λ v, |v| = 1
      let err = 0, norm = 0;
      for (let i = 0; i < n; i++) {
        let av = 0;
        for (let j = 0; j < n; j++) av += A[i][j] * V[j][c];
        err += (av - values[c] * V[i][c]) ** 2;
        norm += V[i][c] ** 2;
      }
      expect(Math.sqrt(err)).toBeLessThan(1e-9);
      expect(norm).toBeCloseTo(1, 9);
    }
  });

  it("separates well-apart groups with k-means", () => {
    const X = [0, 0.1, 0.2, 5, 5.1, 5.2, 10, 10.1].map((v) => Float64Array.from([v, -v]));
    const lab = kmeans(X, 3);
    expect(lab[0]).toBe(lab[2]);
    expect(lab[3]).toBe(lab[5]);
    expect(lab[6]).toBe(lab[7]);
    expect(new Set([lab[0], lab[3], lab[6]]).size).toBe(3);
  });
});

describe("chorus detection by repetition", () => {
  // verses as loud as the chorus, same chords, different melody each time
  // ("new words"); the chorus melody comes back identically
  const Am = [57, 60, 64], F = [53, 57, 60], C = [48, 52, 55], G = [55, 59, 62];
  const verse = (lead: number[]): SynthSection => ({ kind: "verse", bars: 8, chords: [Am, F, C, G], drums: true, lead, gain: 0.8 });
  const chorus: SynthSection = { kind: "chorus", bars: 8, chords: [F, G, C, Am], drums: true, lead: [72, 76, 74, 72, 76, 79, 76, 74], gain: 0.8 };
  const song: SynthSection[] = [
    { kind: "intro", bars: 4, chords: [Am, F], drums: false, lead: null, gain: 0.4 },
    verse([69, 67, 64, 62, 64, 65, 64, 60, 62, 64, 65, 67, 69, 67, 65, 64]),
    chorus,
    verse([64, 65, 67, 69, 71, 69, 67, 65, 64, 62, 60, 62, 64, 60, 57, 60]),
    chorus,
    verse([60, 64, 67, 64, 62, 65, 69, 65, 64, 67, 71, 67, 65, 62, 59, 62]),
    chorus,
    { kind: "outro", bars: 4, chords: [Am, F], drums: false, lead: null, gain: 0.3 },
  ];
  const fs = 22050;
  const { left, right, truth } = synthSong(120, fs, song);
  const f = analyzeTrack([left, right], fs);
  const overlap = (kind: string, want: string) => {
    const det = f.structure.sections.filter((s) => s.kind === kind);
    const gt = truth.filter((t) => t.kind === want);
    const inter = det.reduce((acc, s) => acc + gt.reduce((a, c) => a + Math.max(0, Math.min(s.end, c.end) - Math.max(s.start, c.start)), 0), 0);
    const detLen = det.reduce((a, s) => a + s.end - s.start, 0);
    return { precision: detLen > 0 ? inter / detLen : 0, recall: inter / gt.reduce((a, c) => a + c.end - c.start, 0) };
  };

  it("labels the repeated melody as the chorus", () => {
    const { precision, recall } = overlap("chorus", "chorus");
    expect(precision).toBeGreaterThan(0.75);
    expect(recall).toBeGreaterThan(0.75);
  });

  it("keeps the verses as verses and puts the hook in a chorus", () => {
    expect(overlap("verse", "verse").recall).toBeGreaterThan(0.6);
    const h = f.structure.hook.start;
    expect(truth.some((t) => t.kind === "chorus" && h >= t.start - 2.1 && h < t.end)).toBe(true);
  });

  it("does not call the instrumental intro a chorus", () => {
    expect(f.structure.sections[0].kind).toBe("intro");
  });

  it("applies a user correction without touching the detection", () => {
    const i = f.structure.sections.findIndex((s) => s.kind === "verse");
    const g = withSectionKind(f, i, "chorus");
    expect(g.structure.sections[i]).toMatchObject({ kind: "chorus", name: "Refrain", edited: true });
    expect(f.structure.sections[i].kind).toBe("verse");
    expect(withSectionKind(f, 0, "verse").structure.introLength).toBe(0);
  });
});
