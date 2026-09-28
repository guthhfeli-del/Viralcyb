/**
 * Live microphone pitch tracker (YIN on a ~16 kHz decimated window every
 * animation frame), optional take recording and optional browser speech
 * recognition for live lyrics.
 */
import { audioContext } from "./audio";
import { Yin } from "../dsp/pitch";
import type { PitchPoint } from "../dsp/topline";

export interface LiveMic {
  stop(): Promise<{ blob: Blob | null }>;
  points: PitchPoint[];
  t0: number;
  now(): number;
  level(): number;
}

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
}

export function speechSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function micSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

export async function startLiveMic(opts: { record: boolean; speech: boolean; lang: string; onWords?: (finalText: string, interim: string) => void }): Promise<LiveMic> {
  const ctx = audioContext();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  src.connect(an);
  const factor = Math.max(1, Math.floor(ctx.sampleRate / 16000));
  const sr = ctx.sampleRate / factor;
  const yin = new Yin(sr, 70, 1100, 0.13);
  const winLen = Math.round(0.035 * sr) + yin.tauMax;
  const raw = new Float32Array(an.fftSize);
  const dec = new Float32Array(winLen);
  const points: PitchPoint[] = [];
  const t0 = ctx.currentTime;
  let lastLevel = 0;
  let running = true;
  let lp = 0;
  const tick = () => {
    if (!running) return;
    an.getFloatTimeDomainData(raw);
    const start = raw.length - winLen * factor;
    // cheap anti-alias (one-pole low-pass) + decimation
    for (let i = 0, j = 0; i < winLen; i++) {
      let acc = 0;
      for (let k = 0; k < factor; k++, j++) {
        lp += 0.5 * (raw[start + j] - lp);
        acc += lp;
      }
      dec[i] = acc / factor;
    }
    const r = yin.detect(dec);
    lastLevel = r.rms;
    points.push({ t: ctx.currentTime - t0, freq: r.freq, clarity: r.clarity, rms: r.rms });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  if (opts.record && typeof MediaRecorder !== "undefined") {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(250);
  }

  let rec: SpeechRec | null = null;
  let finalText = "";
  if (opts.speech && speechSupported()) {
    const w = window as unknown as Record<string, new () => SpeechRec>;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    rec = new SR();
    rec.lang = opts.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += (finalText ? " " : "") + res[0].transcript.trim();
        else interim += res[0].transcript;
      }
      opts.onWords?.(finalText, interim);
    };
    rec.onend = () => {
      if (running) {
        try {
          rec?.start();
        } catch {
          /* already started */
        }
      }
    };
    rec.onerror = () => {};
    try {
      rec.start();
    } catch {
      rec = null;
    }
  }

  return {
    points,
    t0,
    now: () => ctx.currentTime - t0,
    level: () => lastLevel,
    async stop() {
      running = false;
      try {
        rec?.stop();
      } catch {
        /* noop */
      }
      src.disconnect();
      let blob: Blob | null = null;
      if (recorder && recorder.state !== "inactive") {
        blob = await new Promise<Blob>((res) => {
          recorder!.onstop = () => res(new Blob(chunks, { type: recorder!.mimeType || "audio/webm" }));
          recorder!.stop();
        });
      }
      stream.getTracks().forEach((t) => t.stop());
      return { blob };
    },
  };
}

/** Play note events with a soft triangle synth. */
export function playNotes(notes: { midi: number; start: number; end: number; velocity: number }[], offset = 0): () => void {
  const ctx = audioContext();
  const t = ctx.currentTime + 0.05;
  const base = notes.length ? notes[0].start : 0;
  const nodes: OscillatorNode[] = [];
  const out = ctx.createGain();
  out.gain.value = 0.22;
  out.connect(ctx.destination);
  for (const n of notes) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
    const g = ctx.createGain();
    const s = t + n.start - base + offset;
    const e = t + n.end - base + offset;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.25 + n.velocity / 250, s + 0.015);
    g.gain.setTargetAtTime(0.0001, Math.max(s + 0.02, e - 0.03), 0.04);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(e + 0.25);
    nodes.push(o);
  }
  return () => {
    for (const o of nodes) {
      try {
        o.stop();
      } catch {
        /* noop */
      }
    }
    out.disconnect();
  };
}
