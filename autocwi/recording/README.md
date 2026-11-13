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

## Rules

* Keep Whisper's VAD filter off. It removes shouted lines.
* Keep the style prompt in the spoken language.
* Take word times from the aligner. Whisper's own times can be 0.7 s early.
* Size follows the sentence. A shouted line grows on every word.
* Motion values live in `config.yaml` under `video_motion`.
* The renderer sets each animation's time itself. Chrome's animation clock keeps running while the page clock is paused.

## Limits

* There is no pause or seek.
* Every threshold is fitted to one film, `docs/reference/PR_Flim.mp4`.
* The After Effects script has not been run in After Effects.
* The video needs Chrome and an ffmpeg with `libx264`.
