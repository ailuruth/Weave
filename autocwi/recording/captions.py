"""A recording's captions as a person adjusts them: text, speaker, size, line and time."""

from __future__ import annotations

import math
from collections.abc import Iterable

from .direct import LOUDNESS_PIVOT

RESTAGE = "restage"
CAPTIONS_MAX_BYTES = 16 * 2**20
MIN_WORD_S = 0.05
STEP_S = 0.001
EDGE_S = 0.01
UNKNOWN = "unknown"


class CaptionError(ValueError):
    """An adjustment that cannot be applied, said in words for the person who made it."""


def onset_s(word: dict) -> float:
    return float(word.get("t", word.get("start", 0.0)))


def spoken_s(word: dict) -> float:
    return max(MIN_WORD_S, float(word.get("end", 0.0)) - float(word.get("start", 0.0)))


def score_words(score: list[tuple[float, dict]]) -> list[dict]:
    return [ev for _, ev in score if ev.get("type", "word") == "word"]


def speaker_order(words: Iterable[dict], known: Iterable[str] = ()) -> list[str]:
    """Speakers in the order they are first heard, after any already known."""
    order = list(known)
    for word in words:
        speaker = word.get("speaker")
        if speaker and speaker not in order:
            order.append(str(speaker))
    return order


def document(words: list[dict]) -> list[dict]:
    """The adjustable part of every word, in order."""
    return [{
        "id": str(word.get("word_id") or ""),
        "text": str(word.get("text", "")).strip(),
        "start": round(onset_s(word), 3),
        "end": round(onset_s(word) + spoken_s(word), 3),
        "speaker": word.get("speaker") or None,
        "size": round(float(word.get("loudness") or 0.0), 4),
        "line": int(word.get("cue") or 0),
    } for word in words]


def from_spec(spec: dict) -> tuple[list[dict], list[str]]:
    """A `.cwi.json` file as adjustments, and its speakers in the file's order."""
    words = spec.get("words")
    if not isinstance(words, list):
        raise CaptionError("the captions file has no words")
    edits: list[dict] = []
    line = 0
    for n, word in enumerate(words):
        if not isinstance(word, dict):
            raise CaptionError(f"word {n + 1} in the captions file is not an object")
        if word.get("line_break") and edits:
            line += 1
        speaker = word.get("speaker")
        edits.append({
            "id": None,
            "text": word.get("text", ""),
            "start": word.get("start"),
            "end": word.get("end"),
            "speaker": None if speaker in (None, "", UNKNOWN) else str(speaker),
            "size": word.get("loudness"),
            "line": line,
        })
    speakers = [str(name) for name in (spec.get("speakers") or {}) if name != UNKNOWN]
    return edits, speakers


