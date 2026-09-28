/** User corrections to the detected structure. */
import { relabelSection, type SectionKind, type StructureResult } from "../dsp/structure";
import { mean } from "../dsp/util";
import type { Features } from "./types";

/** Swap in a structure and refresh the metrics that read section labels. */
export function withStructure(f: Features, structure: StructureResult): Features {
  const chorusV = structure.sections.filter((s) => s.kind === "chorus").map((s) => s.vocal);
  return { ...f, structure, vocal: { ...f.vocal, chorus: chorusV.length ? mean(chorusV) : f.vocal.mean } };
}

export const withSectionKind = (f: Features, index: number, kind: SectionKind): Features => withStructure(f, relabelSection(f.structure, index, kind));
