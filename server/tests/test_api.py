from __future__ import annotations

import io
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import engines as engines_mod
from app.engines.base import Availability, Engine
from app.jobs import JobStore
from app.main import create_app


def wav_bytes(seconds: float = 0.5, sr: int = 22050) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    buf = io.BytesIO()
    sf.write(buf, (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), sr, format="WAV")
    return buf.getvalue()


class EchoEngine(Engine):
    """Test engine: copies its input to the output and echoes params."""

    name = "echo"
    inputs = ("audio",)

    def status(self) -> Availability:
        return Availability(True, "test")

    def run(self, ctx, files, params):
        ctx.progress(0.5, "halfway")
        out = ctx.out_dir / "echo.wav"
        out.write_bytes(files["audio"].read_bytes())
        ctx.add_file(out, "echo")
        return {"params": params}


class BoomEngine(EchoEngine):
    name = "boom"

    def run(self, ctx, files, params):
        raise RuntimeError("kaboom")


class OffEngine(EchoEngine):
    name = "off"

    def status(self) -> Availability:
        return Availability(False, "not installed")


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    for e in (EchoEngine(), BoomEngine(), OffEngine()):
        monkeypatch.setitem(engines_mod.ENGINES, e.name, e)
    engines_mod.clear_status_cache()
    store = JobStore(tmp_path / "jobs", workers=1, max_queued=4, ttl_hours=0)
    with TestClient(create_app(store)) as c:
        yield c
    engines_mod.clear_status_cache()


def wait_done(client: TestClient, job_id: str, timeout: float = 10) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_health_lists_every_engine(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    for name in ("stems", "master_ref", "transcribe", "topline", "detect", "voice", "generate", "lyrics", "echo"):
        assert name in body["engines"]
        assert set(body["engines"][name]) == {"available", "detail"}


def test_job_lifecycle_and_download(client):
    data = wav_bytes()
    r = client.post("/api/jobs/echo", files={"audio": ("song.wav", data, "audio/wav")}, data={"model": "x"})
    assert r.status_code == 200, r.text
    job = wait_done(client, r.json()["id"])
    assert job["status"] == "done"
    assert job["progress"] == 1.0
    assert job["result"]["params"] == {"model": "x"}
    f = job["result"]["files"][0]
    assert f["label"] == "echo"
    dl = client.get(f["url"])
    assert dl.status_code == 200
    assert dl.content == data


def test_failed_engine_reports_error(client):
    r = client.post("/api/jobs/boom", files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    job = wait_done(client, r.json()["id"])
    assert job["status"] == "error"
    assert "kaboom" in job["error"]
    assert job["result"] is None


def test_validation(client):
    assert client.post("/api/jobs/nope", files={"audio": ("a.wav", wav_bytes(), "audio/wav")}).status_code == 404
    assert client.post("/api/jobs/off", files={"audio": ("a.wav", wav_bytes(), "audio/wav")}).status_code == 503
    assert client.post("/api/jobs/echo", data={"x": "1"}).status_code == 422
    assert client.post("/api/jobs/echo", files={"audio": ("evil.exe", b"MZ", "application/octet-stream")}).status_code == 415
    assert client.post("/api/jobs/echo", files={"audio": ("empty.wav", b"", "audio/wav")}).status_code == 422


def test_file_access_is_scoped(client):
    r = client.post("/api/jobs/echo", files={"audio": ("song.wav", wav_bytes(), "audio/wav")})
    job = wait_done(client, r.json()["id"])
    jid = job["id"]
    assert client.get(f"/api/files/{jid}/..%2F..%2Fjobs.py").status_code == 404
    assert client.get(f"/api/files/{jid}/audio.wav").status_code == 404  # inputs are never served
    assert client.get("/api/files/deadbeef/echo.wav").status_code == 404
    assert client.delete(f"/api/jobs/{jid}").status_code == 200
    assert client.get(f"/api/jobs/{jid}").status_code == 404


def test_rate_limit_on_job_creation(client):
    codes = [client.post("/api/jobs/echo", files={"audio": ("a.wav", wav_bytes(0.05), "audio/wav")}).status_code for _ in range(10)]
    assert 429 in codes or 503 in codes


def test_lyrics_endpoint_requires_credentials(client, monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/lyrics/variants", json={"lyrics": "Reste encore un peu\nreste encore un peu", "styles": ["catchy"]})
    assert r.status_code == 503


def test_lyrics_endpoint_validates_and_returns_variants(client, monkeypatch):
    from app import main as main_mod
    from app.engines.base import Availability as Av
    from app.lyrics import LyricVariant

    monkeypatch.setattr(main_mod, "lyrics_status", lambda: Av(True, "test"))
    monkeypatch.setattr(main_mod, "generate_variants", lambda req: [LyricVariant(title="A", style=req.styles[0], text="la la", notes="n")])
    bad = client.post("/api/lyrics/variants", json={"lyrics": "x", "styles": ["catchy"]})
    assert bad.status_code == 422
    bad_style = client.post("/api/lyrics/variants", json={"lyrics": "assez long pour passer", "styles": ["nope"]})
    assert bad_style.status_code == 422
    ok = client.post("/api/lyrics/variants", json={"lyrics": "Reste encore un peu", "styles": ["tiktok"], "bpm": 120})
    assert ok.status_code == 200
    assert ok.json()["variants"][0]["style"] == "tiktok"
