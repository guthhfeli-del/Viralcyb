/**
 * In-browser models: Demucs stems and Basic Pitch transcription. Models are
 * downloaded once and kept in Cache Storage.
 */
import type { NoteEvent } from "../dsp/topline";

type Progress = (stage: string, p: number) => void;

/** HT-Demucs ONNX export used by demucs-web (~172 MB). Override with VITE_DEMUCS_MODEL_URL to self-host. */
export const DEMUCS_MODEL_URL: string =
  (import.meta.env.VITE_DEMUCS_MODEL_URL as string | undefined) ?? "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";
export const DEMUCS_MODEL_MB = 172;
export const BASIC_PITCH_MODEL_URL = "/models/basic-pitch/model.json";

const CACHE = "viralcyb-models-v1";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: Progress }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/ml.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, ok, result, error, progress } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) return p.progress?.(progress.stage, progress.p);
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "Le modèle a planté (mémoire insuffisante ?)"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[], progress?: Progress): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

/** Whether a model is already in the browser cache. */
export async function isCached(url: string): Promise<boolean> {
  try {
    return !!(await (await caches.open(CACHE)).match(url));
  } catch {
    return false;
  }
}

/** Fetch a (large) model with download progress, reusing Cache Storage when available. */
export async function fetchModel(url: string, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    cache = null; // Cache Storage unavailable (private mode, insecure context)
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok || !res.body) throw new Error(`Téléchargement du modèle impossible (${res.status})`);
  const total = Number(res.headers.get("content-length")) || DEMUCS_MODEL_MB * 1024 * 1024;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  try {
    // put() finishes reading the body before resolving, so the buffer can be transferred afterwards
    await cache?.put(url, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch {
    /* quota exceeded: keep working without cache */
  }
  return buf.buffer;
}

/** Resample (and down/up-mix) an AudioBuffer with the browser's audio engine. */
export async function resampleBuffer(buf: AudioBuffer, sampleRate: number, channels: 1 | 2): Promise<Float32Array[]> {
  const length = Math.ceil(buf.duration * sampleRate);
  const ctx = new OfflineAudioContext(channels, length, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return Array.from({ length: channels }, (_, c) => new Float32Array(out.getChannelData(c)));
}

export interface BrowserStem {
  id: "vocals" | "drums" | "bass" | "other";
  left: Float32Array;
  right: Float32Array;
}

export async function separateInBrowser(
  buf: AudioBuffer,
  onProgress: Progress,
  modelUrl = DEMUCS_MODEL_URL,
  prefer: "auto" | "wasm" = "auto",
): Promise<{ stems: BrowserStem[]; sampleRate: number; backend: string }> {
  const model = await fetchModel(modelUrl, (l, t) => onProgress("download", Math.min(1, l / t)));
  onProgress("prepare", 0);
  const [left, right] = await resampleBuffer(buf, 44100, 2);
  const r = await call<{ stems: BrowserStem[]; backend: string }>({ op: "demucs", model, left, right, prefer }, [model, left.buffer, right.buffer], onProgress);
  return { ...r, sampleRate: 44100 };
}

export async function transcribeNotes(buf: AudioBuffer, onProgress: Progress): Promise<NoteEvent[]> {
  const [mono] = await resampleBuffer(buf, 22050, 1);
  const r = await call<{ notes: NoteEvent[] }>({ op: "basicpitch", modelUrl: new URL(BASIC_PITCH_MODEL_URL, location.href).href, mono }, [mono.buffer], onProgress);
  return r.notes;
}

export const webGpuAvailable = (): boolean => typeof navigator !== "undefined" && "gpu" in navigator;
export const isolated = (): boolean => typeof window !== "undefined" && window.crossOriginIsolated === true;
