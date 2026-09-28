import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { apiBase, health, setApiBase, type EngineId, type Health } from "../lib/api";
import { Icon } from "./Icon";
import { Button } from "./Bits";

const ENGINE_LABELS: Record<EngineId, string> = {
  stems: "Séparation de stems (Demucs / RoFormer)",
  master_ref: "Master par référence (Matchering)",
  transcribe: "Transcription des paroles (Whisper)",
  topline: "Transcription MIDI (Basic Pitch)",
  detect: "Détecteur IA (SONICS)",
  lyrics: "Variantes de paroles (Claude)",
  voice: "Conversion de voix (Seed-VC)",
  generate: "Génération de versions (ACE-Step)",
};

export async function refreshServer() {
  const h = await health();
  useStore.getState().setServer(h);
  return h;
}

export function serverLabel(server: { ok: boolean; checked: boolean; engines: Health["engines"] }): { text: string; on: boolean } {
  if (!server.checked) return { text: "Connexion…", on: false };
  if (!server.ok) return { text: "Mode local", on: false };
  const n = Object.values(server.engines).filter((e) => e?.available).length;
  return { text: n ? `Serveur · ${n} moteur${n > 1 ? "s" : ""} IA` : "Serveur · aucun moteur", on: n > 0 };
}

export function ServerButton() {
  const [open, setOpen] = useState(false);
  const server = useStore((s) => s.server);
  const st = serverLabel(server);
  return (
    <>
      <button className="serverbtn" onClick={() => setOpen(true)}>
        <span className={`dot${st.on ? " dot--on" : ""}`} />
        <span className="label">{st.text}</span>
      </button>
      {open && <ServerDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ServerDialog({ onClose }: { onClose: () => void }) {
  const server = useStore((s) => s.server);
  const [url, setUrl] = useState(apiBase());
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const test = async () => {
    setBusy(true);
    setApiBase(url.trim());
    await refreshServer();
    setBusy(false);
  };
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="dialog__body">
        <header className="dialog__head">
          <h2 className="serif">Moteurs serveur</h2>
          <button className="iconbtn" onClick={() => ref.current?.close()} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <p className="muted">
          L'analyse, le mastering, les versions et le micro prédictif tournent en local. Les modèles lourds (stems, voix, génération, détecteur SONICS, paroles IA) passent par le serveur Viral Cyb.
        </p>
        <label className="field">
          <span className="label">Adresse du serveur</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="(même origine) ou https://api.exemple.com" />
        </label>
        <Button variant="primary" onClick={test} disabled={busy} icon="server">
          {busy ? "Test…" : "Tester la connexion"}
        </Button>
        <ul className="engines">
          {(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => {
            const e = server.engines[id];
            return (
              <li key={id}>
                <span className={`dot${e?.available ? " dot--on" : ""}`} />
                <span>{ENGINE_LABELS[id]}</span>
                <span className="faint engines__detail">{server.ok ? e?.detail ?? "non installé" : "serveur hors ligne"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
