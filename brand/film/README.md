# The Weave brand film

A 39 second silent film, 1920 by 1080 at 30 frames a second. It is silent on purpose: a film about captions should read without sound.

`make_film.py` builds it from Weave's own pages. No footage comes from anywhere else.

## The cut

1. Hero page, 15 s. A close-up inside the W pulls back to the whole page while the word moves, then a cursor hovers each language and the word shouts in that language's colour. This is the real gate page, stepped one frame at a time on Chrome's virtual clock.
2. Card: Captions that carry the voice.
3. Caption passage, 10 s. A short script spoken by two system voices and captioned by Weave. Weave split the two voices by itself. The shout and whisper sizes were set by hand, as the editor's Shout and Whisper do.
4. Card: Change any word.
5. The studio, pushing in on the editor with the shouted word picked.
6. Card: See how it was said.
7. The mark and the name.

## Making it again

```bash
# the script, spoken and captioned at 4K
say -v Samantha -o l1.aiff "Captions should show how it was said."   # and the other lines
.venv/bin/python -m autocwi caption weave-voice-4k.mp4 --lang en \
  --captions weave-voice-4k.cwi.json --fps 30 --size 1.4 --out /tmp/weave-film/cap4k

# the two pages the film captures
.venv/bin/python -m autocwi live --port 7352 --no-open
.venv/bin/python -m autocwi live --import weave-voice.mp4 --lang en \
  --captions weave-voice-edited.cwi.json --port 7353 --no-open

# every part, then the cut
.venv/bin/python brand/film/make_film.py
```

One part can be made alone: `make_film.py hero`, `cards`, `captions`, `ui` or `cut`. The film is written to `out/brand/weave-film.mp4`. Working files go to `/tmp/weave-film`.

Timings, camera moves and the card lines are constants at the top of `make_film.py`. The cards are drawn by `cards.html`.
