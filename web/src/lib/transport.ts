/** PLAYING A RECORDING IN THE STUDIO: the score, where the playhead may go,
   and the timeline drawn under the stage. Times are seconds on the
   recording. A score's release times are on the acoustic clock, which runs
   the read-ahead delay ahead of the picture. */

import type {CaptionEvent} from "./caption-store.ts";

export type ScoreEntry = [number, CaptionEvent];

export interface Score {
  generation: number;
  speakers: string[];
  durationS: number;
  events: ScoreEntry[];
}

/** One caption line, as the timeline draws it. */
export interface TimelineLine {
  cue: number;
  startS: number;
  endS: number;
  text: string;
  speaker: string | null;
  /** Drawn in the rainbow rather than a speaker's colour. */
  rainbow?: boolean;
}

export interface View {
  startS: number;
  endS: number;
}

/** What to hand the stage at one moment: the events in order and, for the meters, only the newest level. */
export interface Batch {
  events: CaptionEvent[];
  level: CaptionEvent | null;
  next: number;
}

function isLevel(event: CaptionEvent): boolean {
  return event.type === "level";
}

/** The index of the first event released after `acousticS`. */
export function releasedBy(events: readonly ScoreEntry[], acousticS: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle][0] <= acousticS) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Everything the stage would hold had it played to `acousticS`: its last `keep` events, not counting levels. */
export function seekBatch(
  events: readonly ScoreEntry[],
  acousticS: number,
  keep: number,
): Batch {
  const next = releasedBy(events, acousticS);
  const kept: CaptionEvent[] = [];
  let level: CaptionEvent | null = null;
  for (let index = next - 1; index >= 0; index -= 1) {
    const event = events[index][1];
    if (event.type === "restage") continue;
    if (isLevel(event)) {
      level ??= event;
    } else if (kept.length < keep) {
      kept.push(event);
    }
    if (level && kept.length >= keep) break;
  }
  return {events: kept.reverse(), level, next};
}

/** The events released after `from` and by `acousticS`. */
export function dueBetween(
  events: readonly ScoreEntry[],
  from: number,
  acousticS: number,
): Batch {
  const next = Math.max(from, releasedBy(events, acousticS));
  const due: CaptionEvent[] = [];
  let level: CaptionEvent | null = null;
  for (let index = from; index < next; index += 1) {
    const event = events[index][1];
    if (event.type === "restage") continue;
    if (isLevel(event)) level = event;
    else due.push(event);
  }
  return {events: due, level, next};
}

/** The caption lines of a score, in order. */
export function scoreLines(events: readonly ScoreEntry[]): TimelineLine[] {
  const byCue = new Map<number, {words: CaptionEvent[]}>();
  for (const [, event] of events) {
    if (event.type !== "word" || typeof event.cue !== "number") continue;
    const line = byCue.get(event.cue) ?? {words: []};
    line.words.push(event);
    byCue.set(event.cue, line);
  }
  return [...byCue.entries()]
    .map(([cue, {words}]) => {
      const onsets = words.map((word) => Number(word.t ?? word.start ?? 0));
      const ends = words.map((word, index) =>
        onsets[index] + Math.max(0, Number(word.end ?? 0) - Number(word.start ?? 0)));
      const counts = new Map<string, number>();
      for (const word of words) {
        if (typeof word.speaker === "string") {
          counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
        }
      }
      const speaker = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const rainbow = words.some((word) => word.rainbow === true);
      return {
        cue,
        startS: Math.min(...onsets),
        endS: Math.max(...ends),
        text: words.map((word) => String(word.text ?? "").trim()).join(" "),
        speaker,
        ...(rainbow ? {rainbow} : {}),
      };
    })
    .sort((a, b) => a.startS - b.startS);
}

/** The level readings of a score, as [time, dBFS]. */
export function scoreLevels(events: readonly ScoreEntry[]): Array<[number, number]> {
  const levels: Array<[number, number]> = [];
  for (const [, event] of events) {
    if (!isLevel(event)) continue;
    const t = Number(event.t);
    const db = Number(event.rms_db);
    if (Number.isFinite(t) && Number.isFinite(db)) levels.push([t, db]);
  }
  return levels;
}

/** The line on screen at `positionS`, or null. */
export function lineAt(
  lines: readonly TimelineLine[],
  positionS: number,
  leadS: number,
  holdS: number,
): TimelineLine | null {
  let found: TimelineLine | null = null;
  for (const line of lines) {
    if (positionS >= line.startS - leadS) found = line;
    else break;
  }
  return found && positionS <= found.endS + holdS ? found : null;
}

/** Where "previous line" goes: the start of this line, or of the one before when already near its start. */
export function previousLineStart(
  lines: readonly TimelineLine[],
  positionS: number,
  nearS = 0.3,
): number {
  let target = 0;
  for (const line of lines) {
    if (line.startS < positionS - nearS) target = line.startS;
    else break;
  }
  return target;
}

/** Where "next line" goes: the start of the first line after `positionS`, or null at the last. */
export function nextLineStart(
  lines: readonly TimelineLine[],
  positionS: number,
): number | null {
  for (const line of lines) {
    if (line.startS > positionS + 0.01) return line.startS;
  }
  return null;
}

/** The shortest stretch of time the timeline may show. */
export const MIN_VIEW_S = 2;
/** A recording up to this long is shown whole; a longer one in a window this wide. */
export const WHOLE_VIEW_S = 60;
export const DEFAULT_WINDOW_S = 30;

export function fitView(durationS: number): View {
  const end = Math.max(MIN_VIEW_S, durationS);
  return {startS: 0, endS: end <= WHOLE_VIEW_S ? end : DEFAULT_WINDOW_S};
}

