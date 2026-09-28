/** Standard MIDI File (format 0) writer for note events. */
import type { NoteEvent } from "./topline";

function varLen(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

export function notesToMidi(notes: NoteEvent[], bpm = 120, name = "Viral Cyb topline"): Uint8Array {
  const ppq = 480;
  const tick = (sec: number) => Math.max(0, Math.round((sec * bpm * ppq) / 60));
  const events: { t: number; data: number[] }[] = [];
  for (const n of notes) {
    const m = Math.max(0, Math.min(127, n.midi));
    events.push({ t: tick(n.start), data: [0x90, m, n.velocity] });
    events.push({ t: tick(n.end), data: [0x80, m, 0] });
  }
  events.sort((a, b) => a.t - b.t || a.data[0] - b.data[0]);
  const track: number[] = [];
  const nameBytes = Array.from(new TextEncoder().encode(name));
  track.push(0x00, 0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes);
  const us = Math.round(60_000_000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
  let last = 0;
  for (const e of events) {
    track.push(...varLen(e.t - last), ...e.data);
    last = e.t;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = track.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trk, ...track]);
}
