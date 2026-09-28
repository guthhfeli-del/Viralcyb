import { useSyncExternalStore } from "react";
import { player, type PlayerSnapshot } from "./player";

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(
    (l) => player.subscribe(l),
    player.getSnapshot,
    player.getSnapshot,
  );
}
