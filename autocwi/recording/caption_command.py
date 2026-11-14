"""`weave caption`: check the file, settle the language, run the stages, report."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .captions import CaptionError, read_captions
from .language import NAMES, LanguageUnclear, detect_language
from .report import (
    NothingToCaption,
    Reporter,
    inspect_media,
    quiet,
    tooling_problem,
)

LOG = "caption.log"


def caption(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    media = Path(args.file)
    problem = tooling_problem(draw=not args.no_video)
    try:
        duration_s = None if problem else inspect_media(media)
        if not problem and args.captions:
            read_captions(args.captions)
    except CaptionError as exc:
        problem = str(exc)
    if problem:
        print(f"weave: {problem}", file=sys.stderr)
        return 1
    if args.verbose:
        try:
            _run(args, parser, media, None)
            return 0
        except CaptionError as exc:
            print(f"weave: {exc}", file=sys.stderr)
            return 1
    out = Path(args.out)
    log = out / LOG
    try:
        out.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"weave: cannot write to {out}: {exc.strerror or exc}", file=sys.stderr)
        return 1
    empty = False
    with quiet(log) as (stdout, stderr):
        reporter = Reporter(stdout)
        reporter.title(media.name, duration_s)
        try:
            _run(args, parser, media, reporter)
        except NothingToCaption as exc:
            print(f"weave: {exc}", file=stderr)
            empty = True
        except CaptionError as exc:
            print(f"weave: {exc}", file=stderr)
            return 1
        except KeyboardInterrupt:
            print("weave: stopped.", file=stderr)
            return 1
        except (Exception, SystemExit) as exc:
            reason = str(exc) or type(exc).__name__
            print(f"weave: could not caption {media.name}: {reason}", file=stderr)
            print(f"The details are in {log}.", file=stderr)
            return 1
    log.unlink(missing_ok=True)
    if empty:
        (out / "live_events.jsonl").unlink(missing_ok=True)
        if not any(out.iterdir()):
            out.rmdir()
        return 1
    return 0


def _run(args, parser, media: Path, reporter: Reporter | None) -> None:
    from ..config import load_config
    from ..device import pick_device, seed_everything
    from ..live import run_live

    cfg = load_config(None)
    seed_everything(cfg["seed"])
    device = pick_device()
    cache: dict = {}
    language = args.lang
    if language is None:
        if reporter:
            reporter.stage("language")
        try:
            found = detect_language(media, cfg, cache)
        except LanguageUnclear as exc:
            raise CaptionError(
                f"could not tell the language of {media.name}: {exc}. "
                "Pass --lang en, ko or multi.") from exc
        language = found.language
        note = ("no speech heard" if not found.heard_speech
                else f"{NAMES[language]}, {found.confidence:.0%} sure")
        if reporter:
            reporter.detail(note)
        else:
            print(f"[caption] language detected: {note}")
    elif reporter:
        reporter.say(f"  Language: {NAMES[language]}")
    live_args = parser.parse_args([
        "live", "--import", args.file, "--lang", language, "--out", args.out,
        "--once" if args.no_video else "--render",
        *(["--captions", args.captions] if args.captions else []),
        *(["--fps", str(args.fps)] if args.fps else [])])
    live_args.recording_cache = cache
    live_args.reporter = reporter
    if reporter:
        reporter.stage("loading")
    run_live(live_args, cfg, device)
    if reporter is None:
        return
    if reporter.empty:
        reporter.discard_exports()
        raise NothingToCaption(
            f"nothing to caption in {media.name}. No speech and no sounds "
            "were found, so nothing was written.")
    if not args.no_video and reporter.video is None:
        raise CaptionError(f"the captioned video for {media.name} was not written.")
    reporter.finish()
