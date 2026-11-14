import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_LINE_S,
  breakBefore,
  clockLabel,
  firstChange,
  joinPrevious,
  lineAt,
  lineForPlayhead,
  lineRoom,
  linesOf,
  moveLine,
  moveStart,
  nextSpeaker,
  playWindow,
  removeWord,
  retimeLine,
  setSize,
  setSpeaker,
  setText,
  type EditWord,
} from "./caption-edit.ts";

function word(text: string, start: number, line: number, speaker = "S1"): EditWord {
  return {id: `w:${text}`, text, start, end: start + 0.3, speaker, size: 0.2222, line};
}

const WORDS: EditWord[] = [
  word("Hello", 1.0, 0),
  word("world.", 1.4, 0),
  word("Who", 3.0, 1, "S2"),
  word("said", 3.3, 1, "S2"),
  word("that?", 3.6, 1, "S2"),
];

test("words group into the caption lines they are shown in", () => {
  assert.deepEqual(linesOf(WORDS), [
    {first: 0, last: 1, start: 1.0, end: 1.7},
    {first: 2, last: 4, start: 3.0, end: 3.9},
  ]);
  assert.equal(lineAt(linesOf(WORDS), 3)?.first, 2);
  assert.equal(lineAt(linesOf(WORDS), 9), null);
});

test("text is tidied and nothing else about the word moves", () => {
  const out = setText(WORDS, 1, "  brave   world. ");
  assert.equal(out[1].text, "brave world.");
  assert.deepEqual({...out[1], text: ""}, {...WORDS[1], text: ""});
  assert.equal(out[0], WORDS[0]);
});

test("a speaker goes on one word or on its whole line", () => {
  assert.deepEqual(
    setSpeaker(WORDS, 3, "S1", false).map((w) => w.speaker),
    ["S1", "S1", "S2", "S1", "S2"]);
  assert.deepEqual(
    setSpeaker(WORDS, 3, "S1", true).map((w) => w.speaker),
    ["S1", "S1", "S1", "S1", "S1"]);
});

test("size is clamped to what the stage can read", () => {
  assert.deepEqual(setSize(WORDS, 0, 1.4, true).map((w) => w.size),
    [1, 1, 0.2222, 0.2222, 0.2222]);
  assert.equal(setSize(WORDS, 4, -1, false)[4].size, 0);
});

test("a word moves in time without passing its neighbours or changing length", () => {
  const moved = moveStart(WORDS, 3, 3.45)[3];
  assert.equal(moved.start, 3.45);
  assert.equal(moved.end, 3.75);
  assert.equal(moveStart(WORDS, 3, 0)[3].start, 3.001);
  assert.equal(moveStart(WORDS, 3, 99)[3].start, 3.599);
  assert.equal(moveStart(WORDS, 4, 99)[4].start, 99);
  assert.equal(moveStart(WORDS, 0, -5)[0].start, 0);
});

test("a line can be broken at a word and joined back", () => {
  const broken = breakBefore(WORDS, 3);
  assert.deepEqual(broken.map((w) => w.line), [0, 0, 1, 2, 2]);
  assert.deepEqual(joinPrevious(broken, 4).map((w) => w.line), [0, 0, 1, 1, 1]);
  assert.deepEqual(joinPrevious(WORDS, 2).map((w) => w.line), [0, 0, 0, 0, 0]);
  assert.deepEqual(joinPrevious(WORDS, 0).map((w) => w.line), [0, 0, 1, 1, 1]);
});

test("removing a word leaves the rest in order", () => {
  assert.deepEqual(removeWord(WORDS, 2).map((w) => w.text),
    ["Hello", "world.", "said", "that?"]);
});

test("a new speaker takes the next unused name", () => {
  assert.equal(nextSpeaker(["S1", "S2"]), "S3");
  assert.equal(nextSpeaker(["S1", "S3"]), "S4");
  assert.equal(nextSpeaker([]), "S1");
});

test("previewing a word plays its whole line", () => {
  assert.deepEqual(playWindow(WORDS, 3), {from: 3.0, until: 3.9});
  assert.deepEqual(playWindow(WORDS, 99), {from: 3.0, until: 3.9});
  assert.equal(playWindow([], 0), null);
});

test("undo replays the first word that differs", () => {
  assert.equal(firstChange(WORDS, setSpeaker(WORDS, 3, "S1", true)), 2);
  assert.equal(firstChange(WORDS, removeWord(WORDS, 4)), 3);
  assert.equal(firstChange(WORDS, WORDS), 4);
  assert.equal(firstChange(WORDS, []), 0);
});

test("times read as minutes, seconds and tenths", () => {
  assert.equal(clockLabel(0), "0:00.0");
  assert.equal(clockLabel(7.75), "0:07.8");
  assert.equal(clockLabel(125.04), "2:05.0");
});

test("a line stretched from its start keeps each word's share and stays clear of its neighbours", () => {
  const out = retimeLine(WORDS, 2, 4, 2.4, 3.9);
  assert.deepEqual(out.slice(2).map((w) => [w.start, w.end]), [[2.4, 2.9], [2.9, 3.4], [3.4, 3.9]]);
  assert.equal(out[2].start, 2.4);
  assert.equal(out[4].end, 3.9);
  assert.ok(out[2].end <= out[3].start + 1e-9 && out[3].end <= out[4].start + 1e-9);
  assert.equal(retimeLine(WORDS, 2, 4, 0.5, 3.9)[2].start, 1.7, "not before the previous word ends");
  assert.equal(out[0], WORDS[0]);
});

test("a line moved too far stops at its neighbour, and a squeezed line keeps a minimum length", () => {
  assert.equal(moveLine(WORDS, 2, 4, -5)[2].start, 1.7);
  assert.equal(moveLine(WORDS, 0, 1, 10)[0].start, 1.0 + (3.0 - 1.7));
  const short = retimeLine(WORDS, 2, 4, 3.8, 3.9);
  assert.ok(short[4].end - short[2].start >= MIN_LINE_S - 1e-9);
  assert.deepEqual(lineRoom(WORDS, 2, 4), {minS: 1.7, maxS: Number.POSITIVE_INFINITY});
});

test("the timing keys act on the line under the playhead, or the last one before it", () => {
  const lines = linesOf(WORDS);
  assert.equal(lineForPlayhead(lines, 3.4)?.first, 2);
  assert.equal(lineForPlayhead(lines, 2.5)?.first, 0);
  assert.equal(lineForPlayhead(lines, 0.2)?.first, 0);
  assert.equal(lineForPlayhead([], 1), null);
});
