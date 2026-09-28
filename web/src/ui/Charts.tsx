import { useEffect, useRef } from "react";
import type { TonalBalance } from "../dsp/tonal";

const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

/** 1/3-octave long-term spectrum against the genre target band. */
export function ToneChart({ tb, height = 220 }: { tb: TonalBalance; height?: number }) {
  const W = 720, H = height, padL = 34, padR = 10, padT = 12, padB = 24;
  const pts = tb.thirds;
  const all = pts.flatMap((p) => [p.db, p.target + 3, p.target - 3]);
  const max = Math.ceil(Math.max(...all) / 3) * 3 + 3;
  const min = Math.floor(Math.min(...all) / 3) * 3 - 3;
  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + ((max - v) / (max - min)) * (H - padT - padB);
  const band = pts.map((p, i) => `${x(i)},${y(p.target + 3)}`).join(" ") + " " + pts.slice().reverse().map((p, i) => `${x(pts.length - 1 - i)},${y(p.target - 3)}`).join(" ");
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.db)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const labels = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const grid: number[] = [];
  for (let v = max; v >= min; v -= 6) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Équilibre tonal par tiers d'octave comparé à la cible">
      <defs>
        <linearGradient id="tone-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="chart__tick">{v > 0 ? `+${v}` : v}</text>
        </g>
      ))}
      <polygon points={band} fill="var(--violet-wash)" stroke="none" />
      <path d={area} fill="url(#tone-fill)" />
      <path d={line} fill="none" stroke="var(--green)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) =>
        Math.abs(p.deviation) > 3 ? <circle key={i} cx={x(i)} cy={y(p.db)} r={3} fill={p.deviation > 0 ? "var(--amber)" : "var(--violet)"} /> : null,
      )}
      {pts.map((p, i) =>
        labels.includes(p.f) ? (
          <text key={p.f} x={x(i)} y={H - 6} textAnchor="middle" className="chart__tick">{fmtHz(p.f)}</text>
        ) : null,
      )}
    </svg>
  );
}

/** Small frequency-response curve (device simulation). */
export function ResponseCurve({ points, height = 90 }: { points: { f: number; db: number }[]; height?: number }) {
  const W = 320, H = height, pad = 6;
  const min = -30, max = 10;
  const x = (f: number) => pad + (Math.log(f / 20) / Math.log(1000)) * (W - 2 * pad);
  const y = (d: number) => pad + ((max - Math.max(min, Math.min(max, d))) / (max - min)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.f)},${y(p.db)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeDasharray="2 4" />
      {[100, 1000, 10000].map((f) => (
        <line key={f} x1={x(f)} x2={x(f)} y1={pad} y2={H - pad} stroke="var(--line)" />
      ))}
      <path d={d} fill="none" stroke="var(--violet)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Spectral fingerprint: timbre bands over time, green→violet. */
export function TimbreMap({ map, height = 64 }: { map: { cols: number; rows: number; data: number[] }; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = map.cols;
    c.height = map.rows;
    const g = c.getContext("2d")!;
    const img = g.createImageData(map.cols, map.rows);
    let mx = -Infinity, mn = Infinity;
    for (const v of map.data) {
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    const lo = Math.max(mn, mx - 60);
    for (let r = 0; r < map.rows; r++) {
      for (let col = 0; col < map.cols; col++) {
        const v = map.data[r * map.cols + col];
        const t = Math.max(0, Math.min(1, (v - lo) / (mx - lo)));
        const k = Math.pow(t, 1.8);
        const hue = r / map.rows; // low bands green → high bands violet
        const R = (143 * (1 - hue) + 168 * hue) * k;
        const G = (220 * (1 - hue) + 152 * hue) * k;
        const B = (174 * (1 - hue) + 245 * hue) * k;
        const idx = ((map.rows - 1 - r) * map.cols + col) * 4;
        img.data[idx] = R;
        img.data[idx + 1] = G;
        img.data[idx + 2] = B;
        img.data[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, [map]);
  return <canvas ref={ref} className="timbremap" style={{ height }} aria-hidden="true" />;
}
