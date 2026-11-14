# Weave

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![sherpa-onnx](https://img.shields.io/badge/sherpa--onnx-1.13-005CED?style=flat&logo=onnx&logoColor=white)](https://github.com/k2-fsa/sherpa-onnx)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)

Weave captions a video with [Caption with Intention](https://captionwithintention.org), the caption design system for Deaf and hard of hearing viewers. Each speaker gets a colour. Each word turns to that colour as it is spoken. The type grows and shrinks with the voice.

You give Weave a video. It returns the video with those captions drawn on it. It works in English and Korean and runs on your own machine.

![A film scene captioned by Weave. Each word turns to its speaker's colour as it is spoken](docs/figure/caption-demo.gif)

The clip is from [Sintel](https://durian.blender.org), © Blender Foundation, CC BY 3.0.

## Caption a video

```bash
./weave caption clip.mp4
```

Weave works out whether the speech is English or Korean. Add `--lang en`, `--lang ko` or `--lang multi` to say so yourself.

This writes the captioned video to `out/exports/`, with the captions as `.srt`, `.vtt`, an After Effects script and `.cwi.json`. A sound only file comes back as captions on a black frame.

The captions are a first draft. To correct them, edit `out/exports/clip.cwi.json` and draw the video again from it, or use **Edit captions** in the studio.

```bash
./weave caption clip.mp4 --captions out/exports/clip.cwi.json
```

The caption line sits low in the frame, as Caption with Intention places it. If your video already has a logo or subtitles there, move the line up. If people will watch on a phone, make the captions larger.

```bash
./weave caption clip.mp4 --position top --size 1.2
```

## Install

You need Python 3.11, Node.js, ffmpeg and Chrome, on macOS (Apple Silicon) or Linux.

```bash
git clone https://github.com/ailuruth/Weave.git
cd Weave
./install.sh
```

The script sets up everything, including 2.2 GB of models. It takes a few minutes.

## Live captions

Weave can also caption a microphone while people speak, in a studio that opens in the browser.

![The studio running: a dark stage of rolling captions, each word coloured by its speaker](docs/figure/fig5.png)

```bash
./weave live                  # captions from the microphone
./weave live --lang ko        # en, ko or multi
./weave live --sample         # the bundled film, no microphone
```

In the studio you can also choose **Import a video**, or drop a video onto the language picker. A timeline under the picture shows the sound, the caption lines in one row per speaker, and the sound captions. Drag a line to another row to give it to that speaker. The **+** button adds a caption at the playhead and opens it in the editor with its text selected, so you type straight over it. In the editor, a line takes a speaker's colour or the rainbow (each letter its own colour, as the reference film draws WHOOOOOA!!) and a style: Normal, Shout, Whisper or Slow. Choose a word under **Edit** to give that one word its own color, style and time instead. **Split** cuts the line where the text cursor is, inside a word too. Each change plays that caption's motion over a still picture, up to its end time. Pause, scrub and jump to any line, drag a line to move it, or drag its edge to change when it starts or ends. **Edit captions** corrects a word, a speaker, a size or a line, and **Export** saves the results.

| Key | Does |
|---|---|
| Space or K | Play and pause |
| ← and → | Back and forward one second (Shift: five, Option: one frame) |
| ↑ and ↓ | Previous and next caption line |
| Home and End | Start and end |
| [ and ] | Start or end the current line at the playhead |
| ⌘Z and ⇧⌘Z | Undo and redo |
| ? | Show these keys |
| Double-click a line | Open it in the editor |
| Tab and ⇧Tab | Next and previous word, while editing |
| 1, 2, 3 | Choose a language on the picker |

Hold ⌘ and scroll over the timeline to zoom. Choose 1×, 0.75× or 0.5× beside the zoom buttons.

## Documentation

* [The project page](https://ailuruth.github.io/Weave/) shows what a caption does.
* [ARCHITECTURE.md](ARCHITECTURE.md) describes the modules and the data format.
* [CONTRIBUTING.md](CONTRIBUTING.md) has the rules for changing the code.
* [autocwi/recording/README.md](autocwi/recording/README.md) covers captioning a video.
* [web/README.md](web/README.md) covers the studio.

## Related work

Other open implementations of Caption with Intention are [opencaptions](https://github.com/broomva/opencaptions), [caption-with-intention](https://github.com/mjkang-estrella/caption-with-intention), [Alive-Caption](https://github.com/Segyun/Alive-Caption), [sightline](https://github.com/samadon1/sightline), [CIG](https://github.com/jutopia03/CIG-Caption-with-Intention-Generator-) and [Voxsama's studio](https://github.com/Voxsama/Caption-with-intention).

## License

MIT. See [LICENSE](LICENSE). Caption with Intention is authored by the Chicago Hearing Society. Weave is an independent implementation and is not affiliated with them. Bundled samples, model weights and fonts carry their own licenses.
