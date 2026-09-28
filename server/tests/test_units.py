from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app import audio
from app.engines.detect import WIN, pick_windows
from app.engines.generate import build_prompt, cover_strength
from app.engines.stems import stem_id
from app.lyrics import LyricsRefused, LyricVariant, LyricVariants, VariantsRequest, build_user_message, generate_variants
from app.ratelimit import RateLimiter


@pytest.mark.parametrize(
    "name,expected",
    [
        ("song_(Vocals)_htdemucs_6s.wav", "vocals"),
        ("song_(Drums)_htdemucs_6s.wav", "drums"),
        ("song_(Instrumental)_model_bs_roformer.wav", "instrumental"),
        ("bass.wav", "bass"),
        ("no_vocals.wav", "instrumental"),
        ("weird (Synth Pad).wav", "synth-pad"),
    ],
)
def test_stem_ids(name, expected):
    assert stem_id(name) == expected


def test_detect_windows_spread_and_bounded():
    n = 16000 * 200
    starts = pick_windows(n)
    assert len(starts) == 24
    assert starts[0] == 0 and starts[-1] == n - WIN
    assert all(b > a for a, b in zip(starts, starts[1:]))
    assert pick_windows(1000) == [0]


def test_generate_helpers():
    assert cover_strength(0.0) == 0.95
    assert cover_strength(1.0) == 0.1
    assert cover_strength(0.45) == 0.55
    p = build_prompt("Drill UK", "808 glissées", 142, "F minor")
    assert p.startswith("Drill UK, 808 glissées, 142 BPM, in F minor")


def test_rate_limiter():
    rl = RateLimiter(per_minute=60, burst=2)
    assert rl.allow("a") and rl.allow("a")
    assert not rl.allow("a")
    assert rl.allow("b")


def test_audio_roundtrip(tmp_path: Path):
    sr = 22050
    x = (0.3 * np.sin(2 * np.pi * 220 * np.arange(sr) / sr)).astype(np.float32)[:, None]
    p = audio.write_wav(tmp_path / "a.wav", np.repeat(x, 2, axis=1), sr)
    data, rate = audio.load(p, target_sr=16000, mono=True)
    assert rate == 16000 and data.shape[1] == 1
    assert abs(len(data) - 16000) <= 2
    assert np.max(np.abs(data)) == pytest.approx(0.3, abs=0.02)


def test_lyrics_prompt_contains_context_and_styles():
    req = VariantsRequest(lyrics="Reste encore un peu", title="Reste", language="fr", bpm=100, key="A minor", styles=["tiktok", "english"], hook="Reste encore un peu")
    msg = build_user_message(req)
    assert "Écris exactement 2 variantes" in msg
    assert "Hook TikTok" in msg and "Version anglaise" in msg
    assert "<paroles>\nReste encore un peu\n</paroles>" in msg
    assert "100 BPM" in msg


class FakeMessages:
    def __init__(self, response):
        self.response = response
        self.kwargs = None

    def parse(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def fake_client(response):
    msgs = FakeMessages(response)
    return SimpleNamespace(beta=SimpleNamespace(messages=msgs)), msgs


def test_generate_variants_uses_structured_output_and_fallbacks():
    parsed = LyricVariants(variants=[LyricVariant(title="Hook", style="tiktok", text="la", notes="n")])
    client, msgs = fake_client(SimpleNamespace(stop_reason="end_turn", parsed_output=parsed))
    out = generate_variants(VariantsRequest(lyrics="Reste encore un peu", styles=["tiktok"]), client=client)
    assert out[0].title == "Hook"
    assert msgs.kwargs["output_format"] is LyricVariants
    assert msgs.kwargs["fallbacks"] == "default"
    assert msgs.kwargs["betas"] == ["server-side-fallback-2026-07-01"]
    assert msgs.kwargs["thinking"] == {"type": "adaptive"}


def test_generate_variants_surfaces_refusals():
    client, _ = fake_client(SimpleNamespace(stop_reason="refusal", parsed_output=None))
    with pytest.raises(LyricsRefused):
        generate_variants(VariantsRequest(lyrics="Reste encore un peu", styles=["catchy"]), client=client)
