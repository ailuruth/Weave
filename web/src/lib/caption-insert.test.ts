import assert from "node:assert/strict";
import test from "node:test";

import {CAPTION_PRESETS, insertLine, linesOf, splitPoint, type EditWord} from "./caption-edit.ts";

function word(text: string, start: number, end: number, line: number): EditWord {
  return {id: text, text, start, end, speaker: "S1", size: 0.2, line};
}

const WORDS = [word("Hello", 1, 1.4, 0), word("there", 1.5, 2, 0), word("Bye", 5, 5.5, 1)];
const SHOUT = CAPTION_PRESETS.find((preset) => preset.id === "shout")!;
const DRAWN = CAPTION_PRESETS.find((preset) => preset.id === "drawn")!;

test("a caption added in a gap lands at the playhead as its own line, in time order", () => {
  const out = insertLine(WORDS, 3, "WHOOOOA!", "S2", SHOUT)!;
  assert.equal(out.index, 2);
  assert.deepEqual(out.words.map((w) => w.text), ["Hello", "there", "WHOOOOA!", "Bye"]);
  const added = out.words[2];
  assert.equal(added.start, 3);
  assert.equal(added.speaker, "S2");
  assert.equal(added.size, SHOUT.size);
  assert.equal(added.id, null);
  assert.equal(linesOf(out.words).length, 3);
});

test("a caption added while a line plays goes just after that line", () => {
  const out = insertLine(WORDS, 1.2, "wow", "S1", SHOUT)!;
  assert.ok(out.words[2].start >= 2);
  assert.equal(linesOf(out.words).length, 3);
});

test("a drawn-out caption is cut short by the next line", () => {
  const out = insertLine(WORDS, 4, "so long", null, DRAWN)!;
  const added = out.words.slice(2, 4);
  assert.ok(added[1].end <= 5);
  assert.deepEqual(added.map((w) => w.text), ["so", "long"]);
});

test("empty text adds nothing, and adding at the end appends", () => {
  assert.equal(insertLine(WORDS, 3, "   ", "S1", SHOUT), null);
  const out = insertLine(WORDS, 9, "end", "S1", DRAWN)!;
  assert.equal(out.index, 3);
  assert.equal(out.words.at(-1)!.text, "end");
});

test("a caption never runs past the end of the recording", () => {
  const out = insertLine(WORDS, 9.8, "WHOOOOA!", "S1", DRAWN, 10)!;
  const added = out.words.at(-1)!;
  assert.ok(added.end <= 10 + 1e-9);
  assert.ok(added.start >= 9.8 - 1e-9);
  const late = insertLine(WORDS, 10, "late", "S1", SHOUT, 10)!;
  assert.ok(late.words.at(-1)!.end <= 10 + 1e-9);
});

