# Contributing

Run `./install.sh` to set up. Use `.venv/bin/python`, never the system Python.

## Before you push

```bash
npm --prefix web run check
```

It runs lint, the tests and the build. GitHub runs the same check on every push. Lint shows a few warnings in `live-studio.tsx`, where the caption motion depends on patterns the React rules dislike. Do not add to them.

## Rules

* Models run locally. Add no cloud call and no telemetry.
* Put every tunable value in `config.yaml`.
* Keep the caption file format in `autocwi/schema.py` compatible. Add optional fields only.
* A word moves once. A correction updates it in place and never restarts its motion.
* The design system at [captionwithintention.org](https://captionwithintention.org) decides typography and motion.
* The language is chosen before capture and stays fixed for the session.
* The studio must build to static files. Add no Node server.

## Making a change

Change a value in `config.yaml`, run `weave live --sample`, and watch the result. For a visual change, attach a screenshot to the pull request.

If you find a way that audio or transcripts leave the machine, report it privately.
