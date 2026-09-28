/** PCM WAV encoder (16-bit with TPDF dither, or 24-bit). */
export function encodeWav(channels: Float32Array[], fs: number, bits: 16 | 24 = 24): ArrayBuffer {
  const nCh = channels.length;
  const n = channels[0].length;
  const bytes = bits / 8;
  const dataLen = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, fs, true);
  v.setUint32(28, fs * nCh * bytes, true);
  v.setUint16(32, nCh * bytes, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  let o = 44;
  let seed = 22222;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) {
        const d = (rnd() - rnd()) / 32768; // TPDF, ±1 LSB
        const s = Math.max(-32768, Math.min(32767, Math.round((x + d) * 32767)));
        v.setInt16(o, s, true);
        o += 2;
      } else {
        const s = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607)));
        v.setUint8(o, s & 0xff);
        v.setUint8(o + 1, (s >> 8) & 0xff);
        v.setUint8(o + 2, (s >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return buf;
}
