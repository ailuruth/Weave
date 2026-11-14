"""Make the Weave brand film from the studio's own pages.

    .venv/bin/python brand/film/make_film.py [hero|cards|captions|ui|cut ...]

With no part named it makes every part and cuts the film. It needs a gate
server (`autocwi live`), a studio on the film's own clip, and that clip
captioned at 4K. `brand/film/README.md` has the commands.
"""
from __future__ import annotations

import base64
import io
import json
import math
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]
WORK = Path("/tmp/weave-film")
PARTS = WORK / "parts"
OUT = ROOT / "out" / "brand" / "weave-film.mp4"
GATE_URL = "http://127.0.0.1:7352/"
STUDIO_URL = "http://127.0.0.1:7353/"
CAPTIONED = WORK / "cap4k" / "exports" / "weave-voice-4k.captioned.mp4"
CARDS = Path(__file__).with_name("cards.html")

FPS = 30
SIZE = (1920, 1080)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_FLAGS = (
    "--headless=new", "--no-first-run", "--hide-scrollbars", "--mute-audio",
    "--disable-threaded-animation", "--disable-threaded-scrolling",
    "--run-all-compositor-stages-before-draw", "--disable-checker-imaging",
    "--disable-frame-rate-limit",
)

HERO_S = 15.0
CAPTIONS_S = 10.3
UI_S = 4.6
LINES = (
    ("card-voice", "Captions that carry the voice.", 2.4),
    ("card-edit", "Change any word.", 1.8),
    ("card-see", "See how it was said.", 2.4),
)
LOCKUP_S = 2.8
CUT = ("hero", "card-voice", "captions", "card-edit", "ui", "card-see", "lockup")

CURSOR = (
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' "
    "viewBox='0 0 24 24'><path d='M5 3l14 8-6.2 1.6L9.6 19z' fill='white' stroke='black' "
    "stroke-width='1.4' stroke-linejoin='round'/></svg>"
)


def smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * x * (x * (6 * x - 15) + 10)


class Page:
    def __init__(self, port: int) -> None:
        self.profile = tempfile.mkdtemp(prefix="weave-film-")
        self.chrome = subprocess.Popen(
            [CHROME, *CHROME_FLAGS, f"--remote-debugging-port={port}",
             f"--window-size={SIZE[0]},{SIZE[1]}", f"--user-data-dir={self.profile}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = None
        for _ in range(120):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                pages = [tab for tab in tabs if tab["type"] == "page"]
                if pages:
                    url = pages[0]["webSocketDebuggerUrl"]
                    break
            except OSError:
                pass
            time.sleep(0.25)
        if url is None:
            raise SystemExit("Chrome did not start")
        self.socket = connect(url, max_size=None)
        self.sent = 0
        self.call("Page.enable")

    def call(self, method: str, until: str | None = None, **params):
        self.sent += 1
        self.socket.send(json.dumps({"id": self.sent, "method": method, "params": params}))
        result, seen = None, until is None
        while result is None or not seen:
            message = json.loads(self.socket.recv())
            if message.get("id") == self.sent:
                result = message.get("result", message)
            elif message.get("method") == until:
                seen = True
        return result

    def js(self, expression: str):
        reply = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        return reply.get("result", {}).get("value")

    def metrics(self, width: int, height: int, scale: float) -> None:
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height,
                  deviceScaleFactor=scale, mobile=False)

    def goto(self, url: str) -> None:
        self.call("Page.navigate", url=url)

    def wait(self, expression: str, seconds: float = 60.0) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.js(expression):
                return
            time.sleep(0.25)
        raise SystemExit(f"never true: {expression}")

    def hold(self) -> None:
        self.call("Emulation.setVirtualTimePolicy", policy="pause")

    def step(self, ms: float) -> None:
        self.call("Emulation.setVirtualTimePolicy", until="Emulation.virtualTimeBudgetExpired",
                  policy="advance", budget=ms)

    def shot(self, clip: dict | None = None) -> bytes:
        params = {"format": "png"}
        if clip:
            params["clip"] = clip
        return base64.b64decode(self.call("Page.captureScreenshot", **params)["data"])

    def mouse(self, kind: str, x: float, y: float, **more) -> None:
        self.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, **more)

    def click(self, x: float, y: float) -> None:
        self.mouse("mouseMoved", x, y)
        self.mouse("mousePressed", x, y, button="left", buttons=1, clickCount=1)
        time.sleep(0.06)
        self.mouse("mouseReleased", x, y, button="left", buttons=0, clickCount=1)

    def centre(self, selector: str, nth: int = 0):
        return self.js(
            f"(()=>{{const e=document.querySelectorAll({json.dumps(selector)})[{nth}];"
            "if(!e)return null;const r=e.getBoundingClientRect();"
            "return [r.x+r.width/2,r.y+r.height/2,r.width,r.height]})()")

    def close(self) -> None:
        self.chrome.terminate()