test("a caption added inside back-to-back lines goes after the last of them, in order", () => {
  const touching = [word("one", 1, 1.6, 0), word("two", 1.6, 2.4, 1), word("three", 2.45, 3, 2)];
  const out = insertLine(touching, 1.2, "WHOOOOA!", "S2", SHOUT, 3.6)!;
  const added = out.words[out.index];
  assert.equal(out.index, 3);
  assert.ok(added.start >= 3);
  assert.ok(added.end <= 3.6 + 1e-9);
  const starts = out.words.map((w) => w.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test("a preset sizes the whole line and times it, as far as the next line allows", async () => {
  const {applyPreset} = await import("./caption-edit.ts");
  const out = applyPreset(WORDS, 0, DRAWN);
  assert.ok(out.slice(0, 2).every((w) => w.size === DRAWN.size));
  assert.ok(out[1].end <= 5);
  assert.ok(out[1].end > 2);
  assert.equal(out[2].size, WORDS[2].size);
});

test("rainbow and a speaker colour exclude each other, and a line can be removed whole", async () => {
  const {setColour, removeLine} = await import("./caption-edit.ts");
  const rainbow = setColour(WORDS, 0, {rainbow: true}, true);
  assert.deepEqual(rainbow.map((w) => w.rainbow ?? false), [true, true, false]);
  const back = setColour(rainbow, 1, {speaker: "S2"}, false);
  assert.equal(back[1].rainbow, false);
  assert.equal(back[1].speaker, "S2");
  assert.equal(back[0].rainbow, true);
  assert.deepEqual(removeLine(WORDS, 1).map((w) => w.text), ["Bye"]);
});

test("a line's text is replaced in place, keeping words when the count holds", async () => {
  const {setLineText, parseClock} = await import("./caption-edit.ts");
  const same = setLineText(WORDS, 0, "Hi there");
  assert.deepEqual(same.slice(0, 2).map((w) => [w.text, w.id]), [["Hi", "Hello"], ["there", "there"]]);
  const more = setLineText(WORDS, 1, "Hello out there");
  assert.deepEqual(more.map((w) => w.text), ["Hello", "out", "there", "Bye"]);
  assert.ok(more.slice(0, 3).every((w) => w.id === null && w.line === 0));
  assert.equal(more[0].start, 1);
  assert.ok(Math.abs(more[2].end - 2) < 0.06);
  assert.deepEqual(setLineText(WORDS, 2, "  ").map((w) => w.text), ["Hello", "there"]);
  assert.equal(parseClock("1:02.5"), 62.5);
  assert.equal(parseClock("4.25"), 4.25);
  assert.equal(parseClock("abc"), null);
});

test("a caption splits at the word boundary nearest the cursor, never leaving a half empty", () => {
  const text = "What's your sole purpose";
  assert.equal(splitPoint(text, 12), 2);
  assert.equal(splitPoint(text, 13), 2);
  assert.equal(splitPoint(text, 15), 3);
  assert.equal(splitPoint(text, 0), 1);
  assert.equal(splitPoint(text, text.length), 3);
  assert.equal(splitPoint(text, null), 2);
  assert.equal(splitPoint("Gump!", 3), 0);
});

test("a tapped word stands out from its line, keeps the line's style, and taps back to its neighbours", async () => {
  const {toggleEmphasis, presetOf} = await import("./caption-edit.ts");
  const loud = toggleEmphasis(WORDS, 1);
  assert.deepEqual(loud.map((w) => w.size), [0.2, 0.6, 0.2]);
  assert.equal(presetOf(loud, 0)?.id, presetOf(WORDS, 0)?.id);
  assert.deepEqual(toggleEmphasis(loud, 1).map((w) => w.size), [0.2, 0.2, 0.2]);
});

test("a split lands exactly at the cursor, cutting a word when the cursor is inside it", async () => {
  const {splitLineAt} = await import("./caption-edit.ts");
  const between = splitLineAt(WORDS, 0, "Hello there", 6)!;
  assert.deepEqual(between.words.map((w) => [w.text, w.line]), [["Hello", 0], ["there", 1], ["Bye", 2]]);
  const inside = splitLineAt(WORDS, 0, "Hello there", 3)!;
  assert.deepEqual(inside.words.map((w) => [w.text, w.line]), [["Hel", 0], ["lo", 1], ["there", 1], ["Bye", 2]]);
  assert.ok(Math.abs(inside.words[0].end - 1.24) < 1e-9);
  assert.equal(inside.words[1].start, inside.words[0].end);
  assert.equal(inside.words[1].id, null);
  assert.equal(splitLineAt(WORDS, 0, "Hello there", 0), null);
  assert.deepEqual(splitLineAt(WORDS, 2, "Bye", 1)?.words.slice(2).map((w) => [w.text, w.line]), [["B", 1], ["ye", 2]]);
});

test("one word takes a style and a time of its own without crossing its neighbours", async () => {
  const {applyWordPreset, retimeWord, wordPresetOf} = await import("./caption-edit.ts");
  const slow = applyWordPreset(WORDS, 0, DRAWN);
  assert.equal(slow[0].size, DRAWN.size);
  assert.equal(slow[0].end, 1.5);
  assert.equal(slow[1].size, 0.2);
  assert.equal(wordPresetOf(slow[0])?.id, "drawn");
  const shout = applyWordPreset(WORDS, 2, SHOUT, 5.7);
  assert.equal(shout[2].end, 5.5);
  const moved = retimeWord(WORDS, 1, 0.5, 9);
  assert.equal(moved[1].start, 1.001);
  assert.equal(moved[1].end, 5);
  const squeezed = retimeWord(WORDS, 1, 1.8, 1.7);
  assert.ok(squeezed[1].end - squeezed[1].start >= 0.05 - 1e-9);
});
