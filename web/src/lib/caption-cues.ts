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

/** The widest a caption line may be, as a share of the picture's width. */
export const CUE_FRAME_SHARE = 0.92;

export interface CueWordWidth {
  width: number;
  /** The largest the word grows to, from its crest or its pop. */
  scale: number;
}

/** The line with every word at its crest at once, pushing its neighbours apart: never narrower than the real crest. */
export function crestWidth(rest: number, words: CueWordWidth[], widenMax: number): number {
  return words.reduce((width, word) => {
    const grown = word.scale > 1 ? word.scale * (1 + widenMax) : 1;
    return width + (grown - 1) * word.width;
  }, rest);
}

/** How far a caption line is narrowed to fit the picture, as a factor on its type.

    At size 1 and below only the line at rest is fitted. A larger size makes a
    short line wide enough for a crest to leave the frame, so above 1 the crest
    is fitted too, but never below the type the line has at size 1. */
export function cueFit(
  frame: number, size: number, rest: number, crest: number,
): number {
  const room = frame * CUE_FRAME_SHARE;
  const restFit = Math.min(1, room / rest);
  if (size <= 1) return restFit;
  const sizeOneFit = Math.min(1, (size * room) / rest) / size;
  return Math.max(sizeOneFit, Math.min(restFit, room / crest));
}
