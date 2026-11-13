"""What may be imported, and whether it can be captioned at all."""

from __future__ import annotations

import warnings
from pathlib import Path

from .timing import SR

MEDIA_SUFFIXES = frozenset({
    ".mp4", ".m4v", ".mov", ".webm", ".mkv",
    ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg",
})
MEDIA_MAX_BYTES = 4 * 2**30


def media_has_audio(path: Path) -> bool:
    """Can the recognizer's own loader read sound out of this file?"""
    import librosa

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            data, _ = librosa.load(str(path), sr=SR, mono=True, duration=1.0)
    except Exception:
        return False
    return len(data) > 0
