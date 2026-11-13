"""Which words pop: decided per SENTENCE, once the whole recording is known.

The live studio sizes each word from that word's own loudness, because a live
word has to be drawn before its sentence is over. Scored against the hand
reading of the PR film from 0:28 (65 labelled words: 24 pop, 41 lift), that
rule is the weakest thing on the stage:

                                             AUC   held-out accuracy
    word loudness (the live rule)            0.80        77%
    word pitch over the speaker's register   0.89        72%
    SENTENCE mean pitch over register        0.91        88%  (precision 100%)

and for the film's bold lines, sentence-level vocal force separates 12 bold
words from 53 at AUC 1.00. ("Held-out": each caption line was scored with a
threshold chosen on the others.)

THE FILM DECIDES BY THE LINE. A shouted line pops on every word, including
its quietest ("To do" at 0.18 loudness pops; "I've" at 1.00 in a calm line
does not). What marks such a line is not level -- the film is mastered, and
a calm interview and a drill sergeant sit within 4 dB of each other -- but
how far the speaker's pitch has risen above their own normal. Raised pitch
is what raised vocal effort sounds like, and it survives mastering.

So for a recording, where the sentence IS known before anything is drawn:

  * an aroused sentence lifts every word in it to at least `pop_floor`;
  * a calm sentence keeps its words' own differences but shrinks them toward
    the 2.3.5 baseline (`calm_gain`), so a loud syllable in ordinary speech
    is a larger lift, not a pop.

It is still proportional -- no word is switched on or off -- and it only
rewrites `loudness`, the normalised channel the stage sizes from.
`loudness_db` stays the measurement, the original value is kept in
`loudness_measured`, and the quiet half (words below the baseline) is not
touched at all.

WHAT THIS DOES NOT SOLVE, and no audio rule will: emphasis INSIDE a calm
sentence. The film pops `wow wow … my God … feel` in a line where the loudest
word (`oh`) only lifts and `God` is among the quietest. That is a captioner
reading the words, and it is 6 of the 65 labelled words.

THE THRESHOLDS ARE FITTED TO ONE FILM, TWELVE LINES. On it the calm lines
sit at or below 1.18 and the aroused ones at or above 1.68, so the gate is
placed in the gap between them; nothing says where another film's gap is.
"""

from __future__ import annotations

from collections import defaultdict

# Where the 2.3.5 baseline sits on the normalised loudness channel:
# (5% - 3%) / (12% - 3%). Must match `LOUDNESS_PIVOT` in caption-motion.ts.
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
    """Mean of each voiced word's pitch over its speaker's register.

    None when no word in the sentence has both a pitch and a register -- an
    unmeasured sentence is left exactly as it was, never guessed at.
    """

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
    # A WORD THAT STANDS OUT FROM ITS OWN SENTENCE KEEPS ITS SIZE (2026-11-13).
    # `calm_gain` was fitted while word times were Whisper's, which put
    # "louder" 0.7 s early and measured it at the line's average. Re-timed by
    # forced alignment, the narrator's "louder" is +5.0 dB over its sentence
    # and the interviewee's "wow, wow" +6.3 and +4.7 dB -- the three words the
    # film makes largest in a calm line -- and flattening every calm sentence
    # was flattening exactly them. What the film leaves alone at high level
    # ("Star" +4.3, "read" +3.6, "rescue" +3.5) sits just under; the ramp
    # between `standout_low_db` and `standout_high_db` is placed across that
    # gap, which is as narrow as it sounds and comes from one film.
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
        # ...OR FROM ITS SPEAKER'S WHOLE RANGE. dB over the sentence depends on
        # where the sentence happens to be cut: "louder" was +5.0 dB over a
        # 67-word run and +4.0 dB over its own sentence, the same audio, and
        # fell through the ramp. `loudness` is already normalised against
        # everything that speaker has said, and "louder" (0.99) and "wow"
        # (1.00, 0.97) are at the top of it whichever way the text is cut.
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
    # A quiet word in an aroused sentence still pops in the film ("To do").
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


# ---------------------------------------------------------------------------
# Caption lines
# ---------------------------------------------------------------------------

# The film's longest caption is 50 characters ("I've seen Forrest Gump many
# times but now I'm like"), on one line at 4.2% of the frame height. A little
# room above that, because a recognizer punctuates where the film did not.
CUE_MAX_CHARS = 54
# A line does not end on a word that belongs to what follows it.
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
        # Where a captioner breaks: after a clause, at a pause, or where the
        # speaker changes -- in that order of how much each is worth.
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
    """Give every word the number of the caption line it is shown in.

    A caption on a film is one line, on screen whole, replaced by the next.
    A sentence is the unit (the recognizer's utterances are sentences for a
    recording), and one too long for a line is split where a captioner would
    split it. The film does exactly this: "I've seen Forrest Gump many times
    but now I'm like" / "wow wow oh my God I can feel so much more." is one
    spoken sentence on two captions.
    """

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


# ---------------------------------------------------------------------------
# Speakers
# ---------------------------------------------------------------------------

def soften(
    words: list[dict],
    *,
    below_db: float = 6.0,
    quiet_edge: float = 0.14,
    min_run: int = 2,
) -> list[dict]:
    """Only a voice that STAYS soft draws small type.

    The quiet half of the size range was opened so that "softer" could
    shrink, and it then shrank everything quiet: watched over the whole PR
    film, 29 of 173 words (17%) were drawn small -- "so", "as", "text",
    "you", "the", the whole of "I'll show you." -- and every caption that
    ended on one stayed shrunk. The film shrinks one phrase. An unstressed
    word is quieter than its neighbours in ordinary speech; that is rhythm,
    not a speaker dropping their voice. (This is the deadband the live stage
    already learned it needed, at 48% of words; opening the range again
    without one reproduced the same instability.)

    What "or softer" has that the others do not is that the drop is
    SUSTAINED: two words in a row, each well under the sentence. So a word
    is drawn soft only when it sits in a run of `min_run` or more
    consecutive words that are each `below_db` under their sentence's median
    level and below `quiet_edge` on the normalised channel -- and the run is
    less than half the sentence, because a sentence that is quiet throughout
    is a quiet speaker or a quiet scene, not a contrast. On the film that
    leaves exactly "or softer." (-12 and -7 dB). Run it AFTER `assign_cues`:
    a run does not cross from one caption line into the next.

    Every other word below the 2.3.5 baseline is raised to it. The
    measurement stays in `loudness_measured`.
    """

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
            # A run stays on ONE caption line. "…text animation, / so captions…"
            # is one spoken sentence on two captions; its last word and the
            # next line's first are both unstressed, and across the break
            # they made a "run" of two that shrank the end of one caption and
            # the start of the next.
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
    """One sentence, one speaker -- where the sentence clearly has one.

    The tracker attributes word by word, and on a quiet or short word it can
    hand two words of a line to somebody else: the film's "so you can feel
    when my voice gets louder or softer." came out with "or softer." in a
    second speaker's colour, because those are the quietest words in it. A
    live stage has to live with that; a recording knows the whole sentence.

    Only a sentence where one speaker already holds `min_share` of the
    attributed words is settled, so a sentence that really is shared -- or
    that the tracker is honestly split on -- is left exactly as it came.
    """

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
    # A SENTENCE NOBODY WAS HEARD SAYING takes its neighbour's speaker. The
    # film's first caption, "Synchronization.", is one word before the tracker
    # has anyone enrolled; it stayed in read-ahead white for its whole life.
    # The sentence after it, if it follows closely, is the same voice.
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
