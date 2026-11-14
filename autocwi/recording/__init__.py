"""Captioning a recording, as opposed to a room. Reasons and measurements: README.md in this package."""

from .captions import CAPTIONS_MAX_BYTES, RESTAGE, CaptionError, read_captions
from .desk import CaptionDesk, Play, Stop
from .direct import (
    LOUDNESS_PIVOT,
    assign_cues,
    direct,
    direct_recording,
    line_length,
    settle_speakers,
    soften,
)
from .display import video_motion
from .export import write_exports
from .media import MEDIA_MAX_BYTES, MEDIA_SUFFIXES, media_has_audio
from .pipeline import RecordingHooks, recording_events
from .recognizer import ScriptedRecognizer
from .render import StepClock, render_recording, render_score
from .score import analyse, build_media_score, replay_score
from .timing import ScriptWord, align_words, lead_in, romanize_hangul, snap_onsets
from .transcribe import transcribe_recording

__all__ = [
    "CAPTIONS_MAX_BYTES", "CaptionDesk", "CaptionError", "RESTAGE",
    "LOUDNESS_PIVOT", "MEDIA_MAX_BYTES", "MEDIA_SUFFIXES", "Play", "RecordingHooks",
    "ScriptWord", "ScriptedRecognizer", "StepClock", "Stop", "align_words",
    "analyse",
    "assign_cues", "build_media_score", "direct", "direct_recording", "lead_in",
    "line_length",
    "media_has_audio", "read_captions", "recording_events", "render_recording", "render_score",
    "replay_score", "romanize_hangul",
    "settle_speakers",
    "snap_onsets", "soften", "transcribe_recording", "video_motion",
    "write_exports",
]
