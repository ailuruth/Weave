"""A recording's words, read once from the whole file, replayed as a recognizer.

THE LIVE RECOGNIZER IS THE WRONG TOOL FOR A RECORDING. A streaming transducer
is chosen for delay: it hears 1.12 s at a time and must commit before the
sentence is over. A recording has no delay to protect, and on the PR film that
choice costs real words -- measured against the hand transcript from 0:28:

    streaming lane (shipped)                 92 / 106 words, WER 15.1%
    streaming lane + Whisper endpoint pass   92 / 105 words, WER 14.3%
    Whisper over the whole file              101 / 105 words, WER  5.7%

The endpoint pass barely helps because the lines it would fix ("GUMP! What's
your", "Buzz Lightyear to the rescue!") never reach it: the streaming lane has
already decided there was no speech there. Reading the whole file is the fix.
VAD pre-filtering was measured too and is OFF: it cuts the same shouted and
cartoon lines the streaming lane loses (17.1%).

So an import is transcribed first, whole, and `ScriptedRecognizer` then stands
exactly where the streaming transducer stands. Everything downstream -- word
ids, prosody, the endpoint speaker pass, the sound lane, the level meter -- is
the live pipeline, unchanged, fed better words. This is NOT the onset
fabrication `CLAUDE.md` forbids: every word here carries a start and an end
measured from the audio.

Cloud is not involved. The model is a one-time local download.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

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
    """Move each word's start to where its sound actually begins.

    Whisper's word starts are attention-derived, and after a pause they sit at
    the END OF THE PREVIOUS WORD rather than at the new word's first sound --
    the silence is given to the word that follows it. CWI 2.2.2 turns the
    colour "as soon as the sound of the word begins", so a start inside a
    pause turns the word early, before anyone has spoken.

    Only ever moves a start LATER, never past the word's own end, and only to
    the first frame that reaches `rise` of the word's own peak level -- a
    relative threshold, so a whispered word and a shouted one are both found.
    A word with no measurable rise (flat, or shorter than two frames) is left
    exactly where the recognizer put it.
    """

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


def transcribe_recording(
    path: str | Path,
    cfg: dict,
    language: str | None,
    *,
    model=None,
) -> tuple[list[ScriptWord], object]:
    """Whisper over the whole file, with word timestamps.

    Returns ``(words, model)`` so the caller can keep the loaded model for the
    next import. Raises whatever the loader raises -- a missing package, or a
    model that is not downloaded on a machine with no network -- and the caller
    falls back to the streaming lane, which needs neither.
    """

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
        # The bilingual profile detects; the pinned ones name their language.
        language=language if language in ("en", "ko") else None,
        beam_size=int(settings.get("beam_size", 5)),
        word_timestamps=True,
        # Measured: VAD drops shouted and cartoon voices over music.
        vad_filter=bool(settings.get("vad_filter", False)),
        # Each window stands alone, so one mis-heard line cannot be repeated
        # into the ones after it.
        condition_on_previous_text=False,
    )
    words: list[ScriptWord] = []
    for segment in segments:
        for word in segment.words or []:
            text = str(word.word).strip()
            if text and word.end > word.start:
                words.append(ScriptWord(text, float(word.start), float(word.end)))
    words.sort(key=lambda w: w.start)
    if settings.get("snap_onsets", True):
        words = snap_onsets(words, audio)
    return words, model


class _ScriptedStream:
    def __init__(self, base_samples: int, first: int):
        self.base_samples = base_samples
        self.first = first
        self.samples = 0
        self.emitted = 0
        self.pending = False
        self.finished = False

    def accept_waveform(self, sample_rate: int, samples) -> None:
        self.samples += len(samples)
        self.pending = True

    def input_finished(self) -> None:
        self.finished = True
        self.pending = True


class ScriptedRecognizer:
    """Speaks sherpa-onnx's online-recognizer interface from a finished script.

    The captioner drives a recognizer through seven calls and nothing else:
    `create_stream`, `stream.accept_waveform`, `stream.input_finished`,
    `is_ready`, `decode_stream`, `get_result_all`, `is_endpoint`. This answers
    them from the transcript: a word exists once the audio fed so far has
    reached its start, and an utterance ends at the end of a SENTENCE.

    The transducer can only end an utterance on silence, and a film rarely
    pauses that long: on the PR film no gap reaches `endpoint_silence_s`, and
    with silence as the only rule all 68 seconds came out as ONE utterance. A
    script knows where its sentences end, which is also where a captioned film
    breaks its lines and where the endpoint speaker pass is cleanest -- one
    speaker's sentence at a time. Silence (`endpoint_gap_s`) stays as the
    rule for a script with no punctuation.

    Time is counted in samples fed, across streams, because the captioner
    opens a new stream after every endpoint and reports each stream's stamps
    relative to its own start. That is the same frame the transducer uses, so
    `stream_base` and every word span downstream stay correct.
    """

    def __init__(self, words: list[ScriptWord], *, endpoint_gap_s: float = 0.8):
        self.words = list(words)
        self.endpoint_gap_s = float(endpoint_gap_s)
        self._fed = 0
        self._cursor = 0
        self._last: _ScriptedStream | None = None

    def create_stream(self) -> _ScriptedStream:
        previous = self._last
        if previous is not None:
            # Words the last stream showed belong to its utterance and are
            # never offered again; the audio it consumed is behind us.
            self._cursor = previous.first + previous.emitted
            self._fed = previous.base_samples + previous.samples
        self._last = _ScriptedStream(self._fed, self._cursor)
        return self._last

    def _now(self, stream: _ScriptedStream) -> float:
        return (stream.base_samples + stream.samples) / SR

    def is_ready(self, stream: _ScriptedStream) -> bool:
        return stream.pending

    def decode_stream(self, stream: _ScriptedStream) -> None:
        stream.pending = False
        now = self._now(stream)
        count = stream.emitted
        while (stream.first + count < len(self.words)
               and (stream.finished
                    or self.words[stream.first + count].start <= now)):
            # Nothing is offered past a sentence end until the captioner has
            # taken the endpoint and opened the next stream -- otherwise two
            # sentences with no pause between them merge into one utterance.
            if count and not stream.finished and self._ends_sentence(
                    self.words[stream.first + count - 1]):
                break
            count += 1
        stream.emitted = count

    @staticmethod
    def _ends_sentence(word: ScriptWord) -> bool:
        return word.text.rstrip("\"'”’)]").endswith((".", "?", "!", "…", "。"))

    def get_result_all(self, stream: _ScriptedStream):
        base = stream.base_samples / SR
        shown = self.words[stream.first:stream.first + stream.emitted]
        return SimpleNamespace(
            # A leading space is the transducer's word-boundary marker.
            tokens=[" " + word.text for word in shown],
            timestamps=[max(0.0, word.start - base) for word in shown],
            text=" ".join(word.text for word in shown),
            ys_probs=[],
        )

    def is_endpoint(self, stream: _ScriptedStream) -> bool:
        if not stream.emitted:
            return False
        now = self._now(stream)
        last = self.words[stream.first + stream.emitted - 1]
        if self._ends_sentence(last):
            return now >= last.end
        if now < last.end + self.endpoint_gap_s:
            return False
        upcoming = stream.first + stream.emitted
        return (upcoming >= len(self.words)
                or self.words[upcoming].start > now)
