"""Caption a recording: the stages, in order, in one place."""

from __future__ import annotations

import time
import warnings
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from .captions import opened, pair, read_captions, rescore, revise, score_words, speaker_order
from .desk import CaptionDesk
from .direct import CUE_MAX_CHARS, direct, line_length
from .export import write_exports
from .recognizer import ScriptedRecognizer
from .render import probe_picture
from .score import analyse, replay_score
from .timing import ScriptWord
from .transcribe import transcribe_recording

PREVIEW_TAIL_S = 1.0


@dataclass
class RecordingHooks:
    """What the session wants to hear about while a recording is prepared."""
    announce: Callable[[str], None]
    ready: Callable[[], None]
    cancelled: Callable[[], bool]
    exported: Callable[[dict[str, Path], str], None]
    scored: Callable[[list[tuple[float, dict]]], None] | None = None
    desk: Callable[[CaptionDesk], None] | None = None
    restaged: Callable[[], None] | None = None


def media_duration_s(path: Path) -> float:
    import librosa

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return float(librosa.get_duration(path=str(path)))


def recording_events(
    media: Path,
    name: str,
    language: str,
    cfg: dict,
    *,
    caption_pass: Callable[[object | None], Iterable[dict]],
    out_dir: Path,
    hooks: RecordingHooks,
    paced: bool = True,
    cache: dict | None = None,
    captions: Path | None = None,
) -> Iterator[dict]:
    """Yield the studio events for one recording, analysed and then replayed.

    `captions` is a `.cwi.json` a person has adjusted: its text, times,
    speakers, sizes and lines are used as written and nothing is transcribed.
    With `hooks.desk` the recording stays open for adjustment after it plays.
    """

    live_cfg = cfg["live"]
    cache = cache if cache is not None else {}
    recognizer = None
    settings = dict(live_cfg.get("import_recognizer", {}) or {})
    given = written_order = None
    if captions is not None:
        given, written_order = read_captions(captions)
        recognizer = ScriptedRecognizer(
            [ScriptWord(e["text"], e["start"], e["end"]) for e in given],
            endpoint_gap_s=float(live_cfg.get("endpoint_silence_s", 1.2)),
        )
    elif str(settings.get("engine", "whisper")) == "whisper":
        hooks.announce("transcribing")
        try:
            started = time.perf_counter()
            script, cache["model"] = transcribe_recording(
                media, cfg, language, model=cache.get("model"))
            recognizer = ScriptedRecognizer(
                script,
                endpoint_gap_s=float(live_cfg.get("endpoint_silence_s", 1.2)),
            )
            print(f"[live] whole-file transcript: {len(script)} words in "
                  f"{time.perf_counter() - started:.1f}s")
        except Exception as exc:  # noqa: BLE001 - any loader failure
            print("[live] whole-file recognizer unavailable "
                  f"({exc}); using the streaming lane")

    duration_s = media_duration_s(media)
    director = dict(live_cfg.get("import_director") or {})
    picture = probe_picture(media)
    director["cue_max_chars"] = line_length(
        picture.width / picture.height,
        int(director.get("cue_max_chars", CUE_MAX_CHARS)))

    stem = Path(name).stem

    def export(words: list[dict], speakers: list[str]) -> None:
        try:
            paths = write_exports(
                words, out_dir, stem, cfg, name, duration_s, speakers=speakers)
        except Exception as exc:  # noqa: BLE001 - never stop playback
            print(f"[live] caption export failed: {exc}")
            return
        hooks.exported(paths, stem)
        print("[live] captions exported: "
              + ", ".join(str(p) for p in paths.values()))

    score = analyse(
        caption_pass(recognizer),
        duration_s=duration_s,
        progress=lambda done: hooks.announce(f"analysing {round(done * 100)}%"),
        cancelled=hooks.cancelled,
        direct=lambda words: direct(words, director),
    )
    if score is None:
        return
    words = score_words(score)
    if given is not None:
        known = {str(word.get("word_id")): word for word in words}
        words = revise(known, pair(given, words), 0)
        speakers = speaker_order(words, written_order)
        score = rescore(score, words, speakers)
    else:
        speakers = speaker_order(words)
        score = opened(score, speakers)

    def changed(score: list[tuple[float, dict]], words: list[dict], speakers: list[str]) -> None:
        export(words, speakers)
        if hooks.scored is not None:
            hooks.scored(list(score))

    changed(score, words, speakers)
    hooks.ready()
    if hooks.desk is None:
        yield from replay_score(score, paced=paced, cancelled=hooks.cancelled)
        return
    delay_s = float((cfg.get("display") or {}).get("read_ahead_delay_s", 0.0))
    desk = CaptionDesk(
        score, speakers, tail_s=delay_s + PREVIEW_TAIL_S, changed=changed)
    hooks.desk(desk)
    yield from desk.events(cancelled=hooks.cancelled, restaged=hooks.restaged)
