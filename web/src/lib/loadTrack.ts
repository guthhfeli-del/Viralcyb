import { useStore } from "../state/store";
import { audioContext, bufferFrom, decodeFile, stereoChannels } from "./audio";
import { dsp } from "./dsp";
import { player } from "./player";

const ACCEPT = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aif|aiff|webm|mp4)$/i;
export const MAX_FILE_MB = 200;

export function isAudioFile(f: File): boolean {
  return f.type.startsWith("audio/") || f.type === "video/mp4" || ACCEPT.test(f.name);
}

async function analyze(channels: [Float32Array, Float32Array], fs: number) {
  const st = useStore.getState();
  st.setStage("loudness", 0.02);
  try {
    const features = await dsp.analyze(channels, fs, (stage, p) => useStore.getState().setStage(stage, p));
    useStore.getState().setFeatures(features);
    useStore.getState().setStage("done", 1);
  } catch (e) {
    useStore.getState().setError(e instanceof Error ? e.message : String(e));
    useStore.getState().setStage("error", 0);
  }
}

export async function loadFile(file: File) {
  const st = useStore.getState();
  if (!isAudioFile(file)) {
    st.setError("Ce fichier n'est pas un fichier audio reconnu (WAV, MP3, M4A, FLAC, OGG, AIFF).");
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    st.setError(`Fichier trop lourd (> ${MAX_FILE_MB} Mo).`);
    return;
  }
  st.setError(null);
  st.setStage("decode", 0.01);
  st.setPage("score");
  try {
    const buffer = await decodeFile(file);
    const channels = stereoChannels(buffer);
    player.clear();
    player.set("orig", buffer);
    player.use("orig", { keepTime: false, loop: null });
    st.setTrack({ id: crypto.randomUUID?.() ?? String(Date.now()), name: file.name, file, buffer, channels, sampleRate: buffer.sampleRate, duration: buffer.duration, demo: false });
    await analyze(channels, buffer.sampleRate);
  } catch (e) {
    st.setStage("error", 0);
    st.setError("Impossible de décoder ce fichier. Essaie un WAV ou un MP3 standard.");
    console.error(e);
  }
}

export async function loadDemo() {
  const st = useStore.getState();
  st.setError(null);
  st.setStage("decode", 0.01);
  st.setPage("score");
  const fs = audioContext().sampleRate;
  const { left, right } = await dsp.demo(fs, 120);
  const buffer = bufferFrom([left, right], fs);
  player.clear();
  player.set("orig", buffer);
  player.use("orig", { keepTime: false, loop: null });
  st.setTrack({ id: "demo", name: "Démo — Nuit blanche (synthèse)", file: null, buffer, channels: [left, right], sampleRate: fs, duration: buffer.duration, demo: true });
  await analyze([left, right], fs);
}
