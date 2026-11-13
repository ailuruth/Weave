# Captioning a recording

Weave captions a room (live) and a recording (import). They share the stage and almost nothing about how they get there. Live, a word is drawn before its sentence is over, so every decision uses only what is known at that instant. A recording is known whole before a frame is shown, and every stage below exists because that buys something live cannot have.

This package is the code. The stage order is in `pipeline.py`. This document owns the reasons and the measurements; the code does not repeat them.

## Use

```bash
.venv/bin/python -m autocwi live                                   # then Import a video at the picker
.venv/bin/python -m autocwi live --import clip.mp4 --lang en       # same path, from the command line
.venv/bin/python -m autocwi live --import clip.mp4 --lang en --once --out out   # export and exit
```

Exports land in `OUT/exports/`. See "Export" below.

## Stages

| # | Stage | Module | What it buys |
|---|---|---|---|
| 1 | Transcribe the whole file | `transcribe.py` | Words a streaming recognizer drops |
| 2 | Time each word on the audio | `timing.py` | Correct colour turns and correct per-word measurements |
| 3 | Run the live captioner on that script | `recognizer.py` | Prosody, speakers, sounds and levels, unchanged |
| 4 | Reduce every word to its last state | `score.py` | No revisions on screen |
| 5 | Direct: speakers, sizes, lines, softness | `direct.py` | Decisions that need the whole sentence |
| 6 | Export | `export.py` | Files a person can finish |
| 7 | Replay in time | `score.py` | The studio's playhead and the picture slaved to it |

Stage 3 is passed into the pipeline as a function. The captioner lives in `autocwi.live`, which imports this package.

## Measurements

All on `docs/reference/PR_Flim.mp4` unless a row says otherwise. "From 0:28" is the footage section, scored against `docs/reference/PR_Flim_Annotated.txt`, which is one person's hand reading.

### 1. Transcription

| Recognizer | Words matched from 0:28 | WER |
|---|---|---|
| Streaming transducer (the live lane) | 92 of 106 | 15.1% |
| Streaming plus a Whisper endpoint pass | 92 of 105 | 14.3% |
| Whisper `large-v3-turbo` over the whole file | 101 of 105 | 5.7% |
| The same with Whisper's VAD filter on | 89 of 105 | 17.1% |

The endpoint pass cannot help because the lost lines ("GUMP! What's your", "Buzz Lightyear to the rescue!") never reach it. The VAD filter removes the same shouted and cartoon lines, so it is off.

Without a style prompt the film's first 28 seconds come back as one lowercase run with no punctuation, and caption lines are cut from sentences. The prompt must be in the spoken language. On 120 Korean FLEURS clips, character error rate with the project normaliser:

| Prompt | CER |
|---|---|
| English prompt | 14.21% |
| No prompt | 4.75% |
| Korean prompt | 4.55% |

The live Korean recognizer scores 7.52% on the same clips. A language with no prompt of its own gets none.

These are 120-clip subsets with the project's normaliser. A standard run (LibriSpeech test-clean, full FLEURS Korean, Whisper normaliser) is set up and was paused at 61 of 2,620 English utterances.

### 2. Timing

Whisper's word times come from attention, not from the sound. On the film it put "louder" at 15.8 s; it is spoken at 16.5 s. Everything is keyed on a word's span, so the colour turned 0.7 s early and the word's loudness was measured over a pause.

A CTC forced aligner (torchaudio `MMS_FA`) re-times every word. 56 of 173 word starts moved by more than 150 ms. With the right span "louder" measures −11 dB (the loudest word) and "softer" −23 dB.

`lead_in` then moves a word that follows a gap back to where its sound starts. The aligner places "louder" at its first clearly spelled sound, 16.67 s; the level rises from 16.50 s.

The aligner reads Latin letters only. Hangul is romanised first. On `assets/sample-ko.wav` the first word moved from 0.00 s (on the leading silence) to 2.06 s, and 5 of 13 starts moved by more than 100 ms.

Timing cannot be scored against the film. Its After Effects template paces words evenly between two markers per line, so its colour turns are not word onsets.

### 3. The scripted recognizer

`ScriptedRecognizer` answers the seven calls the captioner makes of a recognizer from the finished script. Three behaviours are deliberate:

- A word is released once its whole span has been fed. Released at its start, the captioner measured it before its audio existed and cached silence (6 of 65 labelled words at −80 dB).
- An utterance ends at the end of a sentence. With silence as the only rule the film came out as one 68-second utterance.
- Timestamps are relative to each stream's own start, which is the frame the streaming recognizer uses.

### 4. Score

Each word is reduced to its last state and released when its caption line is due. Against the live studio on the same film:

| Per word | Live | Recording |
|---|---|---|
| Read-ahead before the word is spoken (median) | 688 ms | 1736 ms |
| Text changed after it appeared | 32 of 170 | 0 of 173 |
| Colour changed after it appeared | 70 of 170 | 0 of 173 |

### 5. Direction

`direct()` runs four stages in one order. Speakers come first because sentence arousal is a pitch over the speaker's register. Lines come before softness because a soft run may not cross a caption line.

