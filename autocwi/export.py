"""Hand an analysed recording's captions to a person, in files they can open.

Three files, because three different readers:

  .srt        SubRip. Every caption tool, editor and player reads it. Text
              and line timing only -- the lowest common denominator, and the
              one a captioner will actually load first.
  .vtt        WebVTT, the web's caption format. Same lines, plus what SubRip
              cannot hold: who is speaking (`<v S1>`, coloured in a STYLE
              block with the CWI palette), when each WORD starts (inline
              timestamps, which is how WebVTT spells CWI 2.2.2's word sync),
              and which words are loud or soft (`<c.loud>`, `<c.soft>`).
  .cwi.json   This project's own CaptionSpec (`autocwi/schema.py`): every
              word with its measurements. The file to keep, re-edit, and play
              back with `autocwi cc`.
  .jsx        A script for Adobe After Effects, for the Caption with
              Intention template the design system ships -- which is where a
              CWI captioner actually works. See `to_ae_jsx`.

The first two are exports: information is dropped on purpose so the file
stays valid for tools that know nothing about CWI. The third drops nothing.

Lines are the caption lines the stage showed (`word.cue`), so what a
captioner opens is what was on screen.
"""

from __future__ import annotations

import json
from pathlib import Path

from .schema import AxisMapping, CaptionSpec, Mapping, Media, Speaker, Word

# A caption stays up this long past its last word, unless the next one is due.
TAIL_S = 0.4
# ...and the next caption gets this much air before it.
GAP_S = 0.04
# What an unattributed word is filed under: CaptionSpec needs a speaker, and
# inventing one would be a claim about who spoke (CWI 2.1).
UNKNOWN = "unknown"
UNKNOWN_COLOR = "#FFFFFF"
LOUD = 0.6


def _start(word: dict) -> float:
    return float(word.get("t", word.get("start", 0.0)))


def _end(word: dict) -> float:
    # `end` runs to the next word's onset; a trailing pause is not the word.
    return _start(word) + min(
        1.2, max(0.05, float(word.get("end", 0.0)) - float(word.get("start", 0.0))))


def caption_lines(words: list[dict]) -> list[dict]:
    """Group words into the caption lines the stage showed, with line times."""

    lines: list[dict] = []
    for word in words:
        cue = word.get("cue")
        if not lines or cue is None or lines[-1]["cue"] != cue:
            lines.append({"cue": cue, "words": []})
        lines[-1]["words"].append(word)
    for n, line in enumerate(lines):
        line["start"] = _start(line["words"][0])
        end = _end(line["words"][-1]) + TAIL_S
        if n + 1 < len(lines):
            end = min(end, _start(lines[n + 1]["words"][0]) - GAP_S)
        line["end"] = max(end, line["start"] + 0.3)
        line["text"] = " ".join(str(w.get("text", "")).strip() for w in line["words"])
    return lines


