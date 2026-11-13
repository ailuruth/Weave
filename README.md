# Weave

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![sherpa-onnx](https://img.shields.io/badge/sherpa--onnx-1.13-005CED?style=flat&logo=onnx&logoColor=white)](https://github.com/k2-fsa/sherpa-onnx)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)

[Project Page](https://nobel2040ne.github.io/Weave/)

Weave captions a video with [Caption with Intention](https://captionwithintention.org), the caption design system for Deaf and hard of hearing viewers. Each speaker gets a colour. Each word turns to that colour as it is spoken. The type grows and shrinks with the voice.

You give Weave a video. It returns the video with those captions drawn on it. It works in English and Korean and runs on your own machine.

## Caption a video

```bash
.venv/bin/python -m autocwi caption clip.mp4 --lang en     # or ko, multi
```

This writes the captioned video to `out/exports/`, with the captions as `.srt`, `.vtt`, an After Effects script and `.cwi.json`. A sound only file comes back as captions on a black frame.

## Install

You need Python 3.11, Node.js, ffmpeg and Chrome, on macOS (Apple Silicon) or Linux.

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_font.py             # fonts, 12 MB
.venv/bin/python scripts/fetch_streaming_model.py  # models, 2.2 GB
npm --prefix web install && npm --prefix web run build
```

## Live captions

Weave can also caption a microphone while people speak, in a studio that opens in the browser.

![The studio running: a dark stage of rolling captions, each word coloured by its speaker](docs/figure/fig5.png)

```bash
.venv/bin/python -m autocwi live                  # captions from the microphone
.venv/bin/python -m autocwi live --lang ko        # en, ko or multi
.venv/bin/python -m autocwi live --sample         # the bundled film, no microphone
```

In the studio you can also choose **Import a video** to watch a recording being captioned, and **Export** to save the results.

## Documentation

* [The project page](https://nobel2040ne.github.io/Weave/) shows what a caption does.
* [ARCHITECTURE.md](ARCHITECTURE.md) describes the modules and the data format.
* [CONTRIBUTING.md](CONTRIBUTING.md) has the rules for changing the code.
* [autocwi/recording/README.md](autocwi/recording/README.md) covers captioning a video.
* [web/README.md](web/README.md) covers the studio.

## Related work

Other open implementations of Caption with Intention are [opencaptions](https://github.com/broomva/opencaptions), [caption-with-intention](https://github.com/mjkang-estrella/caption-with-intention), [Alive-Caption](https://github.com/Segyun/Alive-Caption), [sightline](https://github.com/samadon1/sightline), [CIG](https://github.com/jutopia03/CIG-Caption-with-Intention-Generator-) and [Voxsama's studio](https://github.com/Voxsama/Caption-with-intention).

## License

MIT. See [LICENSE](LICENSE). Caption with Intention is authored by the Chicago Hearing Society. Weave is an independent implementation and is not affiliated with them. Bundled samples, model weights and fonts carry their own licenses.
