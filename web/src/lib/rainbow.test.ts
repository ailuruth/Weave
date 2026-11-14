import assert from "node:assert/strict";
import test from "node:test";

import {RAINBOW_FROM, RAINBOW_TO, rainbowPair} from "./rainbow.ts";

test("every letter of a rainbow word gets its own pair, repeating after the palette runs out", () => {
  assert.equal(RAINBOW_FROM.length, RAINBOW_TO.length);
  assert.deepEqual(rainbowPair(0), {from: "#e8dd31", to: "#ee6f7d"});
  assert.deepEqual(rainbowPair(RAINBOW_FROM.length + 2), rainbowPair(2));
  assert.notEqual(rainbowPair(1).from, rainbowPair(2).from);
});
