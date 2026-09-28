"""Reference mastering with Matchering 2.0 (GPL-3.0, run as a library)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .. import audio
from ..jobs import JobContext
from .base import Availability, Engine, has_module


class MasterRefEngine(Engine):
    name = "master_ref"
    label = "Master par référence"
    inputs = ("target", "reference")

    def status(self) -> Availability:
        if has_module("matchering"):
            return Availability(True, "Matchering 2.0")
        return Availability(False, "pip install matchering")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        import matchering as mg

        ctx.progress(0.05, "Préparation des fichiers…")
        target = audio.to_wav(files["target"], ctx.work_dir / "target.wav")
        reference = audio.to_wav(files["reference"], ctx.work_dir / "reference.wav")
        out = ctx.out_dir / "master.wav"
        ctx.progress(0.2, "Matchering : RMS, EQ, crête, largeur…")
        mg.process(target=str(target), reference=str(reference), results=[mg.pcm24(str(out))])
        ctx.add_file(out, "master")
        return {"engine": "matchering"}
