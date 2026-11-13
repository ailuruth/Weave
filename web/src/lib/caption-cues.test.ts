import assert from "node:assert/strict";
import test from "node:test";

import {activeCue, buildCues, quietRuns} from "./caption-cues.ts";
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

function loud(id: string, cue: number, t: number, loudness: number, dur = 0.3) {
  return {
    id,
    word: {text: id, start: 0, end: dur, t, cue, loudness} as CaptionWord,
  };
}

const quiet = (w: CaptionWord) => Number(w.loudness) < 0.14;

test("quiet words in a row shrink together, before the first is spoken", () => {
  const cues = buildCues([
    loud("gets", 0, 1.0, 0.3), loud("louder", 0, 1.5, 1.0),
    loud("or", 0, 2.2, 0.02), loud("softer", 0, 2.5, 0.05, 0.5),
  ]);
  const runs = quietRuns(cues, quiet, 200);
  assert.deepEqual([...runs.keys()], ["or", "softer"]);
  // both begin at the same moment: 200 ms before "or"
  assert.equal(runs.get("or")?.leadMs, 200);
  assert.equal(runs.get("softer")?.leadMs, 500);
  // ...and share one window, to the end of "softer"
  assert.equal(runs.get("or")?.spanMs, 1000);
  assert.equal(runs.get("softer")?.spanMs, 1000);
});

test("a quiet run that ends the line stays small; one inside it comes back", () => {
  const ending = quietRuns(buildCues([
    loud("a", 0, 1.0, 0.3), loud("b", 0, 1.4, 0.05),
  ]), quiet, 200);
  assert.equal(ending.get("b")?.stays, true);
  const inside = quietRuns(buildCues([
    loud("a", 0, 1.0, 0.05), loud("b", 0, 1.4, 0.3),
  ]), quiet, 200);
  assert.equal(inside.get("a")?.stays, false);
});

test("a run never crosses from one caption line into the next", () => {
  const runs = quietRuns(buildCues([
    loud("a", 0, 1.0, 0.05), loud("b", 1, 1.4, 0.05),
  ]), quiet, 200);
  assert.equal(runs.get("a")?.spanMs, 500);
  assert.equal(runs.get("b")?.leadMs, 200);
});