class Encoder:
    def __init__(self, name: str) -> None:
        PARTS.mkdir(parents=True, exist_ok=True)
        self.path = PARTS / f"{name}.mp4"
        self.pipe = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png",
             "-i", "-", "-vf", f"scale={SIZE[0]}:{SIZE[1]}:flags=lanczos", "-c:v", "libx264",
             "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS), str(self.path)],
            stdin=subprocess.PIPE)
        self.frames = 0

    def add(self, png: bytes) -> None:
        self.pipe.stdin.write(png)
        self.frames += 1

    def done(self) -> None:
        self.pipe.stdin.close()
        self.pipe.wait()
        print(f"  {self.path.name}: {self.frames} frames, {self.frames / FPS:.1f} s")


def along(keys: list[tuple[float, float, float]], t: float) -> tuple[float, float] | None:
    if t < keys[0][0] or t > keys[-1][0]:
        return None
    for (t0, x0, y0), (t1, x1, y1) in zip(keys, keys[1:]):
        if t <= t1:
            k = smooth((t - t0) / max(1e-6, t1 - t0))
            return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
    return keys[-1][1], keys[-1][2]


def hero() -> None:
    page = Page(9601)
    try:
        page.metrics(*SIZE, 1)
        page.goto(GATE_URL)
        page.wait("document.querySelectorAll('.gate-language').length >= 3"
                  " && !!document.querySelector('.gate-word h1')?.style.getPropertyValue('--fit')")
        time.sleep(2.5)
        page.mouse("mouseMoved", 960, 120)
        page.js(
            "(()=>{const c=document.createElement('img');c.id='film-cursor';"
            f"c.src={json.dumps(CURSOR)};"
            "c.style.cssText='position:fixed;left:0;top:0;z-index:99999;pointer-events:none;"
            "width:28px;height:28px;display:none';document.body.appendChild(c)})()")
        letter = page.centre(".gate-word h1 span", 0)
        english, korean, both = (page.centre(".gate-language", n) for n in range(3))
        wx, wy = letter[0] - letter[2] * 0.02, letter[1] + letter[3] * 0.05
        path = [
            (7.6, 1420, 560), (8.5, english[0], english[1] + 6), (10.0, english[0], english[1] + 6),
            (10.7, korean[0], korean[1] + 6), (12.0, korean[0], korean[1] + 6),
            (12.7, both[0], both[1] + 6), (13.8, both[0], both[1] + 6), (14.5, 1180, 470),
        ]
        close, far = 300.0, float(SIZE[0])
        page.hold()
        film = Encoder("hero")
        for frame in range(round(HERO_S * FPS)):
            t = frame / FPS
            at = along(path, t)
            if at:
                page.js(f"(()=>{{const c=document.getElementById('film-cursor');c.style.display='block';"
                        f"c.style.transform='translate({at[0] - 5:.1f}px,{at[1] - 3:.1f}px)'}})()")
                page.mouse("mouseMoved", at[0], at[1])
            elif t > path[-1][0]:
                page.js("document.getElementById('film-cursor').style.display='none'")
                page.mouse("mouseMoved", 960, 120)
            page.step(1000 / FPS)
            drift = close * (1 + 0.1 * min(1.0, t / 1.2))
            k = smooth((t - 1.2) / 3.4)
            width = math.exp(math.log(drift) + (math.log(far) - math.log(drift)) * k)
            share = (far - width) / (far - close)
            cx = SIZE[0] / 2 + (wx - SIZE[0] / 2) * share
            cy = SIZE[1] / 2 + (wy - SIZE[1] / 2) * share
            height = width * SIZE[1] / SIZE[0]
            x = min(max(0.0, cx - width / 2), SIZE[0] - width)
            y = min(max(0.0, cy - height / 2), SIZE[1] - height)
            film.add(page.shot({"x": x, "y": y, "width": width, "height": height, "scale": SIZE[0] / width}))
        film.done()
    finally:
        page.close()


