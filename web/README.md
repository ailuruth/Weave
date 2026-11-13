# Weave Studio

The studio is a Next.js app. It builds to static files in `web/out`, and the Python process serves them. Recognition stays in Python. The browser reads events from `/events`.

## Build

```bash
npm install && npm run build
```

## Develop

```bash
.venv/bin/python -m autocwi live --sample --no-open
NEXT_PUBLIC_AUTOCWI_ORIGIN=http://127.0.0.1:7337 npm --prefix web run dev
```

`/?demo=1` shows the studio with no models.

## Files

| File | What it holds |
|---|---|
| `components/live-studio.tsx` | The stage, transcript, rail and settings |
| `hooks/use-caption-stream.ts` | The event stream and the language session |
| `lib/caption-clock.ts` | The playhead |
| `lib/caption-store.ts` | The reducer that merges word events |
| `lib/reel-motion.ts` | How a word of a recording moves |
| `app/globals.css` | Styles and animations |

## Rules

* A word animates at the moment it was spoken, not when it arrives.
* A word's motion is computed once and survives a rebuild of the word.
* Text changes only while a word is still ahead of the playhead.
* Rows never move once laid out. A late word is appended.
* Grey means the speaker is unknown.
* Captions follow Caption with Intention. Everything else follows the Apple design tokens.
* The app must build to static files. Add no Node server.
