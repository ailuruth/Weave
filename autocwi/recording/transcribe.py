"""What was said: the whole recording, transcribed at once."""

from __future__ import annotations

import warnings
from pathlib import Path

from .timing import SR, ScriptWord, align_words, snap_onsets

STYLE_PROMPTS = {
    "en": "Hello. This is a transcript, with punctuation and capital letters.",
    "ko": "안녕하세요. 문장 부호를 넣은 받아쓰기입니다.",
}


def _style_prompt(settings: dict, language: str | None) -> str | None:
    prompts = {**STYLE_PROMPTS, **(settings.get("initial_prompts") or {})}
    return prompts.get(language or "")


def transcribe_recording(
    path: str | Path,
    cfg: dict,
    language: str | None,
    *,
    model=None,
) -> tuple[list[ScriptWord], object]:
    """Whisper over the whole file, with word timestamps."""

    import librosa
    from faster_whisper import WhisperModel

    settings = dict((cfg.get("live", {}) or {}).get("import_recognizer", {}) or {})
    if model is None:
        model = WhisperModel(
            settings.get("model", "large-v3-turbo"),
            device=settings.get("device", "cpu"),
            compute_type=settings.get("compute_type", "int8"),
            cpu_threads=int(settings.get("cpu_threads", 4)),
        )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        audio, _ = librosa.load(str(path), sr=SR, mono=True)
    segments, _ = model.transcribe(
        audio,
        language=language if language in ("en", "ko") else None,
        beam_size=int(settings.get("beam_size", 5)),
        word_timestamps=True,
        vad_filter=bool(settings.get("vad_filter", False)),
        condition_on_previous_text=False,
        initial_prompt=_style_prompt(settings, language),
    )
    floor = float(settings.get("min_word_confidence", 0.65))
    words: list[ScriptWord] = []
    for segment in segments:
        spoken = segment.words or []
        if spoken and sum(w.probability for w in spoken) / len(spoken) < floor:
            continue
        for word in spoken:
            text = str(word.word).strip()
            if text and word.end > word.start:
                words.append(ScriptWord(text, float(word.start), float(word.end)))
    words.sort(key=lambda w: w.start)
    if settings.get("forced_alignment", True):
        try:
            words, _ = align_words(words, audio)
        except Exception as exc:  # noqa: BLE001 - aligner missing or not downloaded
            print(f"[live] forced alignment unavailable ({exc}); "
                  "keeping the recognizer's word times")
            if settings.get("snap_onsets", True):
                words = snap_onsets(words, audio)
    elif settings.get("snap_onsets", True):
        words = snap_onsets(words, audio)
    return words, model