def cards() -> None:
    page = Page(9602)
    try:
        page.metrics(*SIZE, 1)
        page.goto(CARDS.as_uri())
        page.wait("typeof window.film === 'function'")
        page.js("document.fonts.load('500 88px \"Roboto Flex Film\"').then(()=>1)")
        time.sleep(0.5)
        for name, text, seconds in LINES:
            film = Encoder(name)
            for frame in range(round(seconds * FPS)):
                page.js(f"window.film('line', {json.dumps(text)}, {frame / FPS:.4f})")
                film.add(page.shot())
            film.done()
        film = Encoder("lockup")
        for frame in range(round(LOCKUP_S * FPS)):
            page.js(f"window.film('lockup', '', {frame / FPS:.4f})")
            film.add(page.shot())
        film.done()
    finally:
        page.close()


def captions() -> None:
    probe = WORK / "caption-probe.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "2.4", "-i", str(CAPTIONED), "-frames:v", "1",
                    str(probe)], check=True)
    box = Image.open(probe).convert("L").point(lambda v: 255 if v > 40 else 0).getbbox()
    if box is None:
        raise SystemExit("no caption found in the captioned clip")
    cy = (box[1] + box[3]) / 2
    width = max(2200, int((box[2] - box[0]) / 0.8 / 2) * 2)
    height = width * SIZE[1] // SIZE[0]
    x = (3840 - width) // 2
    y = int(cy - height / 2)
    PARTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-t", str(CAPTIONS_S), "-i", str(CAPTIONED), "-an", "-vf",
         f"pad=3840:{max(2160, y + height)}:0:0:black,crop={width}:{height}:{x}:{y},"
         f"scale={SIZE[0]}:{SIZE[1]}:flags=lanczos,fps={FPS}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
         str(PARTS / "captions.mp4")], check=True)
    print(f"  captions.mp4: a {width}x{height} window at {x},{y}, {CAPTIONS_S} s")


def ui() -> None:
    page = Page(9603)
    view, scale = (1440, 810), 4
    try:
        page.metrics(*view, scale)
        page.goto(STUDIO_URL)
        page.wait("!!document.querySelector('.timeline-line')")
        time.sleep(2.0)
        if page.js("document.querySelector('.timeline-play')?.getAttribute('aria-label')") == "Pause":
            page.click(*page.centre(".timeline-play")[:2])
        page.click(*page.centre("[aria-label='Edit captions']")[:2])
        time.sleep(0.8)
        page.click(*page.centre(".caption-list li", 2)[:2])
        time.sleep(1.0)
        page.click(*page.centre(".timeline-play")[:2])
        time.sleep(0.55)
        page.click(*page.centre(".timeline-play")[:2])
        time.sleep(0.4)
        page.click(*page.centre(".strip-word", 0)[:2])
        time.sleep(0.6)
        page.mouse("mouseMoved", 700, 20)
        time.sleep(0.5)
        still = Image.open(io.BytesIO(page.shot())).convert("RGB")
        panel = page.centre(".inspector")
    finally:
        page.close()
    still.save(WORK / "ui-still.png")
    wide = (view[0] / 2, view[1] / 2, float(view[0]))
    near_w = 620.0
    near = (min(view[0] - near_w / 2, panel[0]), max(near_w * 9 / 32, panel[1] - panel[3] * 0.18), near_w)
    film = Encoder("ui")
    for frame in range(round(UI_S * FPS)):
        k = smooth((frame / FPS - 0.9) / 2.6)
        w = min(wide[2], math.exp(math.log(wide[2]) + (math.log(near[2]) - math.log(wide[2])) * k))
        share = (wide[2] - w) / (wide[2] - near[2])
        cx = wide[0] + (near[0] - wide[0]) * share
        cy = wide[1] + (near[1] - wide[1]) * share
        h = w * 9 / 16
        x = max(0.0, min(cx - w / 2, view[0] - w))
        y = max(0.0, min(cy - h / 2, view[1] - h))
        crop = still.resize(SIZE, Image.LANCZOS, box=(x * scale, y * scale, (x + w) * scale, (y + h) * scale))
        buffer = io.BytesIO()
        crop.save(buffer, "PNG", compress_level=1)
        film.add(buffer.getvalue())
    film.done()


def cut() -> None:
    listing = WORK / "cut.txt"
    listing.write_text("".join(f"file '{PARTS / name}.mp4'\n" for name in CUT))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an", str(OUT)], check=True)
    seconds = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(OUT)],
        capture_output=True, text=True, check=True).stdout.strip()
    print(f"wrote {OUT} ({float(seconds):.1f} s)")


MAKERS = {"hero": hero, "cards": cards, "captions": captions, "ui": ui, "cut": cut}

if __name__ == "__main__":
    for part in sys.argv[1:] or list(MAKERS):
        print(part)
        MAKERS[part]()
