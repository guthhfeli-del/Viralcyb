import type { LoudnessReport } from "../dsp/loudness";
import type { KeyResult } from "../dsp/key";
import type { StructureResult } from "../dsp/structure";
import type { SpectrumProfile, StereoReport } from "../dsp/tonal";
import type { AiReport } from "../dsp/aidetect";

export interface RhythmReport {
  bpm: number;
  bpmRaw: number;
  confidence: number;
  pulseClarity: number;
  beatSalience: number;
  danceability: number;
  beats: number[];
  downbeats: number[];
  alternatives: number[];
}

/** Everything measured on a track — genre-independent, serialisable. */
export interface Features {
  version: 1;
  meta: { duration: number; analysedDuration: number; sampleRate: number; channels: number };
  loudness: LoudnessReport;
  spectrum: SpectrumProfile;
  stereo: StereoReport;
  rhythm: RhythmReport;
  key: KeyResult;
  structure: StructureResult;
  ai: AiReport;
  vocal: { mean: number; chorus: number; contrast: number };
  waveform: { peaks: number[]; rms: number[] }; // min/max interleaved
  timbreMap: { cols: number; rows: number; data: number[] }; // dB, rows = bands (low→high)
}

export type AnalysisStage = "decode" | "loudness" | "spectrum" | "rhythm" | "tonality" | "structure" | "ai" | "done";
