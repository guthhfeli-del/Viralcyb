import { useEffect, useState } from "react";

/** Large score dial: thin arc + serif numeral with a count-up. */
export function Gauge({ value, size = 260, label }: { value: number; size?: number; label?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const from = 0;
    const dur = 1100;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const r = size / 2 - 10;
  const c = size / 2;
  const start = Math.PI * 0.8;
  const end = Math.PI * 2.2;
  const arc = (a0: number, a1: number) => {
    const x0 = c + r * Math.cos(a0), y0 = c + r * Math.sin(a0);
    const x1 = c + r * Math.cos(a1), y1 = c + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const a = start + (end - start) * (shown / 100);
  const ticks = Array.from({ length: 41 }, (_, i) => start + ((end - start) * i) / 40);
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--green)" />
            <stop offset="100%" stopColor="var(--violet)" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={c + (r - 16) * Math.cos(t)}
            y1={c + (r - 16) * Math.sin(t)}
            x2={c + (r - (i % 5 === 0 ? 24 : 20)) * Math.cos(t)}
            y2={c + (r - (i % 5 === 0 ? 24 : 20)) * Math.sin(t)}
            stroke={t <= a ? "var(--text-2)" : "var(--line-2)"}
            strokeWidth={1}
          />
        ))}
        <path d={arc(start, end)} stroke="var(--line-2)" strokeWidth={1.5} fill="none" strokeLinecap="round" />
        {shown > 0 && <path d={arc(start, Math.max(start + 0.001, a))} stroke="url(#gauge-grad)" strokeWidth={2.5} fill="none" strokeLinecap="round" />}
        <circle cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={4} fill="var(--text)" />
      </svg>
      <div className="gauge__value">
        <span className="serif gauge__num tnum">{shown}</span>
        {label && <span className="label">{label}</span>}
      </div>
    </div>
  );
}
