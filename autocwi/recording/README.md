# Captioning a recording

A recording is known whole before its first frame is shown. Weave uses that to fix the text, find where each word starts, and judge how a whole sentence was said.

```bash
./weave caption clip.mp4 --lang en
```

## Stages

`pipeline.py` runs the stages in this order.

| Stage | Module |
|---|---|
| Transcribe the whole file with Whisper | `transcribe.py` |
| Find where each word starts | `timing.py` |
| Measure loudness, pitch and speakers with the live captioner | `recognizer.py` |
| Keep the last state of each word | `score.py` |
| Decide speakers, sizes and caption lines by sentence | `direct.py` |
| Write the caption files | `export.py` |
| Draw the captioned video | `render.py` |

## Adjusting the captions

Weave's captions are a first draft. A person can change the text, the speaker, the size, the line breaks and the time of any word.

In the studio, import a recording and choose **Edit captions**. Pick a word and change it. The stage replays that line with the change, and **Export** writes the adjusted captions.

From the command line, edit `NAME.cwi.json` and hand it back:

```bash
./weave caption clip.mp4 --lang en --captions out/exports/clip.cwi.json
```

The file is used as written and nothing is transcribed. In it `loudness` is the size, `speaker` is the colour and `line_break` starts a caption line.

| Part | Module |
|---|---|
| What may be adjusted, and how it is applied | `captions.py` |
| The score the studio plays while it is adjusted | `desk.py` |

* A speaker keeps a colour for the whole session. Reassigning the first line does not move the others.
* A word typed with a space becomes two words that share the old word's time. Move them with **Starts at**.
* A word added in the studio was never measured. It takes its neighbour's voice at the line's own size.
* Every adjustment gives the stage new word ids, so nothing the stage froze for the old word carries over.

## Rules

* Keep Whisper's VAD filter off. It removes shouted lines.
* Keep the style prompt in the spoken language.
* Take word times from the aligner. Whisper's own times can be 0.7 s early.
* Size follows the sentence. A shouted line grows on every word.
* Motion values live in `config.yaml` under `video_motion`.
* The renderer sets each animation's time itself. Chrome's animation clock keeps running while the page clock is paused.
* Captions are drawn at 60 frames a second, whatever the recording's own rate. `--fps 120` raises it.

## Limits

* Playback can start at any caption line. There is no pause and no seeking inside a line.
* Every threshold is fitted to one film, `docs/reference/PR_Flim.mp4`.
* The After Effects script has not been run in After Effects.
* The video needs Chrome and an ffmpeg with `libx264`.
