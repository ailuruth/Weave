# Sortformer helper

This Swift program runs NVIDIA Streaming Sortformer v2.1 in Core ML, outside the Python process. It runs only on Apple Silicon. Elsewhere Weave uses its ONNX speaker tracker.

```bash
.venv/bin/python scripts/fetch_streaming_model.py --sortformer-only
```

The program reads one JSON message per line from stdin and writes timeline events to stdout. `audio` carries base64 float32 mono samples at 16 kHz. `reset`, `finish` and `close` control the stream.

The model is `diar_streaming_sortformer_4spk-v2.1`, converted by FluidAudio 0.15.5. The weights download to `assets/sortformer-coreml/` and are not committed. Read the NVIDIA Open Model License and FluidAudio's Apache 2.0 license before you redistribute them.
