"""How a captioned recording moves on the stage, as the studio is told it."""

from __future__ import annotations

VIDEO_MOTION_DEFAULTS: dict[str, object] = {
    "cue_lead_ms": 250,
    "cue_hold_ms": 600,
    "lead_ms": 40,
    "rise_ms": 163,
    "fall_ms": 209,
    "crouch_em": 0.057,
    "crouch_ms": 130,
    "hold_trim_ms": 100,
    "hold_max_ms": 700,
    "hold_from_scale": 1.15,
    "hold_full_scale": 1.45,
    "shrink_hold_gain": 1.5,
    "shrink_below_scale": 0.98,
    "shrink_pre_ms": 40,
    "big_slowdown": 0.55,
    "slowdown_max_change": 1.2,
    "resize_from_change": 0.12,
    "lift_fade_scale": [1.1, 1.3],
    "held_lift_em": 0.45,
    "held_from_ms": 250,
    "held_per_char_ms": 60,
    "held_ramp_ms": 300,
    "held_max_ms": 1200,
    "held_turn_from": 0.5,
    "held_turn_fall_share": 0.4,
    "push_from_scale": 1.5,
    "push_full_scale": 1.9,
    "widen_max": 0.14,
    "widen_full_change": 0.9,
    "scale_range": [0.5, 2.0],
    "scale_points": [
        [0.0, -0.5], [0.08, -0.45], [0.14, 0.0], [0.26, 0.0],
        [0.45, 0.15], [0.75, 0.36], [1.0, 0.8],
    ],
}


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


def video_motion(settings: dict | None) -> dict[str, object]:
    """`motion.live_sync.video_motion`, complete and keyed the way the studio reads it."""
    given = settings or {}
    return {
        _camel(key): given.get(key, default)
        for key, default in VIDEO_MOTION_DEFAULTS.items()
    }
