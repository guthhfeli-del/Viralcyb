"""Audio I/O helpers: decode anything (soundfile, then ffmpeg), resample, write WAV."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf


class AudioError(RuntimeError):
    pass


def load(path: Path, target_sr: int | None = None, mono: bool = False) -> tuple[np.ndarray, int]:
    """Return float32 audio shaped (frames, channels) and its sample rate."""
    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception:
        data, sr = _ffmpeg_decode(path)
    if mono:
        data = data.mean(axis=1, keepdims=True)
    if target_sr and sr != target_sr:
        data = resample(data, sr, target_sr)
        sr = target_sr
    return data, sr


def _ffmpeg_decode(path: Path) -> tuple[np.ndarray, int]:
    if not shutil.which("ffmpeg"):
        raise AudioError("Format non supporté sans ffmpeg (installe ffmpeg ou envoie un WAV/FLAC).")
    sr = 44100
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(sr), "-"],
        capture_output=True,
        check=False,
        timeout=600,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise AudioError("Impossible de décoder le fichier audio.")
    return np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, 2).copy(), sr


def resample(data: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return data
    try:
        from scipy.signal import resample_poly

        g = np.gcd(sr_in, sr_out)
        return resample_poly(data, sr_out // g, sr_in // g, axis=0).astype(np.float32)
    except ImportError:
        n_out = int(round(len(data) * sr_out / sr_in))
        x_old = np.linspace(0, 1, len(data), endpoint=False)
        x_new = np.linspace(0, 1, n_out, endpoint=False)
        return np.stack([np.interp(x_new, x_old, data[:, c]) for c in range(data.shape[1])], axis=1).astype(np.float32)


def write_wav(path: Path, data: np.ndarray, sr: int, subtype: str = "PCM_24") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(data, -1.0, 1.0), sr, subtype=subtype)
    return path


def to_wav(src: Path, dst: Path, sr: int | None = None, mono: bool = False) -> Path:
    """Normalise any input to a WAV file (engines such as Matchering expect WAV)."""
    data, rate = load(src, target_sr=sr, mono=mono)
    return write_wav(dst, data, rate)
