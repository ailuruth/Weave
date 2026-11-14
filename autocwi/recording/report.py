"""What `weave caption` says while it works, and the checks that run before it starts."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from typing import TextIO

from .captions import CaptionError
from .pipeline import RecordingHooks
from .render import find_chrome

STAGES = {
    "language": "Detecting the language",
    "loading": "Loading models",
    "transcribing": "Transcribing the speech",
    "analysing": "Analysing voices and delivery",
    "drawing": "Drawing captions",
}
ESTIMATE_AFTER_S = 2.0
ESTIMATE_AFTER_FRACTION = 0.03
ESTIMATE_BELOW_S = 3
QUARTER = 25


class NothingToCaption(CaptionError):
    """The recording has no speech and no sounds to caption."""


class MediaProblem(CaptionError):
    """The file cannot be captioned, in a sentence that names the file."""


def duration_text(seconds: float) -> str:
    seconds = max(0, round(seconds))
    if seconds < 60:
        return f"{seconds} s"
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} min {rest} s" if rest else f"{minutes} min"


def tooling_problem(*, draw: bool) -> str | None:
    """A missing program, as one line that says what to install."""
    for tool in ("ffprobe", "ffmpeg"):
        if shutil.which(tool) is None:
            return (f"{tool} is not installed. Install ffmpeg "
                    "(on macOS: brew install ffmpeg) and try again.")
    if draw:
        try:
            find_chrome()
        except RuntimeError:
            return ("Google Chrome is needed to draw the captions and was not "
                    "found. Install Chrome, or set CHROME to its path.")
    return None


def inspect_media(path: Path) -> float:
    """The duration in seconds of a file Weave can caption, else MediaProblem."""
    name = str(path)
    if not path.exists():
        raise MediaProblem(f"{name} does not exist.")
    if path.is_dir():
        raise MediaProblem(f"{name} is a folder, not a video or audio file.")
    if not os.access(path, os.R_OK):
        raise MediaProblem(f"{name} cannot be read. Check its permissions.")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True)
    try:
        info = json.loads(probe.stdout or "{}")
        duration = float((info.get("format") or {})["duration"])
    except (ValueError, KeyError):
        raise MediaProblem(f"{name} is not a video or audio file Weave can read.")
    if probe.returncode != 0:
        raise MediaProblem(f"{name} is damaged or unreadable.")
    if not any(s.get("codec_type") == "audio" for s in info.get("streams") or []):
        raise MediaProblem(f"{name} has no audio, so there is nothing to caption.")
    if duration <= 0:
        raise MediaProblem(f"{name} is empty.")
    return duration


@contextmanager
def quiet(log: Path) -> Iterator[tuple[TextIO, TextIO]]:
    """Send everything the process writes to `log`; yield streams onto the real terminal.

    Done on the file descriptors, because the speech and audio libraries write
    from C++ and a Python-level redirect would not catch them.
    """

    log.parent.mkdir(parents=True, exist_ok=True)
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    sink = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    os.dup2(sink, 1)
    os.dup2(sink, 2)
    os.close(sink)
    out = os.fdopen(saved[0], "w", encoding="utf-8", buffering=1, closefd=False)
    err = os.fdopen(saved[1], "w", encoding="utf-8", buffering=1, closefd=False)
    try:
        yield out, err
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        out.close()
        err.close()
        os.close(saved[0])
        os.close(saved[1])


class Reporter:
    """The calm account of a caption run: each stage as it happens, then the result.

    Stage facts arrive through the pipeline's hooks. On a terminal the current
    stage rewrites its own line; anywhere else every line is final.
    """

    def __init__(self, stream: TextIO, *, interactive: bool | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.stream = stream
        self.interactive = (
            stream.isatty() if interactive is None else interactive)
        self.clock = clock
        self.started = clock()
        self.words = 0
        self.sounds = 0
        self.scored_seen = False
        self.exports: dict[str, Path] = {}
        self.video: Path | None = None
        self._key: str | None = None
        self._stage_started = 0.0
        self._done = "done"
        self._quarter = 0

    @property
    def empty(self) -> bool:
        return self.scored_seen and not (self.words or self.sounds)

    def say(self, text: str = "") -> None:
        self._close_stage()
        print(text, file=self.stream, flush=True)

    def title(self, name: str, duration_s: float) -> None:
        self.say(f"Captioning {name} ({duration_text(duration_s)})")
        self.say()

    def stage(self, key: str) -> None:
        if key == self._key:
            return
        self._close_stage()
        self._key = key
        self._stage_started = self.clock()
        self._done = "done"
        self._quarter = 0
        self._draw(STAGES[key], None)
        if not self.interactive:
            self.stream.write("\n")
            self.stream.flush()

    def detail(self, text: str) -> None:
        self._done = text
        if not self.interactive:
            self.stream.write(f"    {text}\n")
            self.stream.flush()

    def progress(self, key: str, fraction: float) -> None:
        self.stage(key)
        fraction = min(1.0, max(0.0, fraction))
        percent = round(fraction * 100)
        if self.interactive:
            self._draw(STAGES[key], f"{percent}%{self._estimate(fraction)}")
        elif percent // QUARTER > self._quarter and percent < 100:
            self._quarter = percent // QUARTER
            self.stream.write(f"  {STAGES[key]}: {percent}%\n")
            self.stream.flush()

    def _estimate(self, fraction: float) -> str:
        elapsed = self.clock() - self._stage_started
        if elapsed < ESTIMATE_AFTER_S or fraction < ESTIMATE_AFTER_FRACTION:
            return ""
        left = elapsed * (1 - fraction) / fraction
        if left < ESTIMATE_BELOW_S:
            return ""
        step = 5 if left > 10 else 1
        return f"   about {duration_text(round(left / step) * step)} left"

    def _draw(self, label: str, status: str | None) -> None:
        if not self.interactive:
            if status is None:
                self.stream.write(f"  {label}")
                self.stream.flush()
            return
        tail = f"   {status}" if status else ""
        self.stream.write(f"\r\x1b[K  {label}{tail}")
        self.stream.flush()

    def _close_stage(self) -> None:
        if self._key is not None and self.interactive:
            self.stream.write(f"\r\x1b[K  {STAGES[self._key]}   {self._done}\n")
            self.stream.flush()
        self._key = None

    def analysing(self, fraction: float) -> None:
        self.progress("analysing", fraction)

    def drawing(self, fraction: float) -> None:
        self.progress("drawing", fraction)

    def scored(self, score: list[tuple[float, dict]]) -> None:
        self.scored_seen = True
        events = [ev for _, ev in score]
        self.words = sum(1 for ev in events if ev.get("type") == "word")
        self.sounds = sum(
            1 for ev in events
            if ev.get("type") == "sound" and ev.get("state") == "start")

    def exported(self, paths: dict[str, Path], stem: str) -> None:
        self.exports = dict(paths)

    def video_written(self, path: Path) -> None:
        self.video = path

    def discard_exports(self) -> None:
        for path in self.exports.values():
            path.unlink(missing_ok=True)
        for folder in {p.parent for p in self.exports.values()}:
            try:
                folder.rmdir()
            except OSError:
                pass
        self.exports = {}

    def finish(self) -> None:
        self._close_stage()
        written = [p for p in (self.video, *self.exports.values()) if p is not None]
        counts = [f"{n} {noun}{'' if n == 1 else 's'}"
                  for n, noun in ((self.words, "word"), (self.sounds, "sound caption"))
                  if n]
        self.say()
        if counts:
            self.say(f"Captioned {' and '.join(counts)}.")
        self.say("Files written:")
        for path in written:
            self.say(f"  {_shown(path)}")
        self.say()
        self.say(f"Done in {duration_text(self.clock() - self.started)}.")


def _shown(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def attach(reporter: Reporter | None, hooks: RecordingHooks) -> RecordingHooks:
    """The session's hooks, with the reporter listening to the same facts."""
    if reporter is None:
        return hooks

    def announce(stage: str) -> None:
        if stage == "transcribing":
            reporter.stage("transcribing")
        hooks.announce(stage)

    def exported(paths: dict[str, Path], stem: str) -> None:
        reporter.exported(paths, stem)
        hooks.exported(paths, stem)

    def scored(score: list[tuple[float, dict]]) -> None:
        reporter.scored(score)
        if hooks.scored is not None and not reporter.empty:
            hooks.scored(score)

    return replace(hooks, announce=announce, exported=exported, scored=scored,
                   analysing=reporter.analysing)
