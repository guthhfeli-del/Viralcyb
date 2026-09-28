/**
 * Full track analysis pipeline (pure TS — runs in a Web Worker or in Node).
 */
import { analyzeFrames, onsetEnvelope, TIMBRE_BANDS } from "../dsp/frames";
import { measureLoudness } from "../dsp/loudness";
import { estimateTempo, trackBeats, refineBpm, downbeatPhase, danceability } from "../dsp/tempo";
import { aggregateChroma, estimateKeyFromChroma } from "../dsp/key";
import { analyzeStructure } from "../dsp/structure";
import { spectrumProfile, stereoReport } from "../dsp/tonal";
import { detectAiIndicators, highBandOnsets } from "../dsp/aidetect";
import { mean, percentile } from "../dsp/util";
import type { AnalysisStage, Features } from "./types";

export const MAX_ANALYSIS_SECONDS = 420;

export function analyzeTrack(
  channelsIn: Float32Array[],
  fs: number,
  onProgress: (stage: AnalysisStage, p: number) => void = () => {},
): Features {
  const fullDuration = channelsIn[0].length / fs;
  const maxN = Math.min(channelsIn[0].length, Math.round(MAX_ANALYSIS_SECONDS * fs));
  const left = channelsIn[0].subarray(0, maxN);
  const right = (channelsIn[1] ?? channelsIn[0]).subarray(0, maxN);
  const duration = maxN / fs;
  const mono = new Float32Array(maxN);
  for (let i = 0; i < maxN; i++) mono[i] = 0.5 * (left[i] + right[i]);

  onProgress("loudness", 0.05);
  const loudness = measureLoudness([left, right], fs);

  onProgress("spectrum", 0.2);
  const frames = analyzeFrames(left, right, fs);
  const spectrum = spectrumProfile(frames.ltasMid, frames.ltasSide, frames.binHz);
  const stereo = stereoReport(left, right, fs, frames.ltasMid, frames.ltasSide, frames.binHz);

  onProgress("rhythm", 0.45);
  const onset = onsetEnvelope(mono, fs);
  const tempo = estimateTempo(onset.env, onset.hopSec);
  const beatFrames = trackBeats(onset.env, onset.hopSec, tempo.bpm);
  const beats = beatFrames.map((f) => f * onset.hopSec);
  const bpm = refineBpm(beats, tempo.bpm);
  const chromaAt = (t: number) => Math.min(frames.count - 1, Math.max(0, Math.round((t * fs - 2048) / frames.hop)));
  const harmonicChange = (onsetFrame: number) => {
    const t = onsetFrame * onset.hopSec;
    const a = chromaAt(t - 0.25), b = chromaAt(t + 0.25);
    let d = 0;
    for (let c = 0; c < 12; c++) d += Math.abs(frames.chroma[a * 12 + c] - frames.chroma[b * 12 + c]);
    return d / 2;
  };
  const phase = downbeatPhase(beatFrames, onset.low, harmonicChange);
  const downbeats = beats.filter((_, i) => i % 4 === phase);
  const atBeats = beatFrames.map((f) => onset.env[f] ?? 0);
  const beatSalience = mean(atBeats) / (mean(onset.env) + 1e-9);
  const dance = danceability(tempo.pulseClarity, beatSalience, bpm);

  onProgress("tonality", 0.6);
  const key = estimateKeyFromChroma(aggregateChroma(frames.chroma, frames.rmsDb, frames.count));

  onProgress("structure", 0.7);
  const structure = analyzeStructure({
    frames,
    duration,
    beats: tempo.confidence > 0.05 ? beats : [],
    downbeatPhase: phase,
    bpm,
    momentary: loudness.momentary,
  });

  onProgress("ai", 0.88);
  const ai = detectAiIndicators(mono, fs, spectrum.bandwidthHz, highBandOnsets(mono, fs));

  // vocal proxy summary
  const vc = structure.vocalCurve;
  const chorusV = structure.sections.filter((s) => s.kind === "chorus").map((s) => s.vocal);
  const vocal = {
    mean: mean(vc),
    chorus: chorusV.length ? mean(chorusV) : mean(vc),
    contrast: percentile(Array.from(frames.vocal), 90) - percentile(Array.from(frames.vocal), 10),
  };

  // waveform overview (min/max pairs) and timbre map for visuals
  const COLS = 1200;
  const peaks: number[] = [];
  const rms: number[] = [];
  const per = Math.max(1, Math.floor(maxN / COLS));
  for (let c = 0; c < COLS; c++) {
    let lo = 0, hi = 0, s = 0;
    const off = c * per;
    for (let i = 0; i < per && off + i < maxN; i++) {
      const v = mono[off + i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      s += v * v;
    }
    peaks.push(lo, hi);
    rms.push(Math.sqrt(s / per));
  }
  const TCOLS = Math.min(480, frames.count);
  const tdata: number[] = [];
  for (let r = 0; r < TIMBRE_BANDS; r++) {
    for (let c = 0; c < TCOLS; c++) {
      const f0 = Math.floor((c / TCOLS) * frames.count);
      const f1 = Math.max(f0 + 1, Math.floor(((c + 1) / TCOLS) * frames.count));
      let s = 0;
      for (let f = f0; f < f1; f++) s += frames.timbre[f * TIMBRE_BANDS + r];
      tdata.push(s / (f1 - f0));
    }
  }

  onProgress("done", 1);
  return {
    version: 1,
    meta: { duration: fullDuration, analysedDuration: duration, sampleRate: fs, channels: channelsIn.length },
    loudness,
    spectrum,
    stereo,
    rhythm: {
      bpm,
      bpmRaw: tempo.bpm,
      confidence: tempo.confidence,
      pulseClarity: tempo.pulseClarity,
      beatSalience,
      danceability: dance,
      beats,
      downbeats,
      alternatives: tempo.alternatives,
    },
    key,
    structure,
    ai,
    vocal,
    waveform: { peaks, rms },
    timbreMap: { cols: TCOLS, rows: TIMBRE_BANDS, data: tdata },
  };
}
