/** Captures the browser's PWA install prompt so the app can offer its own button. */
import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function useInstallPrompt(): (() => Promise<void>) | null {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
    () => false,
  );
  if (!available) return null;
  return async () => {
    const ev = deferred;
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
    deferred = null;
    emit();
  };
}
