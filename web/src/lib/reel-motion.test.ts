import assert from "node:assert/strict";
import test from "node:test";

import {
  countSounds,
  quietLoudnessEdge,
  reelPlan,
  type ReelMotion,
  type ReelWord,
} from "./reel-motion.ts";

const reel: ReelMotion = {
  cueLeadMs: 250, cueHoldMs: 600,
  leadMs: 40, riseMs: 163, fallMs: 209, crouchEm: 0.057, crouchMs: 130,
  holdTrimMs: 100, holdMaxMs: 700, holdFromScale: 1.15, holdFullScale: 1.45,
  shrinkHoldGain: 1.5, shrinkBelowScale: 0.98, shrinkPreMs: 40,
  bigSlowdown: 0.55, slowdownMaxChange: 1.2, resizeFromChange: 0.12,
  liftFadeScale: [1.1, 1.3],
  heldLiftEm: 0.45, heldFromMs: 250, heldPerCharMs: 60, heldRampMs: 300,
  heldMaxMs: 1200, heldTurnFrom: 0.5, heldTurnFallShare: 0.4,
  pushFromScale: 1.5, pushFullScale: 1.9, widenMax: 0.14, widenFullChange: 0.9,
  scaleRange: [0.5, 2.0],
  scalePoints: [[0, -0.5], [0.08, -0.45], [0.14, 0], [0.26, 0],
                [0.45, 0.15], [0.75, 0.36], [1, 0.8]],
};

const rest = {liftEm: 0.16, weight: 400, heavyWeight: 900};

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

function spoken(text: string, scale: number, spokenMs: number, voicedFraction = 1): ReelWord {
  return {scale, spokenMs, voicedFraction, letters: countSounds(text)};
}

test("an ordinary word rises and falls on the film's clock, with no hold", () => {
  const plan = reelPlan(reel, spoken("the", 1, 180), undefined, rest);
  assert.equal(plan.leadMs, 40);
  assert.equal(plan.riseMs, 163);
  assert.equal(plan.fallMs, 209);
  assert.equal(plan.holdMs, 0);
  assert.equal(plan.turnLagMs, 0);
  assert.equal(plan.liftEm, 0.16);
  assert.equal(plan.crouchEm, 0.057);
  assert.equal(plan.weight, 400);
  assert.equal(plan.pushPerWidth, 0);
  assert.equal(plan.resized, false);
});

test("a big word holds while it is spoken, moves slower and gives up the lift", () => {
  const plan = reelPlan(reel, spoken("louder", 1.9, 620), undefined, rest);
  assert.equal(plan.holdMs, 520);
  assert.ok(plan.riseMs > 163 * 1.4 && plan.fallMs > 209 * 1.4);
  assert.ok(plan.liftEm < 0.02);
  assert.equal(plan.resized, true);
  assert.equal(plan.turnLagMs, 0);
});

test("a big word pushes its neighbours aside and wears the heavy weight", () => {
  const ordinaryPop = reelPlan(reel, spoken("seen", 1.45, 300), undefined, rest);
  const loudest = reelPlan(reel, spoken("louder", 2, 620), undefined, rest);
  assert.equal(ordinaryPop.pushPerWidth, 0);
  assert.ok(loudest.pushPerWidth > 0.5);
  assert.equal(loudest.weight, 900);
  assert.ok(ordinaryPop.weight > 400 && ordinaryPop.weight < 900);
});

test("a small pop gets no hold", () => {
  assert.equal(reelPlan(reel, spoken("seen", 1.1, 400), undefined, rest).holdMs, 0);
});

test("a short word the speaker draws out floats, and turns colour as it lands", () => {
  const plan = reelPlan(reel, spoken("is", 1, 800), undefined, rest);
  near(plan.liftEm, 0.45);
  near(plan.holdMs, 800 - 163);
  near(plan.crouchEm, 0.057 * 2);
  near(plan.turnLagMs, plan.riseMs + plan.holdMs + plan.fallMs * 0.4);
});

test("a word that is long because it has many letters is not drawn out", () => {
  const plan = reelPlan(reel, spoken("louder", 1, 620), undefined, rest);
  assert.ok(plan.liftEm < 0.2);
  assert.equal(plan.turnLagMs, 0);
});

test("a quiet run shrinks ahead of its first word and comes back after its last", () => {
  const run = {leadMs: 340, spanMs: 1000, stays: false};
  const plan = reelPlan(reel, spoken("or", 0.6, 250), run, rest);
  assert.equal(plan.leadMs, 340);
  assert.equal(plan.holdMs, 1000 - plan.riseMs);
  assert.equal(plan.crouchEm, 0);
  assert.equal(plan.liftEm, 0);
  assert.equal(plan.weight, 400);
  assert.ok(plan.pushPerWidth < 0);
});

test("a quiet run that ends its line stays small", () => {
  const run = {leadMs: 40, spanMs: 500, stays: true};
  const plan = reelPlan(reel, spoken("softer", 0.6, 500), run, rest);
  assert.ok(plan.holdMs > 60_000);
});

test("a word at the line's own size ignores a quiet run it was listed in", () => {
  const run = {leadMs: 340, spanMs: 1000, stays: true};
  const plan = reelPlan(reel, spoken("or", 1, 250), run, rest);
  assert.equal(plan.leadMs, 40);
  assert.equal(plan.holdMs, 0);
});

test("the quiet edge is where the size mapping stops shrinking", () => {
  assert.equal(quietLoudnessEdge(reel), 0.14);
});

test("letters are counted without punctuation", () => {
  assert.equal(countSounds("wow,"), 3);
  assert.equal(countSounds("louder"), 6);
  assert.equal(countSounds("..."), 1);
});

test("a Hangul block counts the sounds written inside it", () => {
  assert.equal(countSounds("널리"), 5);
  assert.equal(countSounds("야생동물들을"), 15);
  assert.equal(countSounds("칭한다."), 8);
});

test("a Korean word read at an ordinary pace is not drawn out", () => {
  const plan = reelPlan(
    reel,
    {scale: 1, spokenMs: 895, voicedFraction: 1, letters: countSounds("야생동물들을")},
    undefined, rest);
  assert.equal(plan.turnLagMs, 0);
  assert.ok(plan.liftEm < 0.2);
});
