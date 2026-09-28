import { describe, expect, it } from "vitest";
import { Yin, pitchTrack } from "../src/dsp/pitch";
import { segmentNotes, keyFromNotes, predictNext, quantizeToKey, type NoteEvent } from "../src/dsp/topline";
import { notesToMidi } from "../src/dsp/midi";
import { concat, tone, noise, mix } from "./helpers";
import { hzToMidi, midiToHz } from "../src/dsp/util";

describe("YIN pitch", () => {
  for (const f of [110, 220, 330.5, 440, 880]) {
    it(`tracks ${f} Hz within 10 cents`, () => {
      const fs = 16000;
      const yin = new Yin(fs);
      const x = tone(f, 0.3, 0.2, fs, 5);
      const r = yin.detect(x.subarray(400, 400 + 640 + yin.tauMax));
      expect(Math.abs(1200 * Math.log2(r.freq / f))).toBeLessThan(10);
      expect(r.clarity).toBeGreaterThan(0.8);
    });
  }
  it("reports noise as unvoiced", () => {
    const yin = new Yin(16000);
    const r = yin.detect(noise(0.1, 16000, 0.3));
    expect(r.freq === 0 || r.clarity < 0.5).toBe(true);
  });
});

describe("topline transcription", () => {
  const fs = 44100;
  const melody = [60, 62, 64, 65, 67, 67, 65, 64];
  const audio = concat(melody.map((m) => concat([tone(midiToHz(m), 0.3, 0.3, fs, 6), new Float32Array(Math.round(0.05 * fs))])));

  it("recovers the sung melody", () => {
    const tr = pitchTrack(mix(audio, noise(audio.length / fs, fs, 0.003)), fs);
    const pts = tr.times.map((t, i) => ({ t, freq: tr.freqs[i], clarity: tr.clarity[i], rms: tr.rms[i] }));
    const notes = segmentNotes(pts);
    expect(notes.map((n) => n.midi)).toEqual(melody);
    const k = keyFromNotes(notes);
    expect(k).not.toBeNull();
    expect(["C", "F", "Am", "G"]).toContain(k!.short);
  });

  it("predicts in-key, mostly stepwise continuations and learns motifs", () => {
    const seq = [60, 62, 64, 60, 62, 64, 60, 62];
    const notes: NoteEvent[] = seq.map((m, i) => ({ midi: m, cents: 0, start: i * 0.4, end: i * 0.4 + 0.3, velocity: 90 }));
    const key = keyFromNotes([...notes, { midi: 65, cents: 0, start: 4, end: 4.3, velocity: 80 }, { midi: 67, cents: 0, start: 4.4, end: 4.7, velocity: 80 }]);
    const pred = predictNext(notes, key, 3);
    expect(pred[0].midi).toBe(64); // motif 60-62 → 64
    expect(pred.reduce((a, p) => a + p.p, 0)).toBeLessThanOrEqual(1.0001);
  });

  it("quantizes out-of-key notes", () => {
    const key = keyFromNotes([60, 62, 64, 65, 67, 69, 71, 72].map((m, i) => ({ midi: m, cents: 0, start: i, end: i + 0.5, velocity: 80 })))!;
    const q = quantizeToKey([{ midi: 61, cents: 30, start: 0, end: 1, velocity: 80 }], key);
    expect([60, 62]).toContain(q[0].midi);
  });

  it("writes a MIDI file", () => {
    const bytes = notesToMidi([{ midi: 60, cents: 0, start: 0, end: 0.5, velocity: 100 }], 120);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
    expect(bytes.length).toBeGreaterThan(30);
    expect(Math.round(hzToMidi(440))).toBe(69);
  });
});
