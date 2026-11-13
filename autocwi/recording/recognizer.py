"""A finished transcript, standing where the streaming recognizer stands."""

from __future__ import annotations

from types import SimpleNamespace

from .timing import SR, ScriptWord

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
    """Speaks sherpa-onnx's online-recognizer interface from a finished script."""
    def __init__(self, words: list[ScriptWord], *, endpoint_gap_s: float = 0.8):
        self.words = list(words)
        self.endpoint_gap_s = float(endpoint_gap_s)
        self._fed = 0
        self._cursor = 0
        self._last: _ScriptedStream | None = None

    def create_stream(self) -> _ScriptedStream:
        previous = self._last
        if previous is not None:
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
                    or self.words[stream.first + count].end <= now)):
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
