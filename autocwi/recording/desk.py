"""A recording's captions while a person adjusts them in the studio."""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Callable, Iterable

from .captions import document, opened, rescore, revise, score_words, speaker_order

Score = list[tuple[float, dict]]
REMEMBERED_ADJUSTMENTS = 64


class CaptionDesk:
    """The score the studio plays, and what a person has changed in it.

    The studio plays the score itself, so it can pause and seek; the desk
    only keeps it, applies adjustments and hands the result to `changed`.
    """

    def __init__(
        self,
        score: Score,
        speakers: Iterable[str],
        *,
        duration_s: float,
        changed: Callable[[Score, list[dict], list[str]], None],
    ) -> None:
        words = score_words(score)
        self._speakers = speaker_order(words, speakers)
        self._score = self._first = opened(score, self._speakers)
        self._first_speakers = list(self._speakers)
        self._known = {str(word.get("word_id")): word for word in words}
        self._recent: deque[list[str]] = deque()
        self._generation = 0
        self._duration_s = float(duration_s)
        self._changed = changed
        self._lock = threading.RLock()

    def document(self) -> dict:
        with self._lock:
            return {
                "generation": self._generation,
                "speakers": list(self._speakers),
                "durationS": self._duration_s,
                "words": document(score_words(self._score)),
            }

    def score(self) -> dict:
        """Everything the studio plays: each event with the time it is released."""
        with self._lock:
            return {
                "generation": self._generation,
                "speakers": list(self._speakers),
                "durationS": self._duration_s,
                "events": [[round(release, 4), ev] for release, ev in self._score],
            }

    def adjust(self, edits: Iterable[dict]) -> dict:
        """Apply a person's adjustments; raises `CaptionError` and changes nothing if they cannot be."""
        with self._lock:
            generation = self._generation + 1
            words = revise(self._known, edits, generation)
            speakers = speaker_order(words, self._speakers)
            self._set(rescore(self._score, words, speakers), speakers, generation)
            self._known.update((word["word_id"], word) for word in words)
            self._recent.append([word["word_id"] for word in words])
            while len(self._recent) > REMEMBERED_ADJUSTMENTS:
                for word_id in self._recent.popleft():
                    self._known.pop(word_id, None)
            return self.document()

    def revert(self) -> dict:
        """Back to the captions as Weave first made them."""
        with self._lock:
            self._set(self._first, self._first_speakers, self._generation + 1)
            return self.document()

    def _set(self, score: Score, speakers: list[str], generation: int) -> None:
        self._changed(score, score_words(score), speakers)
        self._score, self._speakers, self._generation = score, list(speakers), generation
