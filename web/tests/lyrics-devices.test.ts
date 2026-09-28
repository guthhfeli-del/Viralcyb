import { describe, expect, it } from "vitest";
import { analyzeLyrics, countSyllables, rhymeKey, detectLanguage } from "../src/engine/lyrics";
import { DEVICES, deviceReport } from "../src/engine/devices";
import { analyzeTrack } from "../src/engine/analyze";
import { synthSong } from "./song";

const FR = `[Couplet 1]
Je marche seul dans la nuit
Les lumières de la ville brillent aussi
J'ai laissé mes doutes derrière moi
Et je repense encore à toi

[Refrain]
Dis-moi que tu restes ce soir
Dis-moi que tu restes ce soir
On danse jusqu'au matin sans savoir
Dis-moi que tu restes ce soir`;

describe("lyrics", () => {
  it("detects French and counts syllables sensibly", () => {
    expect(detectLanguage(FR)).toBe("fr");
    expect(countSyllables("Dis-moi que tu restes ce soir", "fr")).toBeGreaterThanOrEqual(7);
    expect(countSyllables("Dis-moi que tu restes ce soir", "fr")).toBeLessThanOrEqual(9);
    expect(countSyllables("I can't stop loving you", "en")).toBe(6);
  });

  it("matches French rhymes", () => {
    expect(rhymeKey("dans la nuit", "fr")).toBe(rhymeKey("brillent aussi", "fr"));
    expect(rhymeKey("ce soir", "fr")).toBe(rhymeKey("sans savoir", "fr"));
  });

  it("finds the hook and builds restructures", () => {
    const r = analyzeLyrics(FR, { title: "Dis-moi", bpm: 100, durationSec: 60 });
    expect(r.hookCandidates[0].text).toBe("Dis-moi que tu restes ce soir");
    expect(r.repeatedLines[0].count).toBe(3);
    expect(r.titleDrops).toBe(3);
    expect(r.sections.map((s) => s.name)).toEqual(["Couplet 1", "Refrain"]);
    expect(r.restructures.length).toBe(4);
    expect(r.rhymeDensity).toBeGreaterThan(0.5);
    expect(r.signaturePhrases.some((p) => p.text.includes("dis moi que tu restes"))).toBe(true);
  });
});

describe("device translation", () => {
  const fs = 22050;
  const s = synthSong(120, fs);
  const f = analyzeTrack([s.left, s.right], fs);
  it("scores every device between 0 and 100 with notes", () => {
    for (const d of DEVICES) {
      const r = deviceReport(f, d, "pop");
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });
});
