import assert from "node:assert/strict";
import test from "node:test";

import type {CaptionEvent} from "./caption-store.ts";
import {
  dueBetween,
  fitView,
  followView,
  levelBars,
  lineAt,
  minorTicks,
  nextLineStart,
  panView,
  positionLabel,
  previousLineStart,
  releasedBy,
  rulerTicks,
  scoreLevels,
  scoreLines,
  scoreSounds,
  seekBatch,
  tickLabel,
  zoomView,
  type ScoreEntry,
} from "./transport.ts";

function word(id: string, text: string, t: number, cue: number, speaker = "S1"): CaptionEvent {
  return {type: "word", word_id: id, text, t, start: 0, end: 0.3, cue, speaker};
}

function level(t: number, db = -30): CaptionEvent {
  return {type: "level", t, rms_db: db};
}

const SCORE: ScoreEntry[] = [
  [0, {type: "restage", speakers: ["S1", "S2"]}],
  [0, level(0)],
  [0.5, level(0.5)],
  [1.0, word("a", "Hello", 1.0, 0)],
  [1.0, word("b", "world.", 1.4, 0)],
  [1.0, level(1.0, -20)],
  [1.5, level(1.5)],
  [3.0, word("c", "Who", 3.0, 1, "S2")],
  [3.0, word("d", "said", 3.3, 1, "S2")],
  [3.0, word("e", "that?", 3.6, 1, "S1")],
  [3.0, level(3.0)],
];

test("events released by a moment are found by their release time", () => {
  assert.equal(releasedBy(SCORE, -1), 0);
  assert.equal(releasedBy(SCORE, 1.0), 6);
  assert.equal(releasedBy(SCORE, 2.9), 7);
  assert.equal(releasedBy(SCORE, 99), SCORE.length);
});

test("a seek hands the stage what it would hold, without the levels in between", () => {
  const batch = seekBatch(SCORE, 2.0, 150);
  assert.deepEqual(batch.events.map((e) => e.word_id), ["a", "b"]);
  assert.equal(batch.level?.t, 1.5);
  assert.equal(batch.next, 7);
  const capped = seekBatch(SCORE, 5, 2);
  assert.deepEqual(capped.events.map((e) => e.word_id), ["d", "e"]);
  assert.deepEqual(seekBatch(SCORE, -1, 10), {events: [], level: null, next: 0});
});

test("while playing, each frame takes what was released since the last", () => {
  const first = dueBetween(SCORE, 0, 1.2);
  assert.deepEqual(first.events.map((e) => e.word_id), ["a", "b"]);
  assert.equal(first.level?.t, 1.0);
  const quiet = dueBetween(SCORE, first.next, 1.3);
  assert.deepEqual(quiet, {events: [], level: null, next: first.next});
  const later = dueBetween(SCORE, first.next, 3.0);
  assert.deepEqual(later.events.map((e) => e.word_id), ["c", "d", "e"]);
});

test("the timeline's lines come from the words, with the speaker most of them carry", () => {
  const lines = scoreLines(SCORE);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {cue: 0, startS: 1.0, endS: 1.7, text: "Hello world.", speaker: "S1"});
  assert.equal(lines[1].speaker, "S2");
  assert.equal(lines[1].endS, 3.9);
  assert.deepEqual(scoreLevels(SCORE).slice(0, 2), [[0, -30], [0.5, -30]]);
});

test("the line on screen is the one whose lead has begun and whose hold has not ended", () => {
  const lines = scoreLines(SCORE);
  assert.equal(lineAt(lines, 0.5, 0.25, 0.6), null);
  assert.equal(lineAt(lines, 0.8, 0.25, 0.6)?.cue, 0);
  assert.equal(lineAt(lines, 2.2, 0.25, 0.6)?.cue, 0);
  assert.equal(lineAt(lines, 2.4, 0.25, 0.6), null);
  assert.equal(lineAt(lines, 2.8, 0.25, 0.6)?.cue, 1);
});

test("previous goes to this line's start, then the one before; next goes to the following line", () => {
  const lines = scoreLines(SCORE);
  assert.equal(previousLineStart(lines, 3.5), 3.0);
  assert.equal(previousLineStart(lines, 3.1), 1.0);
  assert.equal(previousLineStart(lines, 1.1), 0);
  assert.equal(nextLineStart(lines, 0), 1.0);
  assert.equal(nextLineStart(lines, 1.0), 3.0);
  assert.equal(nextLineStart(lines, 3.0), null);
});