def _clock(seconds: float, comma: bool) -> str:
    ms = max(0, int(round(seconds * 1000)))
    h, rest = divmod(ms, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, ms = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{',' if comma else '.'}{ms:03d}"


def to_srt(words: list[dict]) -> str:
    blocks = []
    for n, line in enumerate(caption_lines(words), start=1):
        blocks.append(
            f"{n}\n{_clock(line['start'], True)} --> {_clock(line['end'], True)}\n"
            f"{line['text']}\n")
    return "\n".join(blocks)


def speaker_colors(words: list[dict], palette: list[str]) -> dict[str, str]:
    """Speaker -> colour by order of first appearance, as `fuse.py` does."""

    colors: dict[str, str] = {}
    for word in words:
        speaker = word.get("speaker")
        if speaker and speaker not in colors:
            colors[speaker] = palette[len(colors) % len(palette)]
    return colors


def _vtt_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def to_vtt(words: list[dict], palette: list[str]) -> str:
    colors = speaker_colors(words, palette)
    out = ["WEBVTT", ""]
    if colors:
        out.append("STYLE")
        for speaker, color in colors.items():
            out.append(f'::cue(v[voice="{speaker}"]) {{ color: {color}; }}')
        out += ["::cue(.loud) { font-size: 150%; font-weight: bold; }",
                "::cue(.soft) { font-size: 70%; }", ""]
    for n, line in enumerate(caption_lines(words), start=1):
        out.append(str(n))
        out.append(f"{_clock(line['start'], False)} --> {_clock(line['end'], False)}")
        parts: list[str] = []
        voice: str | None = None
        for k, word in enumerate(line["words"]):
            speaker = word.get("speaker") or None
            piece = ""
            if speaker != voice:
                if voice:
                    piece += "</v>"
                if speaker:
                    piece += f"<v {speaker}>"
                voice = speaker
            # The first word starts with the cue; every later one says when.
            if k:
                piece += f"<{_clock(_start(word), False)}>"
            text = _vtt_escape(str(word.get("text", "")).strip())
            if word.get("soft"):
                text = f"<c.soft>{text}</c>"
            elif float(word.get("loudness") or 0.0) >= LOUD:
                text = f"<c.loud>{text}</c>"
            parts.append(piece + text)
        payload = " ".join(parts)
        if voice:
            payload += "</v>"
        out += [payload, ""]
    return "\n".join(out)


def to_spec(words: list[dict], cfg: dict, media_path: str, duration_s: float) -> CaptionSpec:
    palette = list(cfg["palette"]) + list(cfg.get("palette_support", []))
    colors = speaker_colors(words, palette)
    speakers = {name: Speaker(color=color) for name, color in colors.items()}
    if any(not w.get("speaker") for w in words):
        speakers[UNKNOWN] = Speaker(color=UNKNOWN_COLOR)
    previous_cue = object()
    spec_words: list[Word] = []
    for word in words:
        cue = word.get("cue")
        spec_words.append(Word(
            text=str(word.get("text", "")).strip(),
            start=round(_start(word), 3),
            end=round(_end(word), 3),
            speaker=word.get("speaker") or UNKNOWN,
            loudness=min(1.0, max(0.0, float(word.get("loudness") or 0.0))),
            pitch=min(1.0, max(0.0, float(word.get("pitch") or 0.5))),
            loudness_db=round(float(word.get("loudness_db") or 0.0), 2),
            pitch_hz=max(0.0, round(float(word.get("pitch_hz") or 0.0), 2)),
            voiced_frac=min(1.0, max(0.0, float(word.get("voiced_frac") or 0.0))),
            conf=min(1.0, max(0.0, float(word.get("conf") or 0.5))),
            line_break=cue != previous_cue and bool(spec_words),
        ))
        previous_cue = cue
    m = cfg["mapping"]
    return CaptionSpec(
        media=Media(path=media_path, duration=max(0.0, float(duration_s))),
        speakers=speakers,
        words=spec_words,
        mapping=Mapping(
            loudness_to=AxisMapping(**m["loudness_to"]),
            pitch_to=AxisMapping(**m["pitch_to"]),
            speaker_to=m["speaker_to"],
        ),
    )


AE_SCRIPT = r"""// Caption with Intention -- build caption layers from an analysed recording.
//
// Generated by Weave from: __MEDIA__
//
// HOW TO USE
//   1. Open the Caption with Intention After Effects template
//      (Academy_CI_Template.aep) and open its caption composition.
//   2. File > Scripts > Run Script File... and choose this file.
//   One undo step removes everything it adds.
//
// WHAT IT DOES, per caption line, following the template's own rig:
//   - duplicates the template's first "LINE n" text layer and its
//     "BOX LINE n" layer, keeping the box directly under its text (the box
//     reads `thisComp.layer(index - 1)`, so the order is the rig);
//   - sets the text;
//   - sets the layer's in and out points to when the caption is on screen;
//   - replaces the two layer markers the animation runs between: the first
//     at the first word's onset, the second at the end of the last word;
//   - sets COLOR_01 to the speaker's CWI colour (the line's main speaker --
//     the template has one colour per line);
//   - writes the loud and soft words into the layer's comment, for the
//     KEYWORD animator, which this script does not touch.
//
// NOT RUN IN AFTER EFFECTS BY ITS AUTHOR. It was written against the rig as
// read from the template file and its Quickstart Guide, on a machine without
// After Effects. Check the first line it builds before trusting the rest.
//
// The template paces words evenly between the two markers. Weave's own
// per-word onsets are in the .vtt and .cwi.json beside this file.

(function () {
    var LINES = __LINES__;

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Open the template's caption composition first, then run this script.");
        return;
    }

    function findLayer(prefix) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name.indexOf(prefix) === 0) { return comp.layer(i); }
        }
        return null;
    }

    var textTemplate = findLayer("LINE ");
    var boxTemplate = textTemplate ? findLayer("BOX " + textTemplate.name) : null;
    if (!textTemplate || !boxTemplate) {
        alert('This composition has no "LINE n" / "BOX LINE n" pair to copy.');
        return;
    }

    app.beginUndoGroup("Weave: build captions");
    var built = 0;
    for (var n = 0; n < LINES.length; n++) {
        var line = LINES[n];
        var text = textTemplate.duplicate();
        var box = boxTemplate.duplicate();
        text.moveToBeginning();
        box.moveAfter(text);
        text.name = "LINE W" + (n + 1);
        box.name = "BOX LINE W" + (n + 1);

        var doc = text.property("Source Text").value;
        doc.text = line.text;
        text.property("Source Text").setValue(doc);

        text.startTime = 0; box.startTime = 0;
        text.inPoint = line.start; text.outPoint = line.end;
        box.inPoint = line.start; box.outPoint = line.end;

        var markers = text.property("Marker");
        while (markers.numKeys > 0) { markers.removeKey(1); }
        markers.setValueAtTime(line.animStart, new MarkerValue("START"));
        markers.setValueAtTime(line.animEnd, new MarkerValue("END"));

        var color = text.property("ADBE Effect Parade").property("COLOR_01");
        if (color) { color.property("Color").setValue(line.color); }

        text.comment = line.note;
        built++;
    }
    app.endUndoGroup();
    alert("Weave built " + built + " caption lines.");
})();
"""


def _rgb(hex_color: str) -> list[float]:
    value = hex_color.lstrip("#")
    return [round(int(value[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [1]


def to_ae_jsx(words: list[dict], palette: list[str], media_name: str) -> str:
    """An ExtendScript that builds the template's caption layers.

    The design system's After Effects template is one text layer per caption
    (`LINE n`) with a `BOX LINE n` under it, animated between two layer
    markers and coloured by a `COLOR_01` control. A captioner fills that in by
    hand, line by line; this hands them every line already timed and
    coloured. See the header of the script itself for what it does and does
    not do -- including that it has not been run in After Effects.
    """

    colors = speaker_colors(words, palette)
    lines = []
    for line in caption_lines(words):
        counts: dict[str, int] = {}
        for word in line["words"]:
            if word.get("speaker"):
                counts[word["speaker"]] = counts.get(word["speaker"], 0) + 1
        main = max(counts, key=counts.get) if counts else None
        loud = [str(w["text"]).strip() for w in line["words"]
                if float(w.get("loudness") or 0.0) >= LOUD]
        soft = [str(w["text"]).strip() for w in line["words"] if w.get("soft")]
        note = "; ".join(part for part in (
            f"speaker {main}" if main else "speaker unknown",
            "loud: " + ", ".join(loud) if loud else "",
            "soft: " + ", ".join(soft) if soft else "") if part)
        lines.append({
            "text": line["text"],
            "start": round(max(0.0, line["start"] - 0.25), 3),
            "end": round(line["end"], 3),
            "animStart": round(line["start"], 3),
            "animEnd": round(_end(line["words"][-1]), 3),
            "color": _rgb(colors.get(main, UNKNOWN_COLOR)),
            "note": note,
        })
    return (AE_SCRIPT
            .replace("__MEDIA__", media_name.replace("*/", ""))
            .replace("__LINES__", json.dumps(lines, ensure_ascii=False, indent=4)))


def write_exports(
    words: list[dict],
    out_dir: Path,
    stem: str,
    cfg: dict,
    media_path: str,
    duration_s: float,
) -> dict[str, Path]:
    """Write every file; return ``{"srt": ..., "vtt": ..., "json": ..., "jsx": ...}``."""

    out_dir.mkdir(parents=True, exist_ok=True)
    palette = list(cfg["palette"]) + list(cfg.get("palette_support", []))
    paths = {
        "srt": out_dir / f"{stem}.srt",
        "vtt": out_dir / f"{stem}.vtt",
        "json": out_dir / f"{stem}.cwi.json",
        "jsx": out_dir / f"{stem}.aftereffects.jsx",
    }
    paths["srt"].write_text(to_srt(words), encoding="utf-8")
    paths["vtt"].write_text(to_vtt(words, palette), encoding="utf-8")
    paths["jsx"].write_text(
        to_ae_jsx(words, palette, Path(media_path).name), encoding="utf-8")
    spec = to_spec(words, cfg, media_path, duration_s)
    paths["json"].write_text(
        json.dumps(json.loads(spec.model_dump_json(exclude_none=True)),
                   ensure_ascii=False, indent=2),
        encoding="utf-8")
    return paths
