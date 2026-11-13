/** ONE CAPTION LINE AT A TIME, for a recording. */

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

/** Group the recording's words into caption lines, in order. */
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

/** Measured off the PR film: a caption is on screen 4-6 frames (24 fps) before its first word turns. */
export const CUE_LEAD_MS = 250;
/** ...and a caption with nothing after it is gone well inside a second. */
export const CUE_HOLD_MS = 600;

export interface CueTiming {
  /** How long before its first word a line is drawn. */
  leadMs: number;
  /** How long a line with nothing after it outlives its last word. */
  holdMs: number;
}

/** The line that should be on screen at `playheadMs`, or null. */
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

/** HOW A RUN OF QUIET WORDS MOVES, on one caption line. */
export interface QuietRun {
  /** How long before THIS word's own onset its shrink begins. */
  leadMs: number;
  /** From the start of the run's shrink to the end of its last word. */
  spanMs: number;
  /** The run ends the caption line: stay small until the line is replaced. */
  stays: boolean;
}

export function quietRuns(
  cues: CaptionCue[],
  isQuiet: (word: CaptionWord) => boolean,
  preMs: number,
): Map<string, QuietRun> {
  const runs = new Map<string, QuietRun>();
  for (const cue of cues) {
    let i = 0;
    while (i < cue.words.length) {
      if (!isQuiet(cue.words[i].word)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < cue.words.length && isQuiet(cue.words[j + 1].word)) j += 1;
      const startMs = onsetMs(cue.words[i].word) - preMs;
      const spanMs = endMs(cue.words[j].word) - startMs;
      const stays = j === cue.words.length - 1;
      for (let k = i; k <= j; k += 1) {
        runs.set(cue.words[k].id, {
          leadMs: onsetMs(cue.words[k].word) - startMs,
          spanMs,
          stays,
        });
      }
      i = j + 1;
    }
  }
  return runs;
}
