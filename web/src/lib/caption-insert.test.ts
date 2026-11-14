import assert from "node:assert/strict";
import test from "node:test";

import {CAPTION_PRESETS, insertLine, linesOf, type EditWord} from "./caption-edit.ts";

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
