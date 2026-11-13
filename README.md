# Weave

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![sherpa-onnx](https://img.shields.io/badge/sherpa--onnx-1.13-005CED?style=flat&logo=onnx&logoColor=white)](https://github.com/k2-fsa/sherpa-onnx)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)

[Project Page](https://nobel2040ne.github.io/Weave/)

Live speech into expressive captions for Deaf and hard-of-hearing viewers, automating [Caption with Intention](https://captionwithintention.org): colour for who is speaking, motion for when each word is spoken, a variable font for how it is said. English or Korean, entirely offline.

![The studio running: a dark stage of rolling captions, each word coloured by its speaker](docs/figure/fig5.png)

## Quick start

Python 3.11, Node.js and ffmpeg, on macOS (Apple Silicon) or Linux.

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_font.py             # fonts, ~12 MB
.venv/bin/python scripts/fetch_streaming_model.py  # models, ~2.2 GB
npm --prefix web install && npm --prefix web run build
.venv/bin/python -m autocwi live --sample          # opens 127.0.0.1:7337
```

`fetch_streaming_model.py` takes `--korean-only`, `--speaker-only`, `--sortformer-only` and `--onset-only` for a partial download. Korean motion needs the font step — Roboto Flex has no Hangul outlines.

First run loads models for ~8 s. macOS asks for microphone permission once per terminal app. A page stuck on *Preparing language setup* means `web/out` is stale.

## Caption a video

Start `python -m autocwi live` with no `--lang`, choose **Import a video** under the language buttons, then pick the language spoken in it. The file never leaves the machine.

A recording is not streamed. It is transcribed whole (Whisper `large-v3-turbo`, a one-time ~1.6 GB download), run through the same prosody, speaker and motion pipeline as a live session, and only then played, with the picture held on the caption playhead. Each word appears once, in its final text and colour.

Measured on the bundled PR film against a hand transcript of its captions from 0:28:

| | Live studio | Imported |
|---|---|---|
| Words matching the film's captions | 92 of 106 | 101 of 105 |
| Read-ahead before a word is spoken (median) | 688 ms | 1736 ms |
| Words whose text changed after appearing | 32 of 170 | 0 of 173 |
| Words whose colour changed after appearing | 70 of 170 | 0 of 173 |

Speaker changes land on 8 of the film's 10, with 2 more where the film has none. There is no pause or seek yet.

How it works, with every measurement behind it: [`autocwi/recording/README.md`](autocwi/recording/README.md).

### Export for a captioner

Once a recording is analysed, **Export** in the top bar downloads the captions, and they are also written to `OUT/exports/`:

| File | For |
|---|---|
| `NAME.srt` | SubRip: any caption tool, editor or player. Text and line timing. |
| `NAME.vtt` | WebVTT: the same lines, plus who speaks (coloured with the CWI palette), when each word starts, and which words are loud or soft. |
| `NAME.aftereffects.jsx` | A script for the design system's After Effects template. It builds one `LINE` / `BOX LINE` pair per caption, timed, with its animation markers and speaker colour set. **Not yet run in After Effects** — check the first line it builds. |
| `NAME.cwi.json` | This project's CaptionSpec: every word with its measurements. Replays with `autocwi cc`. |

To export without opening the studio:

```bash
.venv/bin/python -m autocwi live --import clip.mp4 --lang en --once --out out
```

To get the recording back with the captions drawn on it, exactly as the studio moves them, choose **Export → Captioned video** in the studio, or:

```bash
.venv/bin/python -m autocwi live --import clip.mp4 --lang en --render --out out
```

That writes `OUT/exports/NAME.captioned.mp4`. The studio itself draws every frame in headless Chrome, and ffmpeg lays the frames over the original picture and keeps the original sound.

To check a caption file, yours or an edited one, against the design system:

```bash
.venv/bin/python -m autocwi check out/exports/NAME.cwi.json
```

It reports speakers whose colours are the same or too close to tell apart, colours too dark for the caption box, words out of order or outside the recording, a size channel that never moves, and overlong lines. It exits 1 on an error.

## Commands

Live — the product. Language is locked before capture.

```bash
.venv/bin/python -m autocwi live                   # microphone; pick a language first
.venv/bin/python -m autocwi live --lang ko         # en, ko, or multi (both at once)
.venv/bin/python -m autocwi live --list-devices    # choose a microphone
.venv/bin/python -m autocwi live --sample          # the bundled film, no microphone
.venv/bin/python -m autocwi live --file talk.wav   # stream a file at real-time pace
.venv/bin/python -m autocwi live --diarizer off    # captions without speaker colour
```

`cc` — a finished spec, at exact reference motion.

```bash
.venv/bin/python -m autocwi cc assets/reference_specs/demo.json
.venv/bin/python -m autocwi cc out/spec.json --media clip.mp4   # beside the video
.venv/bin/python -m autocwi tune                                # adjust motion by hand
```

Offline — recorded media to `spec.json`.

```bash
.venv/bin/python -m autocwi run clip.mp4 --out out/ --stub      # no models, runs anywhere
.venv/bin/python -m autocwi run clip.mp4 --out out/ --speakers 2
```

Whisper downloads on first use. Diarization reads `HF_TOKEN`; pyannote's weights are gated on [speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and [segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0). Inference stays local.

Wearable — a ReSpeaker mic array and a motor ring on a Raspberry Pi Zero 2 W.

```bash
# on the Pi, once
sudo apt install -y python3-numpy python3-gpiozero git libportaudio2 python3-cffi
pip install --break-system-packages sounddevice pyusb    # neither is packaged on trixie

# on the Pi
sudo python3 scripts/hw/probe_array.py --skip-audio # USB needs root to read interface names
python3 scripts/hw/probe_motor.py --wiring         # prints the driver circuit, touches no pin
python3 scripts/hw/probe_motor.py --gpio 4         # buzz one motor
python3 scripts/hw/weave_node.py --host MAC_IP     # stream audio + bearing to the Mac

# on the Mac
.venv/bin/python -m autocwi live --node --host 0.0.0.0
```

The ring follows the array's bearing; `--mac-cues` switches it to the Mac's cues. The server binds `127.0.0.1:7337`; `--host` widens it to the LAN.

## Map

```
autocwi/     the runtime: live engine, offline pipeline, renderers, schema
web/         the studio UI; static-exported and served by Python
native/      Swift helper for diarization on Apple Silicon
scripts/     one-time downloads; the Raspberry Pi node
assets/      fonts, sample audio, reference specs
config.yaml  every tunable value — never hardcoded in code
```

## Documentation

| | |
|---|---|
| [nobel2040ne.github.io/Weave](https://nobel2040ne.github.io/Weave/) | the project, on one page |
| [ARCHITECTURE.md](ARCHITECTURE.md) | modules, data contract, glossary |
| [CONTRIBUTING.md](CONTRIBUTING.md) | setup and the ground rules |
| [web/README.md](web/README.md) | the studio frontend |
| [captionwithintention.org](https://captionwithintention.org) | the design system — the final word |

## Related work

Caption with Intention is published as a design system and an After Effects template; a 2025 industry write-up notes that no service automates it. Other open implementations and the research this project leans on:

| | |
|---|---|
| [mjkang-estrella/caption-with-intention](https://github.com/mjkang-estrella/caption-with-intention) | browser editor: per-word motion inspector, SRT/WebVTT import, CWI JSON round-trip |
| [samadon1/sightline](https://github.com/samadon1/sightline) | Fire TV runtime over an approved WebVTT track, with a person confirming every proposal |
| [Segyun/Alive-Caption](https://github.com/Segyun/Alive-Caption) | iOS app, live and file-based, on-device |
| [jutopia03/CIG](https://github.com/jutopia03/CIG-Caption-with-Intention-Generator-) | upload-a-video generator on cloud speech recognition |
| de Lacerda Pataca et al., [CHI 2023](https://dl.acm.org/doi/10.1145/3544548.3581511) | DHH viewers: captions showing emotion beat conventional ones for emphasis; prosody alone did not |
| de Lacerda Pataca et al., [Caption Royale, CHI 2024](https://dl.acm.org/doi/10.1145/3613904.3642258) | the design space of affective captions, from DHH viewers |

What Weave adds is the automatic path: local models, live or from a file, with every figure measured against the film. What the editors above have and Weave does not is a person in the loop — which word a captioner enlarges is a judgement, not something in the audio.

## Future work

- **Read-ahead costs 1.75 s of latency.** `cc` is exact because it knows the text in advance.
- **Attribution at the edges** — short turns and similar voices stay ambiguous.
- **A locked session.** `--lang multi` hears both; `en` and `ko` hold one model.
- **Unimplemented from the spec:** off-camera italics, the sound-effect and music caption rules, and the ring on the live lane.

## License

MIT — see [LICENSE](LICENSE). Caption with Intention is authored by the Chicago Hearing Society; this is an independent implementation, not affiliated with or endorsed by them. Bundled samples, model weights and fonts carry their own licenses.
