"""A finished pass over a recording, reduced to what the stage plays."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable

def build_media_score(events: Iterable[dict]) -> list[tuple[float, dict]]:
    """Turn one finished pass over a recording into what the stage should play."""
    finals: dict[str, dict] = {}
    order: dict[str, int] = {}
    verified: dict[int, list[str]] = {}
    timeline: list[tuple[float, int, dict]] = []
    seq = 0

    def keep(word: dict) -> None:
        nonlocal seq
        word_id = str(word.get("word_id") or "")
        if not word_id or not word.get("final", True):
            return
        if word_id not in order:
            order[word_id] = seq
        finals[word_id] = word
        seq += 1

    for ev in events:
        kind = ev.get("type", "word")
        if kind == "word":
            keep(ev)
        elif kind == "verification":
            words = [w for w in ev.get("words") or [] if w.get("word_id")]
            for word in words:
                keep(word)
            verified[int(ev.get("utterance", 0))] = [
                str(w["word_id"]) for w in words
            ]
        elif kind == "level":
            seq += 1
            timeline.append((float(ev.get("t", 0.0)), seq, ev))
        elif kind == "sound":
            seq += 1
            edge = "start" if ev.get("state") == "start" else "end"
            timeline.append((float(ev.get(edge, 0.0)), seq, ev))

    for word_id, word in finals.items():
        kept = verified.get(int(word.get("utterance", 0)))
        if kept is not None and word_id not in kept:
            continue
        release = float(word.get("t", word.get("start", 0.0)))
        timeline.append((max(0.0, release), order[word_id], {
            **word, "type": "word", "final": True,
        }))
    timeline.sort(key=lambda item: (item[0], item[1]))
    return [(release, ev) for release, _, ev in timeline]


def replay_score(
    score: list[tuple[float, dict]],
    *,
    paced: bool = True,
    cancelled: Callable[[], bool] | None = None,
    _clock=None,
    _sleep=None,
):
    """Yield a score's events, each at its own moment on the source clock."""

    clock = _clock or time.monotonic
    sleep = _sleep or time.sleep
    started = clock()
    for release, ev in score:
        while paced:
            if cancelled is not None and cancelled():
                return
            wait_s = started + release - clock()
            if wait_s <= 0:
                break
            sleep(min(wait_s, 0.2))
        yield ev


def analysed_events(
    events: Iterable[dict],
    *,
    duration_s: float = 0.0,
    progress: Callable[[float], None] | None = None,
    ready: Callable[[], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    direct: Callable[[list[dict]], list[dict]] | None = None,
    on_score: Callable[[list[dict]], None] | None = None,
    on_timeline: Callable[[list[tuple[float, dict]]], None] | None = None,
    paced: bool = True,
    _clock=None,
    _sleep=None,
):
    """Hear the whole recording first, then play it back on the source clock."""

    heard: list[dict] = []
    reported = -1.0
    try:
        for ev in events:
            if cancelled is not None and cancelled():
                return
            heard.append(ev)
            if (progress is not None and duration_s > 0
                    and ev.get("type") == "level"):
                done = min(1.0, float(ev.get("t", 0.0)) / duration_s)
                if done - reported >= 0.02:
                    reported = done
                    progress(done)
    finally:
        close = getattr(events, "close", None)
        if close is not None:
            close()
    score = build_media_score(heard)
    del heard
    if direct is not None:
        slots = [i for i, (_, ev) in enumerate(score) if ev.get("type") == "word"]
        revised = direct([score[i][1] for i in slots])
        if len(revised) == len(slots):
            cue_start: dict[object, float] = {}
            for i, word in zip(slots, revised):
                if "cue" in word:
                    cue_start[word["cue"]] = min(
                        cue_start.get(word["cue"], score[i][0]), score[i][0])
            for i, word in zip(slots, revised):
                score[i] = (cue_start.get(word.get("cue"), score[i][0]), word)
            order = sorted(range(len(score)), key=lambda k: (score[k][0], k))
            score = [score[k] for k in order]
    if on_score is not None:
        on_score([ev for _, ev in score if ev.get("type") == "word"])
    if on_timeline is not None:
        on_timeline(list(score))
    if ready is not None:
        ready()
    yield from replay_score(
        score, paced=paced, cancelled=cancelled, _clock=_clock, _sleep=_sleep)
