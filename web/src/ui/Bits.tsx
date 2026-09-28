import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Panel({ index, title, aside, children, className = "", id }: { index?: string; title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id}>
      {(title || aside) && (
        <header className="panel__head">
          <div className="panel__title">
            {index && <span className="panel__index mono">{index}</span>}
            {title && <h3>{title}</h3>}
          </div>
          {aside && <div className="panel__aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head rise">
      <span className="label">{kicker}</span>
      <h1 className="page-head__title">{title}</h1>
      {children && <p className="page-head__lead muted">{children}</p>}
    </header>
  );
}

export function Stat({ label, value, unit, hint, tone }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; tone?: "good" | "warn" | "bad" | "accent" }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <span className="label">{label}</span>
      <span className="stat__value">
        <span className="tnum">{value}</span>
        {unit && <span className="stat__unit">{unit}</span>}
      </span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md", ariaLabel }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md"; ariaLabel?: string }) {
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, variant = "ghost", icon, disabled, type = "button", size = "md", title }: { children?: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "quiet" | "accent"; icon?: IconName; disabled?: boolean; type?: "button" | "submit"; size?: "sm" | "md" | "lg"; title?: string }) {
  return (
    <button type={type} className={`btn btn--${variant} btn--${size}`} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Bar({ value, max = 100, tone = "grad", target }: { value: number; max?: number; tone?: "grad" | "green" | "violet" | "warn" | "bad"; target?: [number, number] }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      {target && <div className="bar__target" style={{ left: `${(target[0] / max) * 100}%`, width: `${((target[1] - target[0]) / max) * 100}%` }} />}
      <div className={`bar__fill bar__fill--${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Thin progress line; omit `value` for an indeterminate activity bar. */
export function Progress({ value, label }: { value?: number; label?: string }) {
  const indet = value === undefined;
  return (
    <div className={`progress${indet ? " progress--indet" : ""}`} role="progressbar" aria-valuenow={indet ? undefined : Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress__track">
        <div className="progress__fill" style={indet ? undefined : { width: `${Math.round(value * 100)}%` }} />
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3 className="serif">{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Chip({ children, tone }: { children: ReactNode; tone?: "green" | "violet" | "warn" | "bad" }) {
  return <span className={`chip${tone ? ` chip--${tone}` : ""}`}>{children}</span>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export const scoreTone = (s: number): "good" | "warn" | "bad" => (s >= 75 ? "good" : s >= 50 ? "warn" : "bad");
