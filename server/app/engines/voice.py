"""Zero-shot singing voice conversion with Seed-VC (GPL-3.0), invoked as a
subprocess of a separate checkout so its dependencies stay isolated."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from .. import audio
from ..config import settings
from ..jobs import JobContext
from .base import Availability, Engine, param_int

MAX_REFERENCE_SECONDS = 35


class VoiceEngine(Engine):
    name = "voice"
    label = "Conversion de voix"
    inputs = ("reference", "source")

    def status(self) -> Availability:
        d = settings.seedvc_dir
        if d and (Path(d) / "inference.py").exists():
            return Availability(True, f"Seed-VC · {d}")
        return Availability(False, "Clone Seed-VC et définis VIRALCYB_SEEDVC_DIR")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        if params.get("consent", "").lower() not in ("1", "true", "yes", "on"):
            raise PermissionError("Consentement requis : la voix de référence doit être la tienne ou autorisée.")
        steps = param_int(params, "steps", 30, 10, 60)
        pitch = param_int(params, "pitch", 0, -12, 12)
        ctx.progress(0.05, "Préparation des voix…")
        ref_data, ref_sr = audio.load(files["reference"], mono=True)
        if len(ref_data) / ref_sr > MAX_REFERENCE_SECONDS:
            ref_data = ref_data[: MAX_REFERENCE_SECONDS * ref_sr]
        ref = audio.write_wav(ctx.work_dir / "reference.wav", ref_data, ref_sr)
        src = audio.to_wav(files["source"], ctx.work_dir / "source.wav", mono=True)
        out_dir = ctx.work_dir / "seedvc"
        out_dir.mkdir(exist_ok=True)
        cmd = [
            settings.seedvc_python,
            "inference.py",
            "--source", str(src),
            "--target", str(ref),
            "--output", str(out_dir),
            "--diffusion-steps", str(steps),
            "--f0-condition", "True",
            "--auto-f0-adjust", "False",
            "--semi-tone-shift", str(pitch),
        ]
        ctx.progress(0.15, "Conversion (Seed-VC)…")
        proc = subprocess.run(cmd, cwd=settings.seedvc_dir, capture_output=True, text=True, timeout=3600, check=False)
        if proc.returncode != 0:
            raise RuntimeError(f"Seed-VC a échoué : {proc.stderr[-400:]}")
        outputs = sorted(out_dir.glob("*.wav"), key=lambda p: p.stat().st_mtime)
        if not outputs:
            raise RuntimeError("Seed-VC n'a produit aucun fichier.")
        final = ctx.out_dir / "voice.wav"
        outputs[-1].replace(final)
        ctx.add_file(final, "voice")
        return {"steps": steps, "pitch": pitch}
