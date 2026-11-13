/** How one word of a captioned recording moves. See autocwi/recording/README.md. */

import type {QuietRun} from "./caption-cues.ts";

/** `motion.live_sync.video_motion` in config.yaml, as served. */
export interface ReelMotion {
  cueLeadMs: number;
  cueHoldMs: number;
  leadMs: number;
  riseMs: number;
  fallMs: number;
  crouchEm: number;
  crouchMs: number;
  holdTrimMs: number;
  holdMaxMs: number;
  holdFromScale: number;
  holdFullScale: number;
  shrinkHoldGain: number;
  shrinkBelowScale: number;
  shrinkPreMs: number;
  bigSlowdown: number;
  slowdownMaxChange: number;
  resizeFromChange: number;
  liftFadeScale: [number, number];
  heldLiftEm: number;
  heldFromMs: number;
  heldPerCharMs: number;
  heldRampMs: number;
  heldMaxMs: number;
  heldTurnFrom: number;
  heldTurnFallShare: number;
  pushFromScale: number;
  pushFullScale: number;
  widenMax: number;
  widenFullChange: number;
  scaleRange: [number, number];
  scalePoints: Array<[number, number]>;
}

export interface ReelWord {
  /** The size the word is heading for; 1 is the line's own size. */
  scale: number;
  spokenMs: number;
  voicedFraction: number;
  letters: number;
}

/** What a word at rest wears on the stage this recording is drawn on. */
export interface ReelRest {
  liftEm: number;
  weight: number;
  heavyWeight: number;
}

export interface ReelPlan {
  leadMs: number;
  riseMs: number;
  holdMs: number;
  fallMs: number;
  crouchEm: number;
  liftEm: number;
  /** How long after its onset the word turns colour. */
  turnLagMs: number;
  /** Margin on each side at the crest, as a share of the word's width. */
  pushPerWidth: number;
  weight: number;
  /** The word changes size as one piece: no pop, no letter wave. */
  resized: boolean;
}

const STAYS_MS = 600000;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function ramp(value: number, from: number, to: number): number {
  return clamp((value - from) / Math.max(1e-6, to - from), 0, 1);
}

/** Loudness below which a word belongs to a quiet run. */
export function quietLoudnessEdge(reel: ReelMotion): number {
  return reel.scalePoints.find(([, above]) => above >= 0)?.[0] ?? 0;
}

export function countLetters(text: string): number {
  return Math.max(1, text.replace(/[^\p{L}\p{N}]/gu, "").length);
}

export function reelPlan(
  reel: ReelMotion,
  word: ReelWord,
  quietRun: QuietRun | undefined,
  rest: ReelRest,
): ReelPlan {
  const {scale} = word;
  const change = Math.abs(scale - 1);
  const shrinks = scale < reel.shrinkBelowScale;
  const run = shrinks ? quietRun : undefined;
  const voicedMs = word.spokenMs * word.voicedFraction;

  const drawnOut = clamp(
    (voicedMs - (reel.heldFromMs + reel.heldPerCharMs * word.letters))
      / Math.max(1, reel.heldRampMs),
    0, 1);
  const slow = 1 + reel.bigSlowdown * clamp(change, 0, reel.slowdownMaxChange);
  const riseMs = reel.riseMs * slow;
  const fallMs = reel.fallMs * slow;

  const departure = Math.max(scale - 1, (1 - scale) * reel.shrinkHoldGain);
  const sizeHold = clamp(
    (departure - (reel.holdFromScale - 1))
      / Math.max(1e-6, reel.holdFullScale - reel.holdFromScale),
    0, 1);
  const sizeHoldMs = sizeHold
    * clamp(
      word.spokenMs * (scale < 1 ? 1 : word.voicedFraction) - reel.holdTrimMs,
      0, reel.holdMaxMs);
  const drawnHoldMs = drawnOut * clamp(voicedMs - reel.riseMs, 0, reel.heldMaxMs);
  const holdMs = !run ? Math.max(sizeHoldMs, drawnHoldMs)
    : run.stays ? STAYS_MS
      : Math.max(0, run.spanMs - riseMs);

  const liftShare = shrinks ? 0
    : 1 - ramp(scale, reel.liftFadeScale[0], reel.liftFadeScale[1]);
  const restLiftEm = rest.liftEm * liftShare;

  const widening = scale > 1
    ? 1 + reel.widenMax * clamp((scale - 1) / reel.widenFullChange, 0, 1)
    : 1;
  const pushShare = scale < 1 ? 1
    : ramp(scale, reel.pushFromScale, reel.pushFullScale);

  return {
    leadMs: run ? run.leadMs : reel.leadMs,
    riseMs,
    holdMs,
    fallMs,
    crouchEm: shrinks ? 0 : reel.crouchEm * (1 + drawnOut),
    liftEm: restLiftEm + drawnOut * (reel.heldLiftEm - restLiftEm),
    turnLagMs: drawnOut > reel.heldTurnFrom
      ? riseMs + holdMs + fallMs * reel.heldTurnFallShare
      : 0,
    pushPerWidth: (scale * widening - 1) / 2 * pushShare,
    weight: scale < 1 ? rest.weight
      : rest.weight
        + ramp(scale, 1, reel.scaleRange[1]) * (rest.heavyWeight - rest.weight),
    resized: change > reel.resizeFromChange,
  };
}
