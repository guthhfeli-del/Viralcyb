import { create } from "zustand";
import type { Features } from "../engine/types";
import type { GenreId } from "../engine/genres";
import type { MasterReport, PresetId } from "../dsp/master";
import type { Health } from "../lib/api";
import type { NoteEvent } from "../dsp/topline";

export type PageId = "score" | "mix" | "devices" | "master" | "versions" | "stems" | "lyrics" | "topline" | "voice" | "ai";

export interface Track {
  id: string;
  name: string;
  file: File | null;
  buffer: AudioBuffer;
  channels: [Float32Array, Float32Array];
  sampleRate: number;
  duration: number;
  demo: boolean;
}

export interface Rendered {
  id: string;
  label: string;
  detail: string;
  buffer: AudioBuffer;
  createdAt: number;
  kind: "version" | "stem" | "ai" | "voice";
}

interface State {
  page: PageId;
  track: Track | null;
  features: Features | null;
  stage: string;
  progress: number;
  error: string | null;
  genre: GenreId | "auto";
  mastered: { buffer: AudioBuffer; report: MasterReport; preset: PresetId | "custom" | "reference" } | null;
  rendered: Rendered[];
  lyrics: string;
  songTitle: string;
  take: { buffer: AudioBuffer | null; notes: NoteEvent[]; blob: Blob | null; words: string } | null;
  server: Health & { checked: boolean };
  setPage(p: PageId): void;
  setTrack(t: Track | null): void;
  setFeatures(f: Features | null): void;
  setStage(stage: string, progress: number): void;
  setError(e: string | null): void;
  setGenre(g: GenreId | "auto"): void;
  setMastered(m: State["mastered"]): void;
  addRendered(r: Rendered): void;
  removeRendered(id: string): void;
  setLyrics(t: string): void;
  setSongTitle(t: string): void;
  setTake(t: State["take"]): void;
  setServer(h: Health): void;
  reset(): void;
}

export const useStore = create<State>((set) => ({
  page: "score",
  track: null,
  features: null,
  stage: "idle",
  progress: 0,
  error: null,
  genre: "auto",
  mastered: null,
  rendered: [],
  lyrics: "",
  songTitle: "",
  take: null,
  server: { ok: false, engines: {}, checked: false },
  setPage: (page) => set({ page }),
  setTrack: (track) => set({ track, features: null, mastered: null, rendered: [], error: null, songTitle: track ? track.name.replace(/\.[a-z0-9]+$/i, "") : "" }),
  setFeatures: (features) => set({ features }),
  setStage: (stage, progress) => set({ stage, progress }),
  setError: (error) => set({ error }),
  setGenre: (genre) => set({ genre }),
  setMastered: (mastered) => set({ mastered }),
  addRendered: (r) => set((s) => ({ rendered: [r, ...s.rendered.filter((x) => x.id !== r.id)] })),
  removeRendered: (id) => set((s) => ({ rendered: s.rendered.filter((x) => x.id !== id) })),
  setLyrics: (lyrics) => set({ lyrics }),
  setSongTitle: (songTitle) => set({ songTitle }),
  setTake: (take) => set({ take }),
  setServer: (h) => set({ server: { ...h, checked: true } }),
  reset: () => set({ track: null, features: null, mastered: null, rendered: [], stage: "idle", progress: 0, error: null, page: "score" }),
}));
