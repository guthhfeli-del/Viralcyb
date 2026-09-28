/**
 * Client for the Viral Cyb server (FastAPI). Every server feature is
 * optional: the app degrades to local processing when the server or a
 * given engine is unavailable.
 */
export type EngineId = "stems" | "master_ref" | "transcribe" | "topline" | "detect" | "lyrics" | "voice" | "generate";

export interface Health {
  ok: boolean;
  version?: string;
  engines: Partial<Record<EngineId, { available: boolean; detail: string }>>;
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message?: string;
  error?: string;
  result?: Record<string, unknown> & { files?: { name: string; url: string; label?: string }[] };
}

const KEY = "viralcyb.api";

export function apiBase(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v.replace(/\/$/, "");
  } catch {
    /* storage unavailable */
  }
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}

export function setApiBase(url: string) {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export const fileUrl = (path: string) => (path.startsWith("http") ? path : `${apiBase()}${path}`);

export async function health(signal?: AbortSignal): Promise<Health> {
  try {
    const r = await fetch(`${apiBase()}/api/health`, { signal });
    if (!r.ok) return { ok: false, engines: {} };
    const j = await r.json();
    return { ok: true, version: j.version, engines: j.engines ?? {} };
  } catch {
    return { ok: false, engines: {} };
  }
}

/** File extension for an unnamed blob (e.g. a MediaRecorder take). */
function extFor(mime: string): string {
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mp4") || mime.includes("aac")) return ".m4a";
  if (mime.includes("mpeg")) return ".mp3";
  return ".wav";
}

export async function startJob(kind: string, files: Record<string, Blob | undefined>, fields: Record<string, string | number | boolean | undefined> = {}): Promise<Job> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(files)) if (v) fd.append(k, v, (v as File).name ?? `${k}${extFor(v.type)}`);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  const r = await fetch(`${apiBase()}/api/jobs/${kind}`, { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `Erreur serveur (${r.status})`);
  return r.json();
}

export async function getJob(id: string): Promise<Job> {
  const r = await fetch(`${apiBase()}/api/jobs/${id}`);
  if (!r.ok) throw new Error(`Job introuvable (${r.status})`);
  return r.json();
}

export async function waitJob(id: string, onUpdate?: (j: Job) => void, signal?: AbortSignal): Promise<Job> {
  let delay = 600;
  for (;;) {
    if (signal?.aborted) throw new Error("Annulé");
    const j = await getJob(id);
    onUpdate?.(j);
    if (j.status === "done") return j;
    if (j.status === "error") throw new Error(j.error ?? "Échec du traitement");
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(2500, delay * 1.25);
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${apiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `Erreur serveur (${r.status})`);
  return r.json();
}
