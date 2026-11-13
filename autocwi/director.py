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
    "arousal_low": 1.30,
    "arousal_high": 1.60,
    "pop_floor": 0.62,
    "calm_gain": 0.35,
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
        calm = LOUDNESS_PIVOT + (loudness - LOUDNESS_PIVOT) * float(cfg["calm_gain"])
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
