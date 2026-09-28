import { useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import type { EngineId } from "../lib/api";
import { Icon } from "./Icon";
import { Button } from "./Bits";
import { ServerDialog } from "./ServerDialog";

/** Renders children when a server engine is available, otherwise explains how to enable it. */
export function EngineGate({ engine, what, children, fallback }: { engine: EngineId; what: string; children: ReactNode; fallback?: ReactNode }) {
  const server = useStore((s) => s.server);
  const [open, setOpen] = useState(false);
  const e = server.engines[engine];
  if (server.ok && e?.available) return <>{children}</>;
  return (
    <div className="gate">
      <div className="gate__head">
        <Icon name="server" size={18} />
        <strong>{server.ok ? "Moteur non installé sur le serveur" : "Serveur Viral Cyb non connecté"}</strong>
      </div>
      <p className="muted">{what}</p>
      {server.ok && e?.detail && <p className="mono faint">{e.detail}</p>}
      <div className="actions">
        <Button size="sm" icon="settings" onClick={() => setOpen(true)}>
          Configurer le serveur
        </Button>
        <span className="faint gate__hint">Voir <code>server/README.md</code> pour l'installer (Docker ou Python).</span>
      </div>
      {fallback}
      {open && <ServerDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
