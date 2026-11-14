"""Which language is spoken in a recording, decided from its opening."""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path

from .timing import SR

OPENING_S = 120.0
SEGMENTS = 2
MIN_CONFIDENCE = 0.80
NAMES = {"en": "English", "ko": "Korean", "multi": "English and Korean"}


class LanguageUnclear(Exception):
    """Detection ran and its answer cannot be trusted."""


@dataclass(frozen=True)
class Detected:
    language: str
    confidence: float
    heard_speech: bool = True


def detect_language(media: Path, cfg: dict, cache: dict) -> Detected:
    """Whisper's language detector over the opening of the file.

    The model is left in `cache["model"]`, where the transcription that follows
    picks it up instead of loading it a second time.
    """

    import librosa
    from faster_whisper import WhisperModel
    from faster_whisper.vad import get_speech_timestamps

    settings = dict((cfg.get("live", {}) or {}).get("import_recognizer", {}) or {})
    if str(settings.get("engine", "whisper")) != "whisper":
        raise LanguageUnclear("the configured recognizer cannot detect a language")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        audio, _ = librosa.load(str(media), sr=SR, mono=True, duration=OPENING_S)
    if not get_speech_timestamps(audio):
        return Detected("en", 0.0, heard_speech=False)
    if cache.get("model") is None:
        cache["model"] = WhisperModel(
            settings.get("model", "large-v3-turbo"),
            device=settings.get("device", "cpu"),
            compute_type=settings.get("compute_type", "int8"),
            cpu_threads=int(settings.get("cpu_threads", 4)),
        )
    code, confidence, _ = cache["model"].detect_language(
        audio, vad_filter=True, language_detection_segments=SEGMENTS)
    if code not in ("en", "ko"):
        raise LanguageUnclear(
            f"the speech sounds like {code!r}, and Weave captions English and Korean")
    if confidence < MIN_CONFIDENCE:
        raise LanguageUnclear(
            f"it could not tell {NAMES[code]} from another language "
            f"({confidence:.0%} sure)")
    return Detected(code, confidence)
