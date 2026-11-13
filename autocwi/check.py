"""Check a caption file against what the design system asks of it."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from .schema import CaptionSpec

BOX_COLOR = "#000000"
MIN_CONTRAST = 3.0
MIN_COLOR_DISTANCE = 20.0
MAX_WORD_S = 3.0
MAX_LINE_CHARS = 54
DURATION_SLACK_S = 0.5
MIN_VARIED_SHARE = 0.10


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    message: str


def _rgb(color: str) -> tuple[float, float, float]:
    value = color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def contrast(color: str, against: str = BOX_COLOR) -> float:
    """WCAG contrast ratio between two #RRGGBB colours."""
    def luminance(c: str) -> float:
        r, g, b = (_linear(v) for v in _rgb(c))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    a, b = sorted((luminance(color), luminance(against)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def _lab(color: str) -> tuple[float, float, float]:
    r, g, b = (_linear(v) for v in _rgb(color))
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    fx, fy, fz = (
        v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116 for v in (x, y, z))
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def color_distance(a: str, b: str) -> float:
    """CIE76 distance; about 2 is just noticeable."""
    return sum((p - q) ** 2 for p, q in zip(_lab(a), _lab(b))) ** 0.5


def _lines(spec: CaptionSpec) -> list[list]:
    lines: list[list] = []
    for word in spec.words:
        if not lines or word.line_break:
            lines.append([])
        lines[-1].append(word)
    return lines


def _speaker_colors(spec: CaptionSpec):
    used = sorted({w.speaker for w in spec.words})
    for n, a in enumerate(used):
        ratio = contrast(spec.speakers[a].color)
        if ratio < MIN_CONTRAST:
            yield Finding("ATT-2", "warning",
                          f"{a} is {spec.speakers[a].color}, {ratio:.2f}:1 on the "
                          f"caption box; WCAG asks {MIN_CONTRAST:.0f}:1 of large text")
        for b in used[n + 1:]:
            ca, cb = spec.speakers[a].color, spec.speakers[b].color
            if ca == cb:
                yield Finding("ATT-1", "error", f"{a} and {b} share the colour {ca}")
            elif color_distance(ca, cb) < MIN_COLOR_DISTANCE:
                yield Finding("ATT-1", "warning",
                              f"{a} ({ca}) and {b} ({cb}) are {color_distance(ca, cb):.0f} "
                              f"apart; under {MIN_COLOR_DISTANCE:.0f} two voices read as one")


def _word_times(spec: CaptionSpec):
    previous = None
    for n, word in enumerate(spec.words):
        where = f'word {n} "{word.text}"'
        if word.end - word.start > MAX_WORD_S:
            yield Finding("SYN-2", "warning",
                          f"{where} lasts {word.end - word.start:.1f} s; its colour "
                          "turn is timed to the start, so check the start is real")
        if previous is not None and word.start < previous.start:
            yield Finding("SYN-1", "error",
                          f"{where} starts at {word.start}, before the word ahead of "
                          f"it ({previous.start})")
        if word.start > spec.media.duration + DURATION_SLACK_S:
            yield Finding("SYN-3", "error",
                          f"{where} starts at {word.start}, after the recording "
                          f"ends ({spec.media.duration:.2f})")
        previous = word


def _intonation(spec: CaptionSpec):
    baseline = spec.mapping.loudness_to
    if not spec.words or baseline.baseline is None:
        return
    rest = (baseline.baseline - baseline.min) / max(1e-9, baseline.max - baseline.min)
    varied = sum(1 for w in spec.words if abs(w.loudness - rest) > 0.02)
    share = varied / len(spec.words)
    if share < MIN_VARIED_SHARE:
        yield Finding("INT-1", "warning",
                      f"{share:.0%} of words leave the resting size; under "
                      f"{MIN_VARIED_SHARE:.0%} the size channel says nothing")


def _line_length(spec: CaptionSpec):
    for line in _lines(spec):
        text = " ".join(w.text for w in line)
        if len(text) > MAX_LINE_CHARS:
            yield Finding("LINE-1", "warning",
                          f'a caption line is {len(text)} characters '
                          f'(over {MAX_LINE_CHARS}): "{text[:40]}..."')


def _sounds(spec: CaptionSpec):
    for event in spec.events:
        if event.start > spec.media.duration + DURATION_SLACK_S:
            yield Finding("SND-1", "error",
                          f"sound [{event.label}] starts at {event.start}, after "
                          f"the recording ends ({spec.media.duration:.2f})")


RULES: tuple[tuple[str, str, Callable], ...] = (
    ("ATT", "2.1 one colour per speaker, told apart at a glance", _speaker_colors),
    ("SYN", "2.2 a word turns colour as it is spoken", _word_times),
    ("INT", "2.3 size and weight follow the voice", _intonation),
    ("LINE", "one caption line at a time", _line_length),
    ("SND", "2.4 sounds sit on the recording's timeline", _sounds),
)


def check_spec(data: dict) -> list[Finding]:
    try:
        spec = CaptionSpec.model_validate(data)
    except ValidationError as exc:
        return [
            Finding("SPEC", "error",
                    f"{'.'.join(str(p) for p in error['loc'])}: {error['msg']}")
            for error in exc.errors()
        ]
    return [finding for _, _, rule in RULES for finding in rule(spec)]


def check_file(path: str | Path) -> list[Finding]:
    return check_spec(json.loads(Path(path).read_text(encoding="utf-8")))


def report(findings: list[Finding]) -> str:
    lines = [f"{f.severity.upper():7s} {f.rule:6s} {f.message}" for f in findings]
    errors = sum(f.severity == "error" for f in findings)
    lines.append(f"{errors} errors, {len(findings) - errors} warnings")
    return "\n".join(lines)
