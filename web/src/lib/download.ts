import { encodeWav } from "../dsp/wav";

/**
 * Browsers silently fall back to "download" for some names (long dashes,
 * accents on some platforms): keep file names to a portable subset.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‒-―]/g, "-")
    .replace(/[^A-Za-z0-9 ._()\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "viralcyb";
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function bufferToWavBlob(buf: AudioBuffer, bits: 16 | 24 = 24): Blob {
  const chs: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  return new Blob([encodeWav(chs, buf.sampleRate, bits)], { type: "audio/wav" });
}

export function channelsToWavBlob(chs: Float32Array[], fs: number, bits: 16 | 24 = 24): Blob {
  return new Blob([encodeWav(chs, fs, bits)], { type: "audio/wav" });
}

export const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");
