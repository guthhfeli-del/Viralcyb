import { describe, expect, it } from "vitest";
import { analyzeTrack } from "../src/engine/analyze";
import { scoreVirality } from "../src/engine/virality";
import { buildAdvice } from "../src/engine/advice";
import { guessGenre } from "../src/engine/genres";
import { synthSong, SONG } from "./song";

describe("virality scoring", () => {
  const fs = 22050;
  const base = synthSong(120, fs);
  const f = analyzeTrack([base.left, base.right], fs);

  it("produces a bounded score with all criteria and levers", () => {
    const v = scoreVirality(f, "pop");
    expect(v.score).toBeGreaterThanOrEqual(0);
    expect(v.score).toBeLessThanOrEqual(100);
    expect(v.criteria).toHaveLength(9);
    for (const c of v.criteria) expect(c.score).toBeGreaterThanOrEqual(0);
    expect(v.levers.length).toBeLessThanOrEqual(3);
  });

  it("rewards putting the hook first", () => {
    const hookFirst = [SONG[2], SONG[1], SONG[2], SONG[3], SONG[4]];
    const late = [SONG[0], SONG[0], SONG[1], SONG[3], SONG[2], SONG[4]];
    const a = synthSong(120, fs, hookFirst);
    const b = synthSong(120, fs, late);
    const fa = analyzeTrack([a.left, a.right], fs);
    const fb = analyzeTrack([b.left, b.right], fs);
    const ta = scoreVirality(fa, "pop").criteria.find((c) => c.id === "hook-timing")!.score;
    const tb = scoreVirality(fb, "pop").criteria.find((c) => c.id === "hook-timing")!.score;
    expect(ta).toBeGreaterThan(tb);
  });

  it("builds advice, blueprints and ideas", () => {
    const adv = buildAdvice(f, "pop");
    expect(adv.blueprints.length).toBeGreaterThanOrEqual(3);
    for (const b of adv.blueprints) expect(b.duration).toBeGreaterThan(60);
    expect(adv.ideas.length).toBeGreaterThan(4);
    expect(["rap", "drill", "pop", "afro", "latin", "rnb", "edm", "rock"]).toContain(guessGenre(f));
  });
});
