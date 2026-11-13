"""Where each word is, on the audio."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SR = 16000


@dataclass(frozen=True)
class ScriptWord:
    text: str
    start: float
    end: float


def snap_onsets(
    words: list[ScriptWord],
    audio: np.ndarray,
    *,
    sr: int = SR,
    frame_s: float = 0.01,
    rise: float = 0.12,
    max_shift_s: float = 0.6,
) -> list[ScriptWord]:
    """Move each word's start to where its sound actually begins."""

    hop = max(1, int(frame_s * sr))
    snapped: list[ScriptWord] = []
    for word in words:
        lo = max(0, int(word.start * sr))
        hi = min(len(audio), int(word.end * sr))
        frames = (hi - lo) // hop
        if frames < 2:
            snapped.append(word)
            continue
        span = audio[lo:lo + frames * hop].astype(np.float64).reshape(frames, hop)
        level = np.sqrt((span ** 2).mean(axis=1))
        peak = float(level.max())
        if peak <= 1e-5:
            snapped.append(word)
            continue
        first = int(np.argmax(level >= peak * rise))
        shift = min(first * hop / sr, max_shift_s,
                    max(0.0, word.end - word.start - 2 * frame_s))
        snapped.append(ScriptWord(word.text, word.start + shift, word.end))
    return snapped


_ALIGN_CHARS = set("abcdefghijklmnopqrstuvwxyz'")

_HANGUL_INITIAL = ("g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss",
                   "", "j", "jj", "ch", "k", "t", "p", "h")
_HANGUL_MEDIAL = ("a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
                  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i")
_HANGUL_FINAL = ("", "g", "kk", "gs", "n", "nj", "nh", "d", "l", "lg", "lm",
                 "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss", "ng",
                 "j", "ch", "k", "t", "p", "h")


def romanize_hangul(text: str) -> str:
    """Spell Hangul syllables in Latin letters; leave everything else alone."""
    out = []
    for ch in text:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out.append(_HANGUL_INITIAL[code // 588]
                       + _HANGUL_MEDIAL[(code % 588) // 28]
                       + _HANGUL_FINAL[code % 28])
        else:
            out.append(ch)
    return "".join(out)


def _align_token(text: str) -> str:
    import unicodedata

    plain = unicodedata.normalize(
        "NFKD", romanize_hangul(text)).lower().replace("\u2019", "'")
    token = "".join(ch for ch in plain if ch in _ALIGN_CHARS).strip("'")
    return token or "*"


def align_words(
    words: list[ScriptWord],
    audio: np.ndarray,
    *,
    aligner=None,
    window_words: int = 24,
    pad_s: float = 1.5,
) -> tuple[list[ScriptWord], object]:
    """Re-time every word against the audio with a forced aligner."""

    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as bundle

    if aligner is None:
        model = bundle.get_model(with_star=True).eval()
        aligner = (model, bundle.get_tokenizer(), bundle.get_aligner())
    model, tokenizer, ctc_align = aligner
    out = list(words)
    i = 0
    while i < len(words):
        j = min(len(words), i + window_words)
        for k in range(i + 1, j):
            if (words[k - 1].text.rstrip("\"')").endswith((".", "?", "!"))
                    and k - i >= 6):
                j = k
                break
        group = words[i:j]
        tokens = [_align_token(w.text) for w in group]
        if sum(t != "*" for t in tokens) * 2 >= len(tokens):
            lo = max(0.0, group[0].start - pad_s)
            hi = min(len(audio) / SR, group[-1].end + pad_s)
            clip = torch.from_numpy(
                audio[int(lo * SR):int(hi * SR)].astype(np.float32))[None]
            try:
                with torch.inference_mode():
                    emission, _ = model(clip)
                    spans = ctc_align(emission[0], tokenizer(["*"] + tokens + ["*"]))
                per_frame = clip.shape[1] / emission.shape[1] / SR
                for n, (word, span) in enumerate(zip(group, spans[1:-1])):
                    start = lo + span[0].start * per_frame
                    end = lo + span[-1].end * per_frame
                    if end > start:
                        out[i + n] = ScriptWord(word.text, float(start), float(end))
            except Exception:  # noqa: BLE001 - keep Whisper's times for this window
                pass
        i = j
    for n in range(1, len(out)):
        if out[n].start < out[n - 1].start:
            out[n] = ScriptWord(out[n].text, out[n - 1].start, max(out[n].end, out[n - 1].start + 0.02))
    return lead_in(out, audio), aligner


def lead_in(
    words: list[ScriptWord],
    audio: np.ndarray,
    *,
    sr: int = SR,
    frame_s: float = 0.01,
    rise: float = 0.2,
    max_back_s: float = 0.25,
) -> list[ScriptWord]:
    """Move a word's start back to where its sound begins, after a gap."""

    hop = max(1, int(frame_s * sr))
    out = list(words)
    for n, word in enumerate(words):
        floor_t = max(word.start - max_back_s, words[n - 1].end if n else 0.0)
        if word.start - floor_t < 2 * frame_s:
            continue
        lo, hi = int(word.start * sr), min(len(audio), int(word.end * sr))
        if hi - lo < 2 * hop:
            continue
        body = audio[lo:hi].astype(np.float64)
        frames = len(body) // hop
        peak = float(np.sqrt((body[:frames * hop].reshape(frames, hop) ** 2).mean(axis=1)).max())
        if peak <= 1e-5:
            continue
        start = word.start
        while start - frame_s >= floor_t:
            a = int((start - frame_s) * sr)
            level = float(np.sqrt((audio[a:a + hop].astype(np.float64) ** 2).mean()))
            if level < peak * rise:
                break
            start -= frame_s
        if start < word.start:
            out[n] = ScriptWord(word.text, start, word.end)
    return out