test("a short recording is shown whole; a long one in a window", () => {
  assert.deepEqual(fitView(14), {startS: 0, endS: 14});
  assert.deepEqual(fitView(0.5), {startS: 0, endS: 2});
  assert.deepEqual(fitView(600), {startS: 0, endS: 30});
});

test("zooming keeps the point under the pointer still and stays inside the recording", () => {
  const view = {startS: 0, endS: 20};
  assert.deepEqual(zoomView(view, 0.5, 10, 20), {startS: 5, endS: 15});
  assert.deepEqual(zoomView(view, 0.5, 0, 20), {startS: 0, endS: 10});
  assert.deepEqual(zoomView(view, 4, 10, 20), {startS: 0, endS: 20});
  assert.deepEqual(zoomView({startS: 4, endS: 6}, 0.1, 5, 20), {startS: 4, endS: 6});
  assert.deepEqual(panView({startS: 5, endS: 15}, 100, 20), {startS: 10, endS: 20});
  assert.deepEqual(panView({startS: 5, endS: 15}, -100, 20), {startS: 0, endS: 10});
});

test("the view follows a playing playhead a page at a time", () => {
  const view = {startS: 0, endS: 30};
  assert.equal(followView(view, 10, 600), view);
  assert.deepEqual(followView(view, 29, 600), {startS: 26, endS: 56});
  assert.deepEqual(followView(view, 300, 600), {startS: 297, endS: 327});
  assert.deepEqual(followView(view, 599, 600), {startS: 570, endS: 600});
});

test("ruler ticks stay readable at every zoom", () => {
  assert.deepEqual(rulerTicks({startS: 0, endS: 14}, 1000), {step: 2, ticks: [0, 2, 4, 6, 8, 10, 12, 14]});
  assert.equal(rulerTicks({startS: 0, endS: 2}, 1000).step, 0.2);
  assert.equal(rulerTicks({startS: 0, endS: 600}, 1000).step, 60);
  assert.equal(rulerTicks({startS: 3.3, endS: 5.3}, 1000).ticks[0], 3.4);
  assert.equal(tickLabel(62, 1), "1:02");
  assert.equal(tickLabel(3.4, 0.2), "0:03.4");
  assert.equal(positionLabel(6.537), "0:06.54");
  assert.equal(positionLabel(125.5), "2:05.50");
});

test("the waveform takes the loudest reading in each slice, and holds it across empty slices", () => {
  const levels: Array<[number, number]> = [[0, -60], [0.4, -35], [0.6, -10], [1.5, -80], [3, -20]];
  assert.deepEqual(levelBars(levels, {startS: 0, endS: 2}, 4), [0.5, 1, 1, 0]);
  const sparse: Array<[number, number]> = [[0, -35], [1, -10]];
  assert.deepEqual(levelBars(sparse, {startS: 0, endS: 2}, 8), [0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1]);
  assert.deepEqual(levelBars(sparse, {startS: -2, endS: 0}, 2), [0, 0]);
  assert.deepEqual(levelBars(levels, {startS: 0, endS: 0}, 3), [0, 0, 0]);
  assert.deepEqual(levelBars([], {startS: 0, endS: 2}, 2), [0, 0]);
});

test("sound captions span from their start to their end, or to the end of the recording", () => {
  const events: ScoreEntry[] = [
    [2.2, {type: "sound", state: "start", label: "Beep", start: 2.2, end: 2.2}],
    [2.9, {type: "sound", state: "end", label: "Beep", start: 2.2, end: 2.9}],
    [5.0, {type: "sound", state: "start", category: "music", start: 5.0, end: 5.0}],
    [1.0, word("a", "Hi", 1.0, 0)],
  ];
  assert.deepEqual(scoreSounds(events, 8), [
    {startS: 2.2, endS: 2.9, label: "Beep"},
    {startS: 5.0, endS: 8, label: "music"},
  ]);
});

test("minor ticks fall between the labelled ones and never on them", () => {
  assert.deepEqual(minorTicks({startS: 0, endS: 2}, 1), [0.2, 0.4, 0.6, 0.8, 1.2, 1.4, 1.6, 1.8]);
  assert.deepEqual(minorTicks({startS: 0, endS: 4}, 2), [0.5, 1, 1.5, 2.5, 3, 3.5]);
  assert.deepEqual(minorTicks({startS: 0, endS: 30}, 15), [5, 10, 20, 25]);
  assert.deepEqual(minorTicks({startS: 0, endS: 1}, 7), []);
});
