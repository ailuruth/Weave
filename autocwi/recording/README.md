# Captioning a recording

A recording is known whole before its first frame is shown. Weave uses that to fix the text, find where each word starts, and judge how a whole sentence was said.

```bash
./weave caption clip.mp4
```

The language is detected from the opening of the file when `--lang` is left out. `--verbose` prints the full log.

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

In the studio, import a recording and choose **Edit captions**. The panel lists one caption per row, with a search above it, and shows the chosen caption's words, text, color, style and timing between the two. Pick a row and the picture goes to it. Change it and the stage shows the change at once, paused or playing. **Export** writes the adjusted captions.

From the command line, edit `NAME.cwi.json` and hand it back:

```bash
./weave caption clip.mp4 --captions out/exports/clip.cwi.json
```

The file is used as written and nothing is transcribed. In it `loudness` is the size, `speaker` is the colour and `line_break` starts a caption line.

| Part | Module |
|---|---|
| The command, its checks and what it prints | `caption_command.py`, `report.py`, `language.py` |
| What may be adjusted, and how it is applied | `captions.py` |
| The score the studio fetches and plays, and the changes to it | `desk.py` |

* A speaker keeps a colour for the whole session. Reassigning the first line does not move the others.
* A word typed with a space becomes two words that share the old word's time. Move them with **Starts at**.
* A word added in the studio was never measured. It takes its neighbour's voice at the line's own size.
* Every adjustment gives the stage new word ids, so nothing the stage froze for the old word carries over.

## Adjusting in After Effects

Every export writes `NAME.aftereffects.jsx`. Open the Caption with Intention template, open its caption composition and run the script from File, Scripts. It builds one text layer and its box for each caption line, with the text, the screen time, the two animation markers and the speaker's colour set, ready to adjust by hand. Changes made in the studio's editor are in the script.

* The script is plain ASCII, so Korean text survives any system encoding.
* Caption layers never overlap in time, and a composition shorter than the captions is lengthened.
* If something fails it says which caption line, and one undo removes what it added.
* When it finishes it reads every line back from After Effects and lists any that did not come out as written.

## Where the captions sit

`--position top` moves the caption line to the top of the frame, for a video whose own text fills the bottom. `--size 1.2` makes the captions a fifth larger, and a size beyond the range Caption with Intention allows is refused. Both live in `config.yaml` under `live.import_render`, and the studio shows a recording the same way. With no caption chosen, the editor sets both for the session through `POST /session/look`, which the stage, the captioned video and the next render all read.

## Rules

* Keep Whisper's VAD filter off. It removes shouted lines.
* Keep the style prompt in the spoken language.
* Take word times from the aligner. Whisper's own times can be 0.7 s early.
* Size follows the sentence. A shouted line grows on every word.
* Motion values live in `config.yaml` under `video_motion`.
* The renderer sets each animation's time itself. Chrome's animation clock keeps running while the page clock is paused.
* Captions are drawn at 60 frames a second, whatever the recording's own rate. `--fps 120` raises it.
* A word of a recording turns when it is spoken. The live rule that a word must be on screen for 420 ms first does not apply: the line is drawn 250 ms ahead, and that is its read-ahead.
* The playhead is published to the page every 66 ms, and at once when a caption line is due to change.
* Chrome runs without its frame rate limit. Otherwise each screenshot waits about three 60 Hz frames, which was 90% of the drawing time. Chrome uses about three cores while it draws.
* The studio applies events in `requestAnimationFrame`, so it only sees them when Chrome makes a frame. With the limit on, the first word turned 8 to 13 frames late, by a different amount each run.

## Limits

* In the studio the browser plays the recording from the score at `/session/score`, so it can pause and seek. The server replays nothing. The headless page that draws the video still gets the score replayed by the server.
* Every threshold is fitted to one film, `docs/reference/PR_Flim.mp4`.
* The After Effects script has not been run inside After Effects. Its layer names, markers and colour control were read out of the template file, and it is run against a model of the scripting interface.
* The video needs Chrome and an ffmpeg with `libx264`.
* Two renders of the same captions are not pixel identical. A word can land a fraction of a pixel or one frame apart.
