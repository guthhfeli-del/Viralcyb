import { useRef, useState } from "react";
import { Icon } from "./Icon";

export function Dropzone({ onFile, compact = false, label = "Dépose ton son", sub = "ou clique pour choisir — WAV, MP3, M4A, FLAC, AIFF", accept = "audio/*,.wav,.mp3,.m4a,.flac,.aif,.aiff,.ogg,.opus" }: { onFile: (f: File) => void; compact?: boolean; label?: string; sub?: string; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone${over ? " is-over" : ""}${compact ? " dropzone--compact" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      aria-label={label}
    >
      {!compact && (
        <svg className="dropzone__wave" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 C 40 40, 50 12, 80 40 S 120 70, 150 40 S 200 5, 240 40 S 290 75, 330 40 S 380 18, 420 40 S 470 64, 510 40 S 560 26, 600 40" />
        </svg>
      )}
      <div className="dropzone__body">
        <span className="dropzone__icon">
          <Icon name="upload" size={compact ? 18 : 22} />
        </span>
        <div>
          <p className={compact ? "dropzone__label" : "dropzone__label serif"}>{label}</p>
          <p className="dropzone__sub">{sub}</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
