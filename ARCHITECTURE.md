# Architecture

Weave has three modes. They share one word format.

* **live** captions a microphone in real time.
* **caption** captions a recording and writes the files.
* **cc** plays a finished caption file.

An older batch pipeline, `autocwi run`, also writes a caption file from recorded media.

## How live captions flow

1. Python captures audio and recognizes words with a local model.
2. Python measures each word's loudness and pitch and decides who spoke.
3. The server sends each word to the browser as an event.
4. The studio shows the word in white before it is spoken.
5. The word turns to its speaker's colour and moves as it is said.

## Modules

| Module | What it does |
|---|---|
| `autocwi/live.py` | Capture, recognition, speakers and the local server |
| `autocwi/recording/` | Captioning a recording |
| `autocwi/schema.py` | The caption file format |
| `autocwi/check.py` | Checks a caption file |
| `autocwi/ccpage.py` | Plays a finished caption file |
| `autocwi/haptics.py` | Turns words and direction into motor cues |
| `web/` | The studio, built to static files that Python serves |
| `native/sortformer/` | Speaker separation on Apple Silicon |
| `scripts/hw/` | The Raspberry Pi node |
| `config.yaml` | Every tunable value |

## The caption file

`CaptionSpec` in `autocwi/schema.py` is the contract between analysis and anything that draws captions. It holds each word's text, time, speaker, loudness and pitch. Add optional fields freely. A change that breaks old files raises the version.

Live events use the same word shape and carry a stable `word_id`. A corrected word arrives again under the same id.

## Rules that hold everywhere

* Text changes only before a word turns colour. After that the word is fixed.
* A word moves once. A correction never restarts its motion.
* Models run on the machine by default.
* Tunable values live in `config.yaml`, not in code.
