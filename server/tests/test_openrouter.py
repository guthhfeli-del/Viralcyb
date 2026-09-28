"""OpenRouter integration with a mocked HTTP transport (no network, no key)."""

from __future__ import annotations

import base64
import json
import threading
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf

from app import openrouter
from app.engines import transcribe
from app.jobs import Job, JobContext
from app.lyrics import LyricsRefused, VariantsRequest, generate_variants, lyrics_status


def mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")


def test_status_prefers_openrouter(monkeypatch, key):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    st = lyrics_status()
    assert st.available and st.detail.startswith("OpenRouter")


def test_status_without_any_key(monkeypatch):
    for k in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
        monkeypatch.delenv(k, raising=False)
    assert not lyrics_status().available


def test_variants_request_shape_and_parsing(key):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        content = json.dumps({"variants": [{"title": "Hook", "style": "tiktok", "text": "Reste encore", "notes": "court"}]})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": f"```json\n{content}\n```"}}]})

    out = generate_variants(VariantsRequest(lyrics="Reste encore un peu", styles=["tiktok"]), http=mock_client(handler))
    assert out[0].title == "Hook"
    assert seen["url"].endswith("/chat/completions")
    assert seen["auth"] == "Bearer sk-or-test"
    body = seen["body"]
    assert body["model"] == "anthropic/claude-opus-5"
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["messages"][0]["role"] == "system"
    assert "<paroles>" in body["messages"][1]["content"]


def test_variants_refusal_and_errors(key):
    refuse = mock_client(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": None, "refusal": "no"}}]}))
    with pytest.raises(LyricsRefused):
        generate_variants(VariantsRequest(lyrics="Reste encore un peu", styles=["catchy"]), http=refuse)
    broke = mock_client(lambda r: httpx.Response(402, json={"error": {"message": "Insufficient credits"}}))
    with pytest.raises(openrouter.OpenRouterError, match="Crédits"):
        generate_variants(VariantsRequest(lyrics="Reste encore un peu", styles=["catchy"]), http=broke)


def test_transcribe_engine_falls_back_to_openrouter(monkeypatch, key, tmp_path: Path):
    monkeypatch.setattr(transcribe, "has_module", lambda n: False)
    sr = 44100
    wav = tmp_path / "voice.wav"
    sf.write(wav, (0.2 * np.sin(2 * np.pi * 220 * np.arange(sr * 2) / sr)).astype(np.float32), sr)
    seen = {}

    def fake_transcribe(data: bytes, fmt: str, language=None, model=None, client=None):
        seen["fmt"], seen["size"], seen["language"] = fmt, len(data), language
        seen["decoded"], _ = sf.read(__import__("io").BytesIO(data))
        return {"text": "Reste encore un peu. La ville est à nous!"}

    monkeypatch.setattr(transcribe.openrouter, "transcribe", fake_transcribe)
    job = Job(id="t", kind="transcribe", dir=tmp_path / "job")
    job.in_dir.mkdir(parents=True)
    res = transcribe.TranscribeEngine().run(JobContext(job, threading.Lock()), {"audio": wav}, {"language": "fr"})
    assert seen["fmt"] == "flac" and seen["language"] == "fr"
    assert len(seen["decoded"]) == 32000  # resampled to 16 kHz mono
    assert res["text"] == "Reste encore un peu.\nLa ville est à nous!"
    assert transcribe.TranscribeEngine().status().detail.startswith("OpenRouter")


def test_transcribe_request_shape(key):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"text": "ok", "usage": {"seconds": 2}})

    res = openrouter.transcribe(b"abc", "flac", "fr", client=mock_client(handler))
    assert res["text"] == "ok"
    assert seen["url"].endswith("/audio/transcriptions")
    assert seen["body"]["model"] == "openai/whisper-1"
    assert seen["body"]["input_audio"] == {"data": base64.b64encode(b"abc").decode(), "format": "flac"}
    assert seen["body"]["language"] == "fr"
