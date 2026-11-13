/** ONE CAPTION LINE AT A TIME, for a recording.

    The live stage is a rolling transcript, because nobody knows where a live
    sentence will end. A recording is analysed whole, so the server can say
    which caption line every word belongs to (`word.cue`), and the stage can
    do what a captioned film does: put one line on screen, complete, and
    replace it with the next.

    Measured off the PR film: a caption appears a few frames before its first
    word turns and stays until the next one replaces it, or a little past its
    last word when nothing follows. */

import type {CaptionWord} from "./caption-store.ts";

export interface CueWord {
  id: string;
  word: CaptionWord;
}

export interface CaptionCue {
  cue: number;
  /** Acoustic onset of the first word, ms. */
  startMs: number;
  /** Acoustic end of the last word, ms. */
  endMs: number;
  words: CueWord[];
}

function onsetMs(word: CaptionWord): number {
  return Number(word.t ?? word.start ?? 0) * 1000;
}

function endMs(word: CaptionWord): number {
  return onsetMs(word)
    + Math.max(0, Number(word.end ?? 0) - Number(word.start ?? 0)) * 1000;
}

/** Group the recording's words into caption lines, in order. Words without a
   `cue` are not part of any line and are left out: a live session has none,
   and this returns an empty list for it. */
export function buildCues(words: CueWord[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const entry of words) {
    const cue = entry.word.cue;
    if (typeof cue !== "number" || !Number.isFinite(cue)) continue;
    const last = cues.at(-1);
    if (last && last.cue === cue) {
      last.words.push(entry);
      last.endMs = Math.max(last.endMs, endMs(entry.word));
    } else {
      cues.push({
        cue,
        startMs: onsetMs(entry.word),
        endMs: endMs(entry.word),
        words: [entry],
      });
    }
  }
  return cues;
}

/** Measured off the PR film: a caption is on screen 4-6 frames (24 fps)
   before its first word turns. */
export const CUE_LEAD_MS = 250;
/** ...and a caption with nothing after it is gone well inside a second. */
export const CUE_HOLD_MS = 600;

export interface CueTiming {
  /** How long before its first word a line is drawn. */
  leadMs: number;
  /** How long a line with nothing after it outlives its last word. */
  holdMs: number;
}

/** The line that should be on screen at `playheadMs`, or null.

    The newest line whose lead-in has begun wins, so a line is replaced the
    moment the next one is due and two are never up together. A line with a
    gap after it leaves `holdMs` past its last word, so a caption does not sit
    over a silent shot. */
export function activeCue(
  cues: CaptionCue[],
  playheadMs: number,
  {leadMs, holdMs}: CueTiming,
): CaptionCue | null {
  if (!Number.isFinite(playheadMs)) return null;
  let current: CaptionCue | null = null;
  for (const cue of cues) {
    if (playheadMs >= cue.startMs - leadMs) current = cue;
    else break;
  }
  if (!current) return null;
  return playheadMs <= current.endMs + holdMs ? current : null;
}
