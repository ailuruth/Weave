import assert from "node:assert/strict";
import test from "node:test";

import {activeCue, buildCues} from "./caption-cues.ts";
import type {CaptionWord} from "./caption-store.ts";

function word(id: string, cue: number | undefined, t: number, dur = 0.3) {
  return {
    id,
    word: {text: id, start: 0, end: dur, t, cue} as CaptionWord,
  };
}

const timing = {leadMs: 250, holdMs: 600};

test("words are grouped into their caption lines, in order", () => {
  const cues = buildCues([
    word("a", 0, 1.0), word("b", 0, 1.4),
    word("c", 1, 3.0),
  ]);
  assert.deepEqual(cues.map((c) => c.words.map((w) => w.id)), [["a", "b"], ["c"]]);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 1700);
});

test("a live session has no caption lines", () => {
  assert.deepEqual(buildCues([word("a", undefined, 1.0)]), []);
});

test("a line is drawn a little before its first word and not earlier", () => {
  const cues = buildCues([word("a", 0, 1.0)]);
  assert.equal(activeCue(cues, 700, timing), null);
  assert.equal(activeCue(cues, 760, timing)?.cue, 0);
});

test("the next line replaces the current one; two are never up together", () => {
  const cues = buildCues([word("a", 0, 1.0), word("b", 1, 1.5)]);
  assert.equal(activeCue(cues, 1200, timing)?.cue, 0);
  assert.equal(activeCue(cues, 1260, timing)?.cue, 1);
});

test("a line with nothing after it leaves shortly after its last word", () => {
  const cues = buildCues([word("a", 0, 1.0), word("b", 1, 9.0)]);
  assert.equal(activeCue(cues, 1300 + 590, timing)?.cue, 0);
  assert.equal(activeCue(cues, 1300 + 610, timing), null);
  assert.equal(activeCue(cues, 8800, timing)?.cue, 1);
});

test("nothing is shown before the clock starts", () => {
  const cues = buildCues([word("a", 0, 0.0)]);
  assert.equal(activeCue(cues, Number.NEGATIVE_INFINITY, timing), null);
});
