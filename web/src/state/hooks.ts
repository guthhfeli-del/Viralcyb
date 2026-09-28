import { useMemo } from "react";
import { useStore } from "./store";
import { guessGenre, genreById, type GenreId } from "../engine/genres";
import { scoreVirality } from "../engine/virality";
import { buildAdvice } from "../engine/advice";

export function useGenre(): { id: GenreId; auto: boolean; label: string } {
  const genre = useStore((s) => s.genre);
  const features = useStore((s) => s.features);
  return useMemo(() => {
    const id = genre === "auto" ? (features ? guessGenre(features) : "pop") : genre;
    return { id, auto: genre === "auto", label: genreById(id).label };
  }, [genre, features]);
}

export function useVirality() {
  const features = useStore((s) => s.features);
  const { id } = useGenre();
  return useMemo(() => (features ? scoreVirality(features, id) : null), [features, id]);
}

export function useAdvice() {
  const features = useStore((s) => s.features);
  const { id } = useGenre();
  return useMemo(() => (features ? buildAdvice(features, id) : null), [features, id]);
}

/** Tempo as producers would write it (trap/drill are usually counted in double time). */
export function useDisplayBpm(): number | null {
  const features = useStore((s) => s.features);
  const { id } = useGenre();
  if (!features) return null;
  const b = features.rhythm.bpm;
  if ((id === "rap" || id === "drill") && b < 90) return b * 2;
  return b;
}
