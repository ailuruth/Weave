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


_ALIGN_CHARS = set("abcdefghijklmnopqrstuvwxyz'")


def _align_token(text: str) -> str:
    """A word as the aligner's alphabet spells it; "*" when it has no letters
    the alphabet knows (digits, symbols), which lets the aligner give that
    word whatever sound is there instead of failing the whole sentence."""

    import unicodedata

    plain = unicodedata.normalize("NFKD", text).lower().replace("\u2019", "'")
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
    """Re-time every word against the audio with a forced aligner.

    WHISPER'S WORD TIMES ARE NOT GOOD ENOUGH FOR THIS STAGE. They come from
    attention, not from the sound, and on the PR film they put "louder" at
    15.8 s when it is spoken at 16.5 s. Everything here is keyed on a word's
    span: the colour turns 0.7 s early, and its loudness is measured over
    the pause and the word before it, so the one word the narrator says
    loudly (-11 dB) came out at -17.8 dB, below the line's average.

    A CTC aligner answers a narrower question -- GIVEN these words, where is
    each one -- from the acoustics, frame by frame (20 ms). torchaudio's
    MMS_FA is multilingual and local (a one-time ~1.2 GB download).

    The text is aligned a few sentences at a time, inside the stretch of
    audio Whisper put it in plus `pad_s` either side, with a wildcard at both
    ends to soak up whatever else is in that stretch. That keeps the work
    linear in the recording's length, and one bad passage cannot shift the
    rest.

    A word the alphabet cannot spell is still placed (as a wildcard). A window
    that is mostly such words -- Hangul, until romanisation is added -- keeps
    Whisper's times, and so does any window the aligner fails on.
    Returns ``(words, aligner)`` so the loaded model can be reused.
    """

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
        # a window ends at a sentence end where it can, never past the cap
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
    # Alignment is per window, so two windows can disagree by a frame at
    # their seam. Starts must not run backwards.
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
    # Measured on "louder": its first consonant runs at -16..-19 dB under a
    # vowel peak of -9 dB, over room tone at -25 dB. 0.2 of the peak (-23 dB)
    # is between the two; 0.35 stopped at the consonant and moved nothing.
    rise: float = 0.2,
    max_back_s: float = 0.25,
) -> list[ScriptWord]:
    """Move a word's start back to where its sound begins, after a gap.

    A CTC aligner places a word at its first confidently spelled character,
    which for a word that swells in -- "louder", said after a pause -- is
    late: aligned at 16.67 s, while the level has been rising since 16.50 s
    and the film starts its motion at 16.43 s. CWI 2.2.2 turns the colour
    "as soon as the sound of the word begins".

    Only words with silence in front of them are touched, only backwards,
    never into the previous word, and only while the level stays above
    `rise` of the word's own peak -- so room tone ahead of a word is not
    mistaken for it.
    """

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
        # WITHOUT THIS THE FILM'S FIRST 28 SECONDS COME BACK AS ONE LOWERCASE
        # RUN WITH NO PUNCTUATION, and sentences are what caption lines are
        # cut from: "louder or softer character identification" was shown as
        # one caption. A punctuated prompt sets the style for the transcript.
        initial_prompt=settings.get(
            "initial_prompt",
            "Hello. This is a transcript, with punctuation and capital letters."),
    )
    words: list[ScriptWord] = []
    for segment in segments:
        for word in segment.words or []:
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
    covered it, and an utterance ends at the end of a SENTENCE.

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
        # A word exists once its WHOLE span has been fed, not when its start
        # has. The captioner measures a word's prosody on first sight and
        # caches it; released at its start, the span is not in the buffer yet
        # and the word is cached as silence (measured: -80 dB on 6 of 65
        # labelled film words). The transducer never does this -- it emits a
        # word about a second after it was said.
        while (stream.first + count < len(self.words)
               and (stream.finished
                    or self.words[stream.first + count].end <= now)):
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
