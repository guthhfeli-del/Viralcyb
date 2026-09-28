import { useEffect, useRef } from "react";
import type { NoteEvent, PitchPoint, Prediction } from "../dsp/topline";
import { hzToMidi, midiName } from "../dsp/util";

interface Props {
  notes: NoteEvent[];
  points: PitchPoint[];
  now: number; // seconds since start (live) or end of take
  window?: number; // seconds visible
  scale?: number[] | null; // pitch classes in key
  predictions?: Prediction[];
  bpm?: number | null;
  height?: number;
  live: boolean;
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function PianoRoll({ notes, points, now, window: win = 8, scale, predictions = [], bpm, height = 320, live }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current, b = box.current;
    if (!c || !b) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = b.clientWidth, H = height;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const green = css("--green"), violet = css("--violet"), line = css("--line"), text3 = css("--text-3");
    const keyW = 38;
    const predW = live ? Math.min(90, W * 0.16) : 0;
    const plotW = W - keyW - predW;
    const t1 = live ? now : Math.max(now, win);
    const t0 = t1 - win;
    // pitch range centred on recent notes
    const recent = notes.slice(-10).map((n) => n.midi);
    const livePitches = points.slice(-40).filter((p) => p.freq > 0 && p.clarity > 0.6).map((p) => hzToMidi(p.freq));
    const all = [...recent, ...livePitches];
    const centre = all.length ? all.sort((a, b) => a - b)[Math.floor(all.length / 2)] : 64;
    const lo = Math.round(centre) - 12, hi = Math.round(centre) + 12;
    const rowH = H / (hi - lo + 1);
    const y = (m: number) => H - (m - lo + 1) * rowH;
    const x = (t: number) => keyW + ((t - t0) / win) * plotW;

    // lanes
    for (let m = lo; m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      const inKey = scale ? scale.includes(pc) : true;
      g.fillStyle = inKey ? "rgba(236,235,241,0.028)" : "rgba(0,0,0,0.25)";
      g.fillRect(keyW, y(m), plotW + predW, rowH - 1);
      if (pc === 0 || m === lo) {
        g.fillStyle = text3;
        g.font = `10px ${css("--font-mono")}`;
        g.textBaseline = "middle";
        g.fillText(midiName(m), 4, y(m) + rowH / 2);
      }
    }
    // beat grid
    if (bpm) {
      const beat = 60 / bpm;
      g.fillStyle = line;
      for (let t = Math.ceil(t0 / beat) * beat; t < t1; t += beat) {
        const bar = Math.round(t / beat) % 4 === 0;
        g.fillStyle = bar ? "rgba(236,235,241,0.12)" : "rgba(236,235,241,0.05)";
        g.fillRect(x(t), 0, 1, H);
      }
    }
    // notes
    for (const n of notes) {
      if (n.end < t0 || n.start > t1) continue;
      const x0 = Math.max(keyW, x(n.start)), x1 = x(n.end);
      g.fillStyle = green;
      g.globalAlpha = 0.85;
      roundRect(g, x0, y(n.midi) + 1.5, Math.max(3, x1 - x0), rowH - 3, 3);
      g.fill();
      g.globalAlpha = 1;
    }
    // pitch trace
    g.strokeStyle = violet;
    g.lineWidth = 1.6;
    g.beginPath();
    let pen = false;
    for (const p of points) {
      if (p.t < t0) continue;
      if (p.freq <= 0 || p.clarity < 0.55) {
        pen = false;
        continue;
      }
      const m = hzToMidi(p.freq);
      if (m < lo - 1 || m > hi + 1) {
        pen = false;
        continue;
      }
      const px = x(p.t), py = y(m) + rowH / 2;
      if (!pen) g.moveTo(px, py);
      else g.lineTo(px, py);
      pen = true;
    }
    g.stroke();
    // playhead / now
    if (live) {
      g.fillStyle = "rgba(236,235,241,0.6)";
      g.fillRect(keyW + plotW, 0, 1, H);
      // predictions
      predictions.forEach((p, i) => {
        if (p.midi < lo || p.midi > hi) return;
        g.globalAlpha = 0.25 + 0.75 * Math.min(1, p.p * 2.2);
        g.strokeStyle = violet;
        g.setLineDash([4, 3]);
        roundRect(g, keyW + plotW + 8, y(p.midi) + 1.5, predW - 16, rowH - 3, 3);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = violet;
        g.font = `10px ${css("--font-mono")}`;
        g.fillText(`${Math.round(p.p * 100)}%`, keyW + plotW + 12, y(p.midi) - 6 + (i === 0 ? 0 : 0));
        g.globalAlpha = 1;
      });
    }
  }, [notes, points, now, win, scale, predictions, bpm, height, live, points.length]);
  return (
    <div ref={box} className="pianoroll">
      <canvas ref={ref} aria-label="Piano roll de la topline" role="img" />
    </div>
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
