/** Promise wrapper around the DSP worker. */
import type { Features } from "../engine/types";
import type { MasterReport, MasterSettings } from "../dsp/master";
import type { CenterCutResult } from "../dsp/centercut";
import type { LoudnessReport } from "../dsp/loudness";
import type { SpectrumProfile } from "../dsp/tonal";

type Progress = (stage: string, p: number) => void;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: Progress }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/dsp.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, ok, result, error, progress } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) {
        p.progress?.(progress.stage, progress.p);
        return;
      }
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "Erreur du moteur audio"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = [], progress?: Progress): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

const copies = (chs: Float32Array[]) => chs.map((c) => new Float32Array(c));

export const dsp = {
  analyze(channels: Float32Array[], fs: number, progress?: Progress): Promise<Features> {
    const c = copies(channels);
    return call<Features>({ op: "analyze", channels: c, fs }, c.map((x) => x.buffer), progress);
  },
  master(channels: Float32Array[], fs: number, settings: MasterSettings, progress?: Progress): Promise<{ channels: [Float32Array, Float32Array]; report: MasterReport }> {
    const c = copies(channels);
    return call({ op: "master", channels: c, fs, settings }, c.map((x) => x.buffer), progress);
  },
  centerCut(channels: Float32Array[], fs: number): Promise<CenterCutResult> {
    const c = copies(channels);
    return call({ op: "centercut", channels: c, fs }, c.map((x) => x.buffer));
  },
  pitch(mono: Float32Array, fs: number): Promise<{ times: number[]; freqs: number[]; clarity: number[]; rms: number[] }> {
    const m = new Float32Array(mono);
    return call({ op: "pitch", mono: m, fs }, [m.buffer]);
  },
  demo(fs: number, bpm = 120): Promise<{ left: Float32Array; right: Float32Array }> {
    return call({ op: "demo", fs, bpm });
  },
  profile(channels: Float32Array[], fs: number): Promise<{ loudness: LoudnessReport; spectrum: SpectrumProfile }> {
    const c = copies(channels);
    return call({ op: "profile", channels: c, fs }, c.map((x) => x.buffer));
  },
};
