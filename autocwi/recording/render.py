"""Draw a recording's captions onto its picture, frame by frame, with the studio itself.

Chrome's animation clock keeps running in real time while its page clock is
paused, so the page script holds every animation and seeks it from the page
clock before each frame.
"""

from __future__ import annotations

import base64
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

CHROME_PATHS = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
)
CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
CHROME_FLAGS = (
    "--headless=new",
    "--no-first-run",
    "--hide-scrollbars",
    "--mute-audio",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--run-all-compositor-stages-before-draw",
    "--disable-checker-imaging",
    "--disable-frame-rate-limit",
)
WINDOW = (1600, 1000)
CANVAS = (1280, 720)
RENDER_FPS = 60
COPIED_AUDIO = frozenset({".mp4", ".m4v", ".mov", ".m4a", ".aac"})
MIN_STEP_S = 1e-4
DELIVERY_TIMEOUT_S = 10.0

PAGE_SETUP = r"""
(() => {
  const Native = window.EventSource;
  window.__renderLastId = "";
  window.EventSource = class extends Native {
    constructor(url, ...rest) {
      super(`${url}?channel=render`, ...rest);
      this.addEventListener("message", (event) => {
        window.__renderLastId = event.lastEventId;
      });
    }
  };
  const nativeFetch = window.fetch;
  window.fetch = (input, ...rest) => nativeFetch(
    typeof input === "string" && /\/session$/.test(input) ? `${input}?render=1` : input,
    ...rest);
  HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get() { return this.__renderTime ?? 0; },
    set(value) { this.__renderTime = value; window.__renderMediaS = value; },
  });
  const adopt = () => {
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (animation.__renderOrigin !== undefined) continue;
      animation.__renderOrigin = now - Number(animation.currentTime ?? 0);
      animation.pause();
    }
  };
  window.__renderSeek = () => {
    adopt();
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      animation.currentTime = now - animation.__renderOrigin;
    }
    return {
      captioned: Boolean(document.querySelector(
        ".caption-stage .caption-word, .caption-stage .stage-sound")),
      mediaS: window.__renderMediaS,
    };
  };
  window.__renderHold = () => {
    adopt();
    new MutationObserver(adopt).observe(document, {
      subtree: true, childList: true, attributes: true,
    });
    return true;
  };
  const style = document.createElement("style");
  style.textContent = `
    html, body, .studio-shell, .workspace, .caption-stage {
      background: transparent !important;
    }
    .stage-media { visibility: hidden !important; }
  `;
  const attach = () => document.head.appendChild(style);
  if (document.head) attach();
  else document.addEventListener("DOMContentLoaded", attach);
})();
"""

FRAME_RECT = r"""
(() => {
  const stage = document.querySelector(".caption-stage");
  const video = document.querySelector(".stage-media");
  if (!stage || !video || (NEEDS_PICTURE && !video.videoWidth)) return null;
  const box = stage.getBoundingClientRect();
  const read = (name) => parseFloat(stage.style.getPropertyValue(name));
  const rect = {
    x: box.x + read("--frame-left"), y: box.y + read("--frame-top"),
    width: read("--frame-w"), height: read("--frame-h"),
  };
  return Object.values(rect).every(Number.isFinite) ? rect : null;
})()
"""

class StepClock:
    """The replay's clock, moved by the renderer instead of by time."""

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._now = 0.0
        self._asleep_at: float | None = None
        self._wants = math.inf
        self._finished = False

    def now(self) -> float:
        return self._now

    def sleep(self, seconds: float) -> None:
        with self._cond:
            at = self._now
            self._asleep_at, self._wants = at, seconds
            self._cond.notify_all()
            while self._now == at and not self._finished:
                self._cond.wait()
            self._asleep_at = None

    def advance(self, seconds: float) -> None:
        with self._cond:
            self._now += seconds
            self._cond.notify_all()

    def settle(self) -> float:
        """Wait until the replay has sent everything due now; return how long until it sends again."""
        with self._cond:
            while not self._finished and self._asleep_at != self._now:
                self._cond.wait()
            return math.inf if self._finished else self._wants

    def finish(self) -> None:
        """Stop pacing: whatever the replay still holds goes out at once."""
        with self._cond:
            self._finished = True
            self._now = math.inf
            self._cond.notify_all()


@dataclass(frozen=True)
class Picture:
    width: int
    height: int
    fps: Fraction
    frames: int
    own: bool = True


