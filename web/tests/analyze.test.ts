import { describe, expect, it } from "vitest";
import { analyzeTrack } from "../src/engine/analyze";
import { synthSong } from "./song";

describe("end-to-end analysis on a synthetic song", () => {
  const fs = 22050;
  const { left, right, truth } = synthSong(120, fs);
  const f = analyzeTrack([left, right], fs);

  it("measures tempo and key", () => {
    expect(Math.abs(f.rhythm.bpm - 120)).toBeLessThan(2);
    expect(["Am", "C"]).toContain(f.key.short);
  });

  it("finds sections close to the ground truth boundaries", () => {
    const bounds = f.structure.sections.map((s) => s.start).slice(1);
    const truthBounds = truth.map((t) => t.start).slice(1);
    const hits = truthBounds.filter((tb) => bounds.some((b) => Math.abs(b - tb) <= 2.1)).length;
    expect(hits / truthBounds.length).toBeGreaterThanOrEqual(0.6);
  });

  it("labels the loud repeated section as the chorus and places the hook in it", () => {
    const choruses = truth.filter((t) => t.kind === "chorus");
    const h = f.structure.hook.start;
    expect(choruses.some((c) => h >= c.start - 2.1 && h < c.end)).toBe(true);
    const detected = f.structure.sections.filter((s) => s.kind === "chorus");
    const overlap = detected.reduce((acc, s) => acc + choruses.reduce((a, c) => a + Math.max(0, Math.min(s.end, c.end) - Math.max(s.start, c.start)), 0), 0);
    const detectedLen = detected.reduce((a, s) => a + s.end - s.start, 0);
    expect(overlap / detectedLen).toBeGreaterThan(0.6);
    expect(f.structure.hook.occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("detects the intro and a chorus lift", () => {
    expect(f.structure.sections[0].kind).toBe("intro");
    expect(Math.abs(f.structure.introLength - 8)).toBeLessThanOrEqual(2.1);
    expect(f.structure.chorusLift).toBeGreaterThan(2);
  });

  it("suggests a bar-aligned TikTok clip of 11–17.5 s", () => {
    const c = f.structure.clips.tiktok;
    expect(c.end - c.start).toBeGreaterThanOrEqual(11);
    expect(c.end - c.start).toBeLessThanOrEqual(17.5);
  });
});