function clampView(startS: number, spanS: number, durationS: number): View {
  const total = Math.max(MIN_VIEW_S, durationS);
  const span = Math.min(Math.max(MIN_VIEW_S, spanS), total);
  const start = Math.min(Math.max(0, startS), total - span);
  return {startS: start, endS: start + span};
}

/** Zoom by `factor` (below 1 is closer) keeping `anchorS` where it is. */
export function zoomView(view: View, factor: number, anchorS: number, durationS: number): View {
  const span = view.endS - view.startS;
  const total = Math.max(MIN_VIEW_S, durationS);
  const next = Math.min(Math.max(MIN_VIEW_S, span * factor), total);
  const share = span > 0 ? (anchorS - view.startS) / span : 0;
  return clampView(anchorS - share * next, next, durationS);
}

export function panView(view: View, deltaS: number, durationS: number): View {
  return clampView(view.startS + deltaS, view.endS - view.startS, durationS);
}

/** Keep the playhead in sight while it plays: page forward when it nears the right edge, jump when it is outside. */
export function followView(view: View, positionS: number, durationS: number): View {
  const span = view.endS - view.startS;
  if (positionS >= view.startS && positionS <= view.endS - span * 0.05) return view;
  return clampView(positionS - span * 0.1, span, durationS);
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Ruler ticks at least `minGapPx` apart. */
export function rulerTicks(view: View, widthPx: number, minGapPx = 72): {step: number; ticks: number[]} {
  const span = Math.max(1e-6, view.endS - view.startS);
  const perPx = span / Math.max(1, widthPx);
  const step = TICK_STEPS.find((candidate) => candidate / perPx >= minGapPx)
    ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(view.startS / step - 1e-9) * step; t <= view.endS + 1e-9; t += step) {
    ticks.push(Number(t.toFixed(3)));
  }
  return {step, ticks};
}

const MINOR_DIVISIONS: Record<number, number> = {
  0.1: 2, 0.2: 4, 0.5: 5, 1: 5, 2: 4, 5: 5, 10: 5, 15: 3, 30: 3, 60: 4, 120: 4, 300: 5, 600: 5,
};

/** The small ticks between the labelled ones. */
export function minorTicks(view: View, step: number): number[] {
  const divisions = MINOR_DIVISIONS[step] ?? 1;
  if (divisions < 2) return [];
  const minor = step / divisions;
  const ticks: number[] = [];
  for (let n = Math.ceil(view.startS / minor - 1e-9); n * minor <= view.endS + 1e-9; n += 1) {
    if (n % divisions !== 0) ticks.push(Number((n * minor).toFixed(3)));
  }
  return ticks;
}

/** A ruler label: minutes and seconds, with tenths only when the step needs them. */
export function tickLabel(seconds: number, step: number): string {
  const tenths = step < 1;
  const total = tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const secondsText = tenths ? rest.toFixed(1).padStart(4, "0") : String(Math.round(rest)).padStart(2, "0");
  return `${minutes}:${secondsText}`;
}

/** The playhead's time: minutes, seconds and hundredths. */
export function positionLabel(seconds: number): string {
  const hundredths = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(hundredths / 6000);
  const rest = hundredths - minutes * 6000;
  return `${minutes}:${String(Math.floor(rest / 100)).padStart(2, "0")}.${String(rest % 100).padStart(2, "0")}`;
}

/** Bar heights from 0 to 1 for `count` slices of the view: the loudest reading in each, or the one still sounding. */
export function levelBars(
  levels: ReadonlyArray<[number, number]>,
  view: View,
  count: number,
  floorDb = -60,
  ceilingDb = -10,
): number[] {
  const bars = new Array<number>(Math.max(0, count)).fill(0);
  const span = view.endS - view.startS;
  if (!(span > 0) || count <= 0 || levels.length === 0) return bars;
  const height = (db: number) =>
    Math.min(1, Math.max(0, (db - floorDb) / (ceilingDb - floorDb)));
  let index = 0;
  for (let slot = 0; slot < count; slot += 1) {
    const from = view.startS + (slot / count) * span;
    const to = view.startS + ((slot + 1) / count) * span;
    while (index + 1 < levels.length && levels[index + 1][0] <= from) index += 1;
    let loudest = levels[index][0] < to ? height(levels[index][1]) : 0;
    for (let k = index + 1; k < levels.length && levels[k][0] < to; k += 1) {
      loudest = Math.max(loudest, height(levels[k][1]));
    }
    bars[slot] = loudest;
  }
  return bars;
}

/** A sound caption, as the timeline draws it. */
export interface TimelineSound {
  startS: number;
  endS: number;
  label: string;
}

/** The sound captions of a score: each one that ended, and one still going at the end runs to `durationS`. */
export function scoreSounds(events: readonly ScoreEntry[], durationS: number): TimelineSound[] {
  const ended = new Map<string, TimelineSound>();
  const started: Array<{startS: number; label: string}> = [];
  for (const [, event] of events) {
    if (event.type !== "sound") continue;
    const label = String(event.label ?? event.category ?? "sound");
    const startS = Number(event.start);
    if (!Number.isFinite(startS)) continue;
    if (event.state === "end") {
      const endS = Number(event.end);
      ended.set(`${startS}:${label}`, {startS, endS: Number.isFinite(endS) ? endS : startS, label});
    } else {
      started.push({startS, label});
    }
  }
  for (const {startS, label} of started) {
    const key = `${startS}:${label}`;
    if (!ended.has(key)) ended.set(key, {startS, endS: Math.max(startS, durationS), label});
  }
  return [...ended.values()].sort((a, b) => a.startS - b.startS);
}