def _number(value, what: str, text: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise CaptionError(f'"{text}" has no {what} time') from None
    if not math.isfinite(number):
        raise CaptionError(f'"{text}" has no {what} time')
    return number


def entries(edits: Iterable[dict]) -> list[dict]:
    """Checked adjustments, one per word. A word typed with spaces becomes several; an emptied one is dropped."""
    checked: list[dict] = []
    for n, raw in enumerate(edits):
        if not isinstance(raw, dict):
            raise CaptionError(f"word {n + 1} is not an object")
        parts = str(raw.get("text", "")).split()
        if not parts:
            continue
        text = " ".join(parts)
        start = max(0.0, _number(raw.get("start"), "start", text))
        end = max(_number(raw.get("end"), "end", text), start + MIN_WORD_S)
        size = raw.get("size")
        if size is not None:
            size = min(1.0, max(0.0, _number(size, "size", text)))
        speaker = raw.get("speaker")
        speaker = None if speaker in (None, "", UNKNOWN) else str(speaker)
        letters = sum(len(part) for part in parts)
        cursor = start
        for part in parts:
            span = (end - start) * len(part) / letters
            checked.append({
                "id": None if raw.get("id") is None else str(raw["id"]),
                "text": part,
                "start": cursor,
                "end": cursor + span,
                "speaker": speaker,
                "size": size,
                "line": raw.get("line"),
            })
            cursor += span
    return checked


def _blank(neighbour: dict) -> dict:
    """A word nobody measured: its neighbour's voice, at the line's own size."""
    register = float(neighbour.get("pitch_register_hz") or neighbour.get("pitch_hz") or 0.0)
    return {
        "type": "word",
        "final": True,
        "utterance": neighbour.get("utterance", 0),
        "speaker": neighbour.get("speaker"),
        "speaker_known": bool(neighbour.get("speaker")),
        "speaker_status": "corrected" if neighbour.get("speaker") else UNKNOWN,
        "loudness": LOUDNESS_PIVOT,
        "loudness_db": neighbour.get("loudness_db"),
        "pitch": 0.5,
        "pitch_hz": register,
        "pitch_register_hz": register,
        "voiced_frac": float(neighbour.get("voiced_frac") or 0.6),
        "conf": 1.0,
        "start": 0.0,
        "end": MIN_WORD_S,
    }


def revise(known: dict[str, dict], edits: Iterable[dict], generation: int) -> list[dict]:
    """The words the stage should play after a person's adjustments.

    `known` holds every word an adjustment may name by `id`. A word with no
    known `id` is one the person added.
    """
    checked = entries(edits)
    measured = next((known[e["id"]] for e in checked if e["id"] in known), {})
    built: list[dict] = []
    cue = -1
    line: object = object()
    for n, entry in enumerate(checked):
        base = known.get(entry["id"]) if entry["id"] is not None else None
        if base is None:
            base = _blank(built[-1] if built else measured)
        t = entry["start"] if not built else max(entry["start"], built[-1]["t"] + STEP_S)
        if entry["line"] != line or not built:
            cue += 1
            line = entry["line"]
        begin = float(base.get("start", 0.0))
        word = {
            **base,
            "type": "word",
            "final": True,
            "word_id": f"g{generation}:{n:05d}",
            "text": entry["text"],
            "t": round(t, 3),
            "start": begin,
            "end": round(begin + max(MIN_WORD_S, entry["end"] - entry["start"]), 3),
            "cue": cue,
        }
        if entry["speaker"] != (base.get("speaker") or None):
            word.update(
                speaker=entry["speaker"],
                speaker_known=entry["speaker"] is not None,
                speaker_status="corrected" if entry["speaker"] else UNKNOWN,
                speaker_confidence=1.0,
            )
        if entry["size"] is not None:
            word["loudness"] = round(entry["size"], 4)
        if float(word.get("loudness") or 0.0) < LOUDNESS_PIVOT - 1e-6:
            word["soft"] = True
        else:
            word.pop("soft", None)
        built.append(word)
    return built


def rescore(
    score: list[tuple[float, dict]],
    words: list[dict],
    speakers: list[str],
) -> list[tuple[float, dict]]:
    """`score` with its words replaced by `words`, each released when its caption line starts."""
    line_start: dict[object, float] = {}
    for word in words:
        cue = word.get("cue")
        line_start[cue] = min(line_start.get(cue, math.inf), max(0.0, onset_s(word)))
    timeline = [(release, 0, n, ev) for n, (release, ev) in enumerate(score)
                if ev.get("type", "word") not in ("word", RESTAGE)]
    timeline += [(line_start[word.get("cue")], 1, n, word) for n, word in enumerate(words)]
    timeline.sort(key=lambda item: item[:3])
    return opened([(release, ev) for release, _, _, ev in timeline], speakers)


def opened(score: list[tuple[float, dict]], speakers: list[str]) -> list[tuple[float, dict]]:
    """`score` behind the event that clears the stage and names the speakers in colour order."""
    rest = [item for item in score if item[1].get("type") != RESTAGE]
    return [(0.0, {"type": RESTAGE, "speakers": list(speakers)}), *rest]


def pair(entries: list[dict], words: list[dict]) -> list[dict]:
    """Name, for each adjustment read from a file, the analysed word it is about."""
    import difflib

    def plain(text: str) -> str:
        return "".join(ch for ch in str(text).casefold() if ch.isalnum())

    ids: list[str | None] = [None] * len(entries)
    matcher = difflib.SequenceMatcher(
        a=[plain(e["text"]) for e in entries],
        b=[plain(w.get("text", "")) for w in words], autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            ids[block.a + k] = str(words[block.b + k].get("word_id"))
    return [{**entry, "id": word_id} for entry, word_id in zip(entries, ids)]


def window(
    score: list[tuple[float, dict]],
    start_s: float,
    end_s: float | None = None,
    tail_s: float = 0.0,
) -> list[tuple[float, dict]]:
    """The part of `score` that plays the captions from `start_s` to `end_s`, timed from zero.

    Sound and level run on for `tail_s` after `end_s` so the stage's delayed
    playhead reaches the last word.
    """
    part: list[tuple[float, dict]] = []
    for release, ev in score:
        kind = ev.get("type", "word")
        if kind == RESTAGE:
            part.append((0.0, ev))
        elif kind == "word":
            if release < start_s - EDGE_S:
                continue
            if end_s is not None and onset_s(ev) > end_s + EDGE_S:
                continue
            part.append((max(0.0, release - start_s), ev))
        elif release >= start_s and (end_s is None or release <= end_s + tail_s):
            part.append((release - start_s, ev))
    return part


def read_captions(path) -> tuple[list[dict], list[str]]:
    """A `.cwi.json` a person has adjusted, checked; raises `CaptionError` saying what is wrong with it."""
    import json
    from pathlib import Path

    try:
        spec = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise CaptionError(f"cannot read {path}: {exc.strerror or exc}") from None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CaptionError(f"{path} is not a caption file: {exc}") from None
    if not isinstance(spec, dict):
        raise CaptionError(f"{path} is not a caption file")
    edits, speakers = from_spec(spec)
    return entries(edits), speakers
