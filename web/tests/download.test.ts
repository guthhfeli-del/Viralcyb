import { describe, expect, it } from "vitest";
import { safeFileName } from "../src/lib/download";

describe("download file names", () => {
  it("keeps names portable (accents and long dashes make browsers fall back to 'download')", () => {
    expect(safeFileName("Démo — Nuit blanche (synthèse) - Voix.mid")).toBe("Demo - Nuit blanche (synthese) - Voix.mid");
    expect(safeFileName("Mon son (Viral Cyb master) 16bit.wav")).toBe("Mon son (Viral Cyb master) 16bit.wav");
    expect(safeFileName("???")).toBe("viralcyb");
  });
});
