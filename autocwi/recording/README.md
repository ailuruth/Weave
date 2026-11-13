# Captioning a recording

Live, Weave draws a word before its sentence is over. A recording is known whole before the first frame, so this package can decide things live captioning cannot: the final text, the real start of each word, and how a whole sentence was said.

```bash
.venv/bin/python -m autocwi caption clip.mp4 --lang en   # files and the captioned video
.venv/bin/python -m autocwi live                         # or Import a video in the studio
```

## Stages

`pipeline.py` runs them in this order.

| Stage | Module | Why it exists |
|---|---|---|
| Transcribe the whole file | `transcribe.py` | Whisper over the whole file keeps words a streaming recognizer drops |
| Time each word | `timing.py` | A forced aligner finds where each word starts in the audio |
| Run the live captioner on that script | `recognizer.py` | Loudness, pitch, speakers and sounds come from the same code as live |
| Keep each word's last state | `score.py` | Nothing is revised on screen |
| Direct | `direct.py` | Speakers, sizes, caption lines and soft runs need the whole sentence |
| Export | `export.py` | `.srt`, `.vtt`, an After Effects script and `.cwi.json` |
| Replay | `score.py` | The studio plays the score on the recording's own clock |
| Draw the video | `render.py` | The studio draws every frame and ffmpeg lays them on the picture |

The captioner itself lives in `autocwi.live`, which passes it to the pipeline as a function.

## Before you change a stage

Each rule below was measured on the PR film, `docs/reference/PR_Flim.mp4`.

**Transcription.** Keep Whisper's VAD filter off. With it on, the shouted and cartoon lines disappear and 89 of 105 caption words match where 101 did. Keep the style prompt in the spoken language. An English prompt on Korean audio raised the character error rate from 4.55% to 14.21%.

**Timing.** Do not use Whisper's own word times. Whisper placed "louder" 0.7 s early, so the colour turned early and the word's loudness was measured over a pause. The aligner reads Latin letters, so Hangul is romanised first.

**The scripted recognizer.** It releases a word only after the word's whole span has been fed. Released earlier, the captioner measures silence. It ends an utterance at the end of a sentence, or the whole film becomes one utterance.

**Direction.** `direct()` settles speakers first, then sizes, then caption lines, then soft runs. Sizes need the speaker, and a soft run may not cross a line. Size follows the sentence: a shouted line grows on every word, and a loud syllable in a calm line does not. On 65 hand-labelled words that rule is right 91% of the time where per-word loudness is right 80%. Every threshold is fitted to this one film.

**Motion.** The values are in `config.yaml` under `motion.live_sync.studio.video_motion`. `display.py` serves them and `web/src/lib/reel-motion.ts` turns them and one word into a plan. The plan is computed once per word and never recomputed.

**The video.** The renderer steps two clocks together: the page's and the replay's. Before each frame it sets every animation's time itself, because Chrome's animation clock keeps running while its page clock is paused. The render replays on its own channel, `/events?channel=render`, and its page asks for `/session?render=1`. A plain `GET /session` is the reload signal and would reset a session someone is watching.

## Limits

- No pause or seek.
- The After Effects script has not been run in After Effects.
- Speaker changes match 8 of the film's 10, with 2 more where the film has none.
- The film enlarges some words for their meaning ("God", "more"). Weave only measures the voice and misses them.
- A recording with a variable frame rate is drawn at its nominal rate.
- The video needs Chrome or Chromium and an ffmpeg with `libx264`.