**Speakers.** A sentence where one speaker holds 60% of the attributed words is given to that speaker. A sentence with no speaker takes its neighbour's when it is within 4 s. Speaker changes against the film: 8 right and 2 wrong of 10. Over the whole film, 71% of words carry a colour consistent with one film speaker.

Tried and not adopted: sherpa-onnx whole-file diarization (fewer correct changes), clustering sentence embeddings (same merges), and running on a voice stem separated with Hybrid Demucs (colour consistency fell to 61–64%).

**Sizes.** The film decides by the line. A shouted line pops on its quietest word; a loud syllable in a calm line only lifts. What marks the line is the speaker's pitch over their own register, which survives mastering where level does not.

| Rule | Pop vs lift, 65 hand-labelled words |
|---|---|
| Word loudness (the live rule) | 80% right |
| Sentence arousal | 91% right, no false pop |

A word that stands out from its own sentence, or sits at the top of its speaker's range, keeps its size in a calm sentence ("louder", "wow").

Against the film's pixels (`assets/reference_specs/pr_film_pixels.json`, 86 trusted words) the sizes correlate +0.68, with no pop the film does not have and 10 of its 19. The eight it misses ("God", "feel", "more.", "gasps.", "big." among them) are chosen for meaning.

Tried: the `emphases` neural prominence model. Alone it is worse (AUC 0.66 against 0.79). Combined with the current sizes it reaches about +0.71 on held-out lines. Not wired in; it needs a stand-in for `torbi`, which has no build for torch 2.5.

**Lines.** A sentence is one caption. One longer than 54 characters is split where a captioner would: after a clause, at a pause, at a speaker change, and never after a word that leads into the next. From 0:28 the lines match the film's.

**Softness.** Only a voice that stays soft is drawn small: two or more consecutive words on one line, each 6 dB under the sentence median, the run under half the sentence. With the quiet range simply open, 29 of 173 words shrank, including "so", "as", "you" and the whole of "I'll show you." On the film the rule leaves exactly "or softer."

Every threshold in this section is fitted to one film.

### 6. Export

| File | For | Carries |
|---|---|---|
| `NAME.srt` | Any caption tool | Text and line timing |
| `NAME.vtt` | WebVTT tools | Speaker voices in the CWI palette, a timestamp per word, loud and soft classes |
| `NAME.aftereffects.jsx` | The CWI After Effects template | One `LINE` / `BOX LINE` pair per caption, timed, with markers and `COLOR_01` |
| `NAME.cwi.json` | This project | A valid `CaptionSpec` with every measurement |

The After Effects script follows the template's rig as read from the `.aep` and its Quickstart Guide: the box layer reads `thisComp.layer(index - 1)`, the animation runs between the first two layer markers, and colour is the `COLOR_01` effect. It has not been run in After Effects.

ffmpeg parses the `.srt` and `.vtt`. `autocwi cc` replays the spec.

## How a recording is shown

The studio shows one caption line at a time, as a captioned film does (`web/src/lib/caption-cues.ts`). Geometry is read off the film's frames as fractions of the picture: type 4.2% of the frame height, plate top at 86.67%, plate height 7.22%, side padding 0.37 em, centred.

The picture is slaved to the caption playhead (`web/src/lib/media-sync.ts`). It holds a steady 26 ms from it by leaning the playback rate up to 5%; a player given a position starts about 150 ms behind it.

### The film's motion, measured

`scripts/film_pixels.py` measures every caption word of the film from 0:28, per frame, at sub-pixel precision. 17 of 18 captions, 102 words, 88 trusted.

| | Film |
|---|---|
| Pop | median 1.47×, range 1.28–1.87, baseline fixed |
| Pop timing | starts with the colour turn, peaks 2 frames later, over in 0.29 s |
| Lift | about 5 px (0.17 em) with no growth, over in 0.25 s |
| Before the rise | a dip of about 1.7 px over 4 frames |
| Weight | a property of the line; stroke through a pop is 0.95× of rest (20 words) |
| Characters | syllable groups rise 1–2 frames apart |

The video motion clock (`motion.live_sync.video_motion` in `config.yaml`) reproduces that curve. It applies only to recordings; the live stage keeps its own timing.

What watching the film against ours changed, each confirmed in frames first:

- A word after a pause was turned into a lift with no size. "louder" follows a pause.
- The stage clamped size to 1–1.55×, so nothing could shrink.
- Weight followed pitch, which made the low, quiet "softer" the boldest word of its line. Over a picture, weight follows size.
- A big or small word holds while it is spoken.
- A word drawn out by the speaker floats until it has been said. The narrator holds "is" for 0.8 s; the film's "is" dips, rises about half a letter-height, stays there in white, then lands and turns colour.
- Quiet words shrink as a group, once, before they are spoken, and stay small to the end of the line.
- The row's sideways-reveal animation clips the row to its own box and restarts when the row's width changes. A growing word changes the width, so "louder" was drawn with its tops and bottoms cut off. It is off for recordings.
- A very big word moves its neighbours; ordinary pops only overlap.

## Limits

- No pause or seek.
- "louder" reaches about 2× where the film's is nearly 3×.
- The film rests a line at its speaker's weight. Weave rests every word at Regular 400 (`docs/MOTION.md`, "Return to normal").
- Speakers, timing and sizes have no standard benchmark run yet.
