"""Decisions about a recording that need the whole sentence."""

from __future__ import annotations

from collections import defaultdict

LOUDNESS_PIVOT = 2.0 / 9.0

DEFAULTS = {
    "enabled": True,
    "arousal_low": 1.40,
    "arousal_high": 2.50,
    "pop_floor": 0.75,
    "calm_gain": 0.20,
    "standout_low_db": 3.5,
    "standout_high_db": 5.0,
    "standout_low_loudness": 0.85,
    "standout_high_loudness": 0.95,
}


def _smoothstep(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def sentence_arousal(words: list[dict]) -> float | None:
    """Mean of each voiced word's pitch over its speaker's register."""
    ratios = [
        float(w["pitch_hz"]) / float(w["pitch_register_hz"])
        for w in words
        if float(w.get("pitch_hz") or 0) > 0
        and float(w.get("pitch_register_hz") or 0) > 0
    ]
    return sum(ratios) / len(ratios) if ratios else None


def direct_recording(words: list[dict], settings: dict | None = None) -> list[dict]:
    """Return ``words`` with `loudness` re-decided sentence by sentence."""
    cfg = {**DEFAULTS, **(settings or {})}
    if not cfg["enabled"]:
        return words
    low, high = float(cfg["arousal_low"]), float(cfg["arousal_high"])
    sentences: dict[object, list[dict]] = defaultdict(list)
    for word in words:
        sentences[word.get("utterance")].append(word)
    medians: dict[object, float] = {}
    for key, group in sentences.items():
        levels = sorted(float(w["loudness_db"]) for w in group
                        if w.get("loudness_db") is not None)
        if levels:
            medians[key] = levels[len(levels) // 2]
    s_low, s_high = float(cfg["standout_low_db"]), float(cfg["standout_high_db"])

    def standout(word: dict) -> float:
        median = medians.get(word.get("utterance"))
        if median is None or word.get("loudness_db") is None:
            return 0.0
        over = float(word["loudness_db"]) - median
        by_sentence = _smoothstep((over - s_low) / max(1e-6, s_high - s_low))
        level = float(word.get("loudness") or 0.0)
        by_speaker = _smoothstep(
            (level - float(cfg["standout_low_loudness"]))
            / max(1e-6, float(cfg["standout_high_loudness"])
                  - float(cfg["standout_low_loudness"])))
        return max(by_sentence, by_speaker)

    gates: dict[object, float | None] = {}
    for key, group in sentences.items():
        arousal = sentence_arousal(group)
        gates[key] = (
            None if arousal is None
            else _smoothstep((arousal - low) / max(1e-6, high - low))
        )

    directed: list[dict] = []
    for word in words:
        gate = gates[word.get("utterance")]
        loudness = word.get("loudness")
        if gate is None or loudness is None or loudness <= LOUDNESS_PIVOT:
            directed.append(word)
            continue
        loudness = float(loudness)
        keep = float(cfg["calm_gain"])
        keep += (1.0 - keep) * standout(word)
        calm = LOUDNESS_PIVOT + (loudness - LOUDNESS_PIVOT) * keep
        aroused = max(loudness, float(cfg["pop_floor"]))
        directed.append({
            **word,
            "loudness": round(calm + (aroused - calm) * gate, 4),
            "loudness_measured": loudness,
            "sentence_arousal": round(gate, 3),
        })
    for i, word in enumerate(directed):
        gate = gates[word.get("utterance")]
        loudness = word.get("loudness")
        if gate and loudness is not None and loudness <= LOUDNESS_PIVOT:
            floor = float(cfg["pop_floor"])
            directed[i] = {
                **word,
                "loudness": round(float(loudness) + (floor - float(loudness)) * gate, 4),
                "loudness_measured": float(loudness),
                "sentence_arousal": round(gate, 3),
            }
    return directed


CUE_MAX_CHARS = 54
CUE_MIN_CHARS = 20
WIDE_ASPECT = 16 / 9


def line_length(aspect: float | None, base: int = CUE_MAX_CHARS) -> int:
    """How many characters a caption line may hold in a frame of this shape."""
    if not aspect or aspect >= WIDE_ASPECT:
        return base
    return max(CUE_MIN_CHARS, round(base * (aspect / WIDE_ASPECT) ** 0.5))
_LEADS_ON = frozenset(
    "a an the to of in on at by for with and but or so that what which who "
    "when where how if as is are was were be i you he she we they it my your "
    "his her our their this these those".split())
_CLAUSE_END = (",", ";", ":", "\u2014", "\u2013")


def _cue_text_len(words: list[dict]) -> int:
    return sum(len(str(w.get("text", ""))) for w in words) + max(0, len(words) - 1)


def _word_end_s(word: dict) -> float:
    return float(word.get("t", 0.0)) + max(
        0.0, float(word.get("end", 0.0)) - float(word.get("start", 0.0)))


def _split_line(words: list[dict], max_chars: int) -> list[list[dict]]:
    if len(words) < 2 or _cue_text_len(words) <= max_chars:
        return [words]
    total = _cue_text_len(words)
    best, best_cost = 1, float("inf")
    for i in range(1, len(words)):
        left, right = words[:i], words[i:]
        cost = abs(_cue_text_len(left) - _cue_text_len(right)) / total
        prev, nxt = words[i - 1], words[i]
        if str(prev.get("text", "")).rstrip().endswith(_CLAUSE_END):
            cost -= 0.6
        if prev.get("speaker") != nxt.get("speaker"):
            cost -= 0.8
        cost -= min(0.5, max(0.0, float(nxt.get("t", 0.0)) - _word_end_s(prev)) * 1.5)
        if str(prev.get("text", "")).strip(".,;:!?\"'").lower() in _LEADS_ON:
            cost += 0.25
        if cost < best_cost:
            best, best_cost = i, cost
    return (_split_line(words[:best], max_chars)
            + _split_line(words[best:], max_chars))


def assign_cues(words: list[dict], max_chars: int = CUE_MAX_CHARS) -> list[dict]:
    """Give every word the number of the caption line it is shown in."""
    out: list[dict] = []
    cue = 0
    i = 0
    while i < len(words):
        j = i
        while j < len(words) and words[j].get("utterance") == words[i].get("utterance"):
            j += 1
        for line in _split_line(words[i:j], max_chars):
            out.extend({**word, "cue": cue} for word in line)
            cue += 1
        i = j
    return out


def soften(
    words: list[dict],
    *,
    below_db: float = 6.0,
    quiet_edge: float = 0.14,
    min_run: int = 2,
) -> list[dict]:
    """Only a voice that STAYS soft draws small type."""

    out = list(words)
    i = 0
    while i < len(words):
        j = i
        while j < len(words) and words[j].get("utterance") == words[i].get("utterance"):
            j += 1
        group = words[i:j]
        levels = sorted(float(w["loudness_db"]) for w in group
                        if w.get("loudness_db") is not None)
        median = levels[len(levels) // 2] if levels else None

        def hushed(word: dict) -> bool:
            return (median is not None
                    and word.get("loudness") is not None
                    and word.get("loudness_db") is not None
                    and float(word["loudness"]) < quiet_edge
                    and float(word["loudness_db"]) <= median - below_db)

        soft: set[int] = set()
        k = 0
        while k < len(group):
            if not hushed(group[k]):
                k += 1
                continue
            m = k
            while (m + 1 < len(group) and hushed(group[m + 1])
                   and group[m + 1].get("cue") == group[k].get("cue")):
                m += 1
            if m - k + 1 >= min_run and (m - k + 1) * 2 < len(group):
                soft.update(range(k, m + 1))
            k = m + 1
        for n, word in enumerate(group):
            level = word.get("loudness")
            if n in soft:
                out[i + n] = {**word, "soft": True}
            elif level is not None and float(level) < LOUDNESS_PIVOT:
                out[i + n] = {
                    **word,
                    "loudness": round(LOUDNESS_PIVOT, 4),
                    "loudness_measured": word.get("loudness_measured", float(level)),
                }
        i = j
    return out


def settle_speakers(words: list[dict], min_share: float = 0.6) -> list[dict]:
    """One sentence, one speaker -- where the sentence clearly has one."""
    out = list(words)
    i = 0
    while i < len(words):
        j = i
        while j < len(words) and words[j].get("utterance") == words[i].get("utterance"):
            j += 1
        counts: dict[str, int] = {}
        for word in words[i:j]:
            if word.get("speaker"):
                counts[word["speaker"]] = counts.get(word["speaker"], 0) + 1
        if counts:
            top, n = max(counts.items(), key=lambda item: item[1])
            if n / sum(counts.values()) >= min_share:
                for k in range(i, j):
                    if out[k].get("speaker") != top:
                        out[k] = {**out[k], "speaker": top, "speaker_known": True,
                                  "speaker_status": "corrected"}
        i = j
    spans: list[tuple[int, int]] = []
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j].get("utterance") == out[i].get("utterance"):
            j += 1
        spans.append((i, j))
        i = j
    for n, (a0, b0) in enumerate(spans):
        if any(w.get("speaker") for w in out[a0:b0]):
            continue
        donor = None
        if n + 1 < len(spans):
            nxt = out[spans[n + 1][0]]
            if (nxt.get("speaker") and float(nxt.get("t", 0.0))
                    - float(out[b0 - 1].get("t", 0.0)) <= 4.0):
                donor = nxt["speaker"]
        if donor is None and n > 0:
            prev = out[spans[n - 1][1] - 1]
            if (prev.get("speaker") and float(out[a0].get("t", 0.0))
                    - float(prev.get("t", 0.0)) <= 4.0):
                donor = prev["speaker"]
        if donor:
            for k in range(a0, b0):
                out[k] = {**out[k], "speaker": donor, "speaker_known": True,
                          "speaker_status": "corrected"}
    return out


def direct(words: list[dict], settings: dict | None = None) -> list[dict]:
    """Every sentence-level decision about a recording, in order."""
    cfg = settings or {}
    soft = cfg.get("soft") or {}
    words = settle_speakers(words, float(cfg.get("speaker_min_share", 0.6)))
    words = direct_recording(words, cfg)
    words = assign_cues(words, int(cfg.get("cue_max_chars", CUE_MAX_CHARS)))
    return soften(
        words,
        below_db=float(soft.get("below_db", 6.0)),
        quiet_edge=float(soft.get("quiet_edge", 0.14)),
        min_run=int(soft.get("min_run", 2)),
    )