def find_chrome() -> str:
    given = os.environ.get("CHROME")
    for candidate in (given, *CHROME_PATHS):
        if candidate and Path(candidate).exists():
            return candidate
    for name in CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError(
        "rendering needs Chrome or Chromium; set CHROME to its executable")


def probe_picture(media: Path, fps: int = RENDER_FPS) -> Picture:
    """The recording's frame, and the rate captions are drawn at: `fps`, or the recording's own if that is higher."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate",
         "-show_entries", "format=duration", "-of", "json", str(media)],
        capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    if not data.get("streams"):
        width, height = CANVAS
        frames = math.ceil(float(data["format"]["duration"]) * fps)
        return Picture(width, height, Fraction(fps), frames, own=False)
    stream = data["streams"][0]
    rate = max(Fraction(stream["r_frame_rate"]), Fraction(fps))
    frames = math.ceil(float(data["format"]["duration"]) * rate)
    return Picture(int(stream["width"]), int(stream["height"]), rate, frames)


class _Page:
    """One Chrome tab, driven over the DevTools protocol."""

    def __init__(self, socket) -> None:
        self._socket = socket
        self._next = 0

    def call(self, method: str, until: str | None = None, **params) -> dict:
        self._next += 1
        mine = self._next
        self._socket.send(json.dumps({"id": mine, "method": method, "params": params}))
        result, seen = None, until is None
        while result is None or not seen:
            message = json.loads(self._socket.recv())
            if message.get("id") == mine:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error'].get('message')}")
                result = message.get("result", {})
            elif until is not None and message.get("method") == until:
                seen = True
        return result

    def value(self, expression: str):
        reply = self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        return reply.get("result", {}).get("value")

    def wait_for(self, expression: str, timeout_s: float, what: str):
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            got = self.value(expression)
            if got:
                return got
            time.sleep(0.05)
        raise RuntimeError(f"timed out waiting for {what}")

    def advance(self, seconds: float) -> None:
        self.call("Emulation.setVirtualTimePolicy",
                  until="Emulation.virtualTimeBudgetExpired",
                  policy="advance", budget=seconds * 1000.0)


def _debugger_url(port: int, timeout_s: float = 25.0) -> str:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as reply:
                for target in json.load(reply):
                    if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
                        return target["webSocketDebuggerUrl"]
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Chrome did not open its debugging port")


def _free_port() -> int:
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _await_delivery(page: _Page, event_id: int) -> None:
    wanted = str(event_id)
    deadline = time.monotonic() + DELIVERY_TIMEOUT_S
    while page.value("window.__renderLastId") != wanted:
        if time.monotonic() > deadline:
            raise RuntimeError("the studio stopped receiving the replay")
        time.sleep(0.002)


def _encoder(media: Path, picture: Picture, out: Path) -> subprocess.Popen:
    """ffmpeg, waiting for caption frames on stdin. A recording with no picture gets a black one."""
    size = f"{picture.width}:{picture.height}"
    captions = ["-f", "image2pipe", "-framerate", str(picture.fps), "-c:v", "png", "-i", "-"]
    if picture.own:
        inputs = ["-i", str(media), *captions]
        graph = (f"[0:v]fps={picture.fps}[picture];[1:v]scale={size}[captions];"
                 "[picture][captions]overlay=eof_action=pass[out]")
        sound = "0:a?"
    else:
        canvas = f"color=c=black:s={picture.width}x{picture.height}:r={picture.fps}"
        inputs = ["-f", "lavfi", "-i", canvas, *captions, "-i", str(media)]
        graph = f"[1:v]scale={size}[captions];[0:v][captions]overlay=shortest=1[out]"
        sound = "2:a"
    audio = ["-c:a", "copy"] if media.suffix.lower() in COPIED_AUDIO else [
        "-c:a", "aac", "-b:a", "192k"]
    return subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", graph,
         "-map", "[out]", "-map", sound, "-c:v", "libx264", "-crf", "18",
         "-pix_fmt", "yuv420p", *audio, "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)


def render_score(
    score: list[tuple[float, dict]],
    media: Path,
    out: Path,
    *,
    studio_url: str,
    publish: Callable[[dict], None],
    last_event_id: Callable[[], int],
    progress: Callable[[float], None] | None = None,
    progress_every_s: float = 10.0,
    fps: int = RENDER_FPS,
) -> dict:
    """Replay `score` to the studio's render channel and write the captioned recording."""
    from .score import replay_score

    clock = StepClock()

    def replay() -> None:
        try:
            for ev in replay_score(score, _clock=clock.now, _sleep=clock.sleep):
                publish(ev)
        finally:
            clock.finish()

    out.parent.mkdir(parents=True, exist_ok=True)
    thread = threading.Thread(target=replay, daemon=True)
    thread.start()
    try:
        return render_recording(
            media, out, studio_url=studio_url, clock=clock,
            last_event_id=last_event_id, progress=progress,
            progress_every_s=progress_every_s, fps=fps)
    finally:
        clock.finish()
        thread.join()


