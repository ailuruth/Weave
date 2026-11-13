import assert from "node:assert/strict";
import test from "node:test";

import {mediaSyncAction} from "./media-sync.ts";

const playing = {paused: false, ended: false, durationS: 60};

test("the recording waits on its first frame until the playhead reaches it", () => {
  for (const playheadMs of [Number.NEGATIVE_INFINITY, Number.NaN, -1750]) {
    assert.deepEqual(
      mediaSyncAction({...playing, playheadMs, currentTimeS: 0, paused: true}),
      {kind: "hold"},
    );
  }
});

test("a paused recording starts ON the playhead, not from zero", () => {
  assert.deepEqual(
    mediaSyncAction({...playing, playheadMs: 4200, currentTimeS: 0, paused: true}),
    {kind: "play", atS: 4.2},
  );
});

test("a recording in step with the playhead runs at exactly 1x", () => {
  for (const currentTimeS of [10, 10.02, 9.98]) {
    assert.deepEqual(
      mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS}),
      {kind: "trim", rate: 1},
    );
  }
});

test("a small gap is closed by leaning the rate, never by a seek", () => {
  const behind = mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 9.86});
  const ahead = mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 10.14});
  assert.equal(behind.kind, "trim");
  assert.equal(ahead.kind, "trim");
  assert.ok(behind.kind === "trim" && behind.rate > 1 && behind.rate <= 1.05);
  assert.ok(ahead.kind === "trim" && ahead.rate < 1 && ahead.rate >= 0.95);
});

test("the lean eases off as the gap closes", () => {
  const far = mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 9.92});
  const near = mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 9.95});
  assert.ok(far.kind === "trim" && near.kind === "trim" && far.rate > near.rate);
});

test("a recording that has parted from the playhead is moved, either way", () => {
  assert.deepEqual(
    mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 10.6}),
    {kind: "seek", atS: 10},
  );
  assert.deepEqual(
    mediaSyncAction({...playing, playheadMs: 10_000, currentTimeS: 9.2}),
    {kind: "seek", atS: 10},
  );
});

test("a finished recording is never restarted by the running playhead", () => {
  assert.deepEqual(
    mediaSyncAction({
      playheadMs: 75_000, currentTimeS: 60, paused: true, ended: true,
      durationS: 60,
    }),
    {kind: "none"},
  );
  assert.deepEqual(
    mediaSyncAction({...playing, playheadMs: 61_000, currentTimeS: 59.9}),
    {kind: "none"},
  );
});

test("unknown duration does not block playback", () => {
  assert.deepEqual(
    mediaSyncAction({
      playheadMs: 500, currentTimeS: 0, paused: true, ended: false,
      durationS: Number.NaN,
    }),
    {kind: "play", atS: 0.5},
  );
});
