# Evaluation set: FLEURS

Google FLEURS (`google/fleurs`), split `test`, config `en_us`. 120 rows, downloaded 2026-09-04. Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

FLEURS is read speech with one speaker and no room noise. A score on it is a floor, not proof that Weave works in a real room.

## How it was fetched

`scripts/fetch_fleurs.py` cannot fetch `en_us`. HuggingFace's datasets server refuses the request with `Scan size limit exceeded`.

This set comes from the parquet shard itself:

`https://huggingface.co/api/datasets/google/fleurs/parquet/en_us/test/0.parquet`

It holds the first 120 clips of that shard, 16 kHz mono, 19.1 minutes in total. Reading the shard needs `pyarrow`, which is not in `requirements.txt`.
