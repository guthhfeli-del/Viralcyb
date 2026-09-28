"""Engine wiring tests with stand-in modules for the heavy ML dependencies,
mirroring the documented APIs of python-audio-separator, faster-whisper,
Basic Pitch and SONICS."""

from __future__ import annotations

import sys
import threading
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.engines import detect, stems, topline, transcribe
from app.jobs import Job, JobContext


@pytest.fixture()
def ctx(tmp_path: Path) -> JobContext:
    job = Job(id="t", kind="t", dir=tmp_path / "job")
    job.in_dir.mkdir(parents=True)
    return JobContext(job, threading.Lock())


@pytest.fixture()
def song(tmp_path: Path) -> Path:
    sr = 22050
    t = np.arange(sr * 12) / sr
    p = tmp_path / "song.wav"
    sf.write(p, np.stack([0.2 * np.sin(2 * np.pi * 220 * t)] * 2, 1).astype(np.float32), sr)
    return p


def install(monkeypatch, name: str, module: types.ModuleType):
    parts = name.split(".")
    for i in range(1, len(parts)):
        parent = ".".join(parts[:i])
        if parent not in sys.modules:
            monkeypatch.setitem(sys.modules, parent, types.ModuleType(parent))
    monkeypatch.setitem(sys.modules, name, module)


def test_stems_engine_with_audio_separator(monkeypatch, ctx, song):
    calls = {}

    class Separator:
        def __init__(self, output_dir, output_format, **kw):
            calls["init"] = (output_dir, output_format)
            self.out = Path(output_dir)

        def load_model(self, model_filename):
            calls["model"] = model_filename

        def separate(self, path):
            names = []
            for s in ("Vocals", "Drums", "Bass", "Other"):
                n = f"song_({s})_htdemucs_6s.wav"
                (self.out / n).write_bytes(b"RIFF")
                names.append(n)
            return names

    mod = types.ModuleType("audio_separator.separator")
    mod.Separator = Separator
    install(monkeypatch, "audio_separator.separator", mod)
    monkeypatch.setattr(stems, "has_module", lambda n: n == "audio_separator")
    res = stems.StemsEngine().run(ctx, {"audio": song}, {"model": "htdemucs_6s"})
    assert calls["model"] == "htdemucs_6s.yaml"
    assert res["stems"] == ["vocals", "drums", "bass", "other"]
    assert sorted(p.name for p in ctx.out_dir.iterdir()) == ["bass.wav", "drums.wav", "other.wav", "vocals.wav"]


def test_transcribe_engine(monkeypatch, ctx, song):
    class WhisperModel:
        def __init__(self, size, device, compute_type):
            self.size = size

        def transcribe(self, path, language=None, vad_filter=True):
            segs = [types.SimpleNamespace(start=0.0, end=2.0, text=" Reste encore un peu "), types.SimpleNamespace(start=2.0, end=4.0, text="la ville est à nous")]
            return iter(segs), types.SimpleNamespace(language="fr", duration=4.0)

    mod = types.ModuleType("faster_whisper")
    mod.WhisperModel = WhisperModel
    install(monkeypatch, "faster_whisper", mod)
    monkeypatch.setattr(transcribe, "_model", None)
    monkeypatch.setattr(transcribe, "has_module", lambda n: n == "faster_whisper")
    res = transcribe.TranscribeEngine().run(ctx, {"audio": song}, {})
    assert res["text"] == "Reste encore un peu\nla ville est à nous"
    assert res["language"] == "fr"


def test_topline_engine(monkeypatch, ctx, song):
    class Midi:
        def write(self, path):
            Path(path).write_bytes(b"MThd")

    def predict(path):
        return None, Midi(), [(1.0, 1.5, 64, 0.8, []), (0.0, 0.5, 60, 0.5, [])]

    mod = types.ModuleType("basic_pitch.inference")
    mod.predict = predict
    install(monkeypatch, "basic_pitch.inference", mod)
    res = topline.ToplineEngine().run(ctx, {"audio": song}, {})
    assert [n["midi"] for n in res["notes"]] == [60, 64]
    assert (ctx.out_dir / "topline.mid").exists()


def test_detect_engine(monkeypatch, ctx, song):
    class FakeTensor:
        def __init__(self, a):
            self.a = np.asarray(a, dtype=np.float32)

        def reshape(self, *s):
            return FakeTensor(self.a.reshape(*s))

        def tolist(self):
            return self.a.tolist()

    class NoGrad:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    fake_torch = types.ModuleType("torch")
    fake_torch.Tensor = FakeTensor  # scipy probes torch.Tensor when "torch" is imported
    fake_torch.no_grad = NoGrad
    fake_torch.from_numpy = lambda a: FakeTensor(a)
    fake_torch.sigmoid = lambda t: FakeTensor(1 / (1 + np.exp(-t.a)))
    install(monkeypatch, "torch", fake_torch)

    seen = {}

    def model(x):
        seen.setdefault("shapes", []).append(x.a.shape)
        return FakeTensor(np.full((x.a.shape[0], 1), 2.0))

    monkeypatch.setattr(detect, "_get_model", lambda: model)
    res = detect.DetectEngine().run(ctx, {"audio": song}, {})
    assert all(s[1] == detect.WIN for s in seen["shapes"])
    assert res["probability"] == pytest.approx(1 / (1 + np.exp(-2.0)), abs=1e-3)
    assert len(res["windows"]) == 2  # 12 s of audio → two 5 s windows
