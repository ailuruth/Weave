#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Weave needs $1. $2"; exit 1; }
}
need python3.11 "Install Python 3.11 first."
need node "Install Node.js first."
need ffmpeg "Install ffmpeg first."

python3.11 -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt
.venv/bin/python scripts/fetch_font.py
.venv/bin/python scripts/fetch_streaming_model.py
npm --prefix web ci --silent
npm --prefix web run build --silent

echo
echo "Weave is installed. Caption a video with:"
echo "  ./weave caption clip.mp4"