def render_recording(
    media: Path,
    out: Path,
    *,
    studio_url: str,
    clock: StepClock,
    last_event_id: Callable[[], int],
    progress: Callable[[float], None] | None = None,
    progress_every_s: float = 10.0,
    fps: int = RENDER_FPS,
) -> dict:
    """Play the recording through the studio on `clock` and write it out with its captions drawn on.

    The caller replays the recording to the studio's render channel on the
    same clock; this steps that clock and the page's together, one frame at a
    time. The page asks for the session without counting as a reload.
    """
    from websockets.sync.client import connect

    picture = probe_picture(media, fps)
    profile = tempfile.mkdtemp(prefix="weave-render-")
    port = _free_port()
    chrome = subprocess.Popen(
        [find_chrome(), *CHROME_FLAGS, f"--remote-debugging-port={port}",
         f"--window-size={WINDOW[0]},{WINDOW[1]}", f"--user-data-dir={profile}",
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    encoder = None
    try:
        with connect(_debugger_url(port), max_size=None) as socket:
            page = _Page(socket)
            page.call("Page.enable")
            page.call("Page.addScriptToEvaluateOnNewDocument", source=PAGE_SETUP)
            page.call("Emulation.setDefaultBackgroundColorOverride",
                      color={"r": 0, "g": 0, "b": 0, "a": 0})
            page.call("Page.navigate", url=studio_url)
            rect = page.wait_for(
                FRAME_RECT.replace("NEEDS_PICTURE", "true" if picture.own else "false"),
                120.0, "the studio to load the recording")
            page.call("Emulation.setVirtualTimePolicy", policy="pause")
            page.value("window.__renderHold()")
            until_next = clock.settle()
            with urllib.request.urlopen(f"{studio_url}runtime-config.json") as reply:
                delay_s = float(json.load(reply)["readAheadDelayMs"]) / 1000.0
            clip = {**rect, "scale": picture.height / rect["height"]}

            encoder = _encoder(media, picture, out)
            blank: bytes | None = None
            replayed = 0.0
            drawn = 0
            ahead_s: list[float] = []
            every = max(1, round(float(picture.fps) * progress_every_s))
            for frame in range(picture.frames):
                target = float(frame / picture.fps) + delay_s
                while target - replayed > 1e-9:
                    step = min(target - replayed, max(until_next, MIN_STEP_S))
                    sent = last_event_id()
                    page.advance(step)
                    clock.advance(step)
                    replayed += step
                    until_next = clock.settle()
                    if last_event_id() != sent:
                        _await_delivery(page, last_event_id())
                state = page.value("window.__renderSeek()")
                captioned = state["captioned"]
                if captioned or blank is None:
                    shot = base64.b64decode(page.call(
                        "Page.captureScreenshot", format="png", clip=clip,
                        optimizeForSpeed=True)["data"])
                    if captioned:
                        drawn += 1
                    else:
                        blank = shot
                else:
                    shot = blank
                try:
                    encoder.stdin.write(shot)
                except BrokenPipeError:
                    break
                wants = state.get("mediaS")
                if isinstance(wants, (int, float)) and wants > 0:
                    ahead_s.append(float(frame / picture.fps) - float(wants))
                if progress is not None and frame % every == 0:
                    progress(frame / picture.frames)
            try:
                encoder.stdin.close()
            except BrokenPipeError:
                pass
            if encoder.wait() != 0:
                raise RuntimeError("ffmpeg could not write the captioned video")
            encoder = None
    finally:
        if encoder is not None:
            encoder.kill()
        chrome.terminate()
        chrome.wait()
        shutil.rmtree(profile, ignore_errors=True)
    return {
        "frames": picture.frames,
        "frames_with_captions": drawn,
        "fps": float(picture.fps),
        "size": [picture.width, picture.height],
        "frame_ahead_of_studio_playhead_s": [
            round(min(ahead_s, default=0.0), 4), round(max(ahead_s, default=0.0), 4)],
    }
