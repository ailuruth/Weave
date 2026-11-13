"""Caption a recording: the stages, in order, in one place."""

from __future__ import annotations

import time
import warnings
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from .direct import direct
from .export import write_exports
from .recognizer import ScriptedRecognizer
from .score import analysed_events
from .transcribe import transcribe_recording


@dataclass
class RecordingHooks:
    """What the session wants to hear about while a recording is prepared."""
    announce: Callable[[str], None]
    ready: Callable[[], None]
    cancelled: Callable[[], bool]
    exported: Callable[[dict[str, Path], str], None]


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
    clock: Callable[[], float] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> Iterator[dict]:
    """Yield the studio events for one recording, analysed and then replayed."""

    live_cfg = cfg["live"]
    cache = cache if cache is not None else {}
    recognizer = None
    settings = dict(live_cfg.get("import_recognizer", {}) or {})
    if str(settings.get("engine", "whisper")) == "whisper":
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

    def export(words: list[dict]) -> None:
        stem = Path(name).stem
        try:
            paths = write_exports(words, out_dir, stem, cfg, name, duration_s)
        except Exception as exc:  # noqa: BLE001 - never stop playback
            print(f"[live] caption export failed: {exc}")
            return
        hooks.exported(paths, stem)
        print("[live] captions exported: "
              + ", ".join(str(p) for p in paths.values()))

    yield from analysed_events(
        caption_pass(recognizer),
        duration_s=duration_s,
        progress=lambda done: hooks.announce(f"analysing {round(done * 100)}%"),
        ready=hooks.ready,
        cancelled=hooks.cancelled,
        direct=lambda words: direct(words, live_cfg.get("import_director")),
        on_score=export,
        paced=paced,
        _clock=clock,
        _sleep=sleep,
    )
