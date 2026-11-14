"""A recording's captions while a person adjusts them in the studio."""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass

from .captions import (
    RESTAGE,
    document,
    opened,
    rescore,
    revise,
    score_words,
    speaker_order,
    window,
)
from .score import replay_score

Score = list[tuple[float, dict]]


@dataclass(frozen=True)
class Play:
    """Play the captions from `start_s`; to the end of the recording, or only as far as `end_s`."""
    start_s: float = 0.0
    end_s: float | None = None


@dataclass(frozen=True)
class Stop:
    """Clear the stage and hold the picture."""


class CaptionDesk:
    """The score the stage plays, what a person has changed in it, and what to play next.

    The studio's requests arrive on server threads; `events` runs on the
    thread that publishes to the stage.
    """

    def __init__(
        self,
        score: Score,
        speakers: Iterable[str],
        *,
        tail_s: float,
        changed: Callable[[Score, list[dict], list[str]], None],
    ) -> None:
        words = score_words(score)
        self._speakers = speaker_order(words, speakers)
        self._score = self._first = opened(score, self._speakers)
        self._first_speakers = list(self._speakers)
        self._known = {str(word.get("word_id")): word for word in words}
        self._generation = 0
        self._order: Play | Stop | None = Play()
        self._tail_s = float(tail_s)
        self._changed = changed
        self._lock = threading.Condition()

    def document(self) -> dict:
        with self._lock:
            return {
                "generation": self._generation,
                "speakers": list(self._speakers),
                "words": document(score_words(self._score)),
            }

    def adjust(self, edits: Iterable[dict], then: Play | Stop | None = None) -> dict:
        """Apply a person's adjustments; raises `CaptionError` and changes nothing if they cannot be."""
        with self._lock:
            generation = self._generation + 1
            words = revise(self._known, edits, generation)
            speakers = speaker_order(words, self._speakers)
            self._set(rescore(self._score, words, speakers), speakers, generation, then)
            self._known.update((word["word_id"], word) for word in words)
            return self.document()

    def revert(self, then: Play | Stop | None = None) -> dict:
        """Back to the captions as Weave first made them."""
        with self._lock:
            self._set(self._first, self._first_speakers, self._generation + 1, then)
            return self.document()

    def play(self, order: Play | Stop) -> None:
        with self._lock:
            self._order = order
            self._lock.notify_all()

    def _set(self, score: Score, speakers: list[str], generation: int,
             then: Play | Stop | None) -> None:
        self._changed(score, score_words(score), speakers)
        self._score, self._speakers, self._generation = score, list(speakers), generation
        if then is not None:
            self._order = then
        self._lock.notify_all()

    def _waiting(self) -> bool:
        with self._lock:
            return self._order is not None

    def events(
        self,
        *,
        cancelled: Callable[[], bool],
        restaged: Callable[[], None] | None = None,
        _clock=None,
        _sleep=None,
    ) -> Iterator[dict]:
        """Play what is asked for, as it is asked, until the session is cancelled."""
        while True:
            with self._lock:
                while self._order is None:
                    if cancelled():
                        return
                    self._lock.wait(0.2)
                order, self._order = self._order, None
                score, speakers = self._score, list(self._speakers)
            clear = {"type": RESTAGE, "speakers": speakers}
            if restaged is not None:
                restaged()
            if isinstance(order, Stop):
                yield clear
                continue
            part = window(score, order.start_s, order.end_s, self._tail_s)
            yield from replay_score(
                part, cancelled=lambda: cancelled() or self._waiting(),
                _clock=_clock, _sleep=_sleep)
            if cancelled():
                return
