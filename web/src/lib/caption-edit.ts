/** A RECORDING'S CAPTIONS AS A PERSON ADJUSTS THEM. The server's half is
   autocwi/recording/captions.py. */

export interface EditWord {
  /** The analysed word this is; null for one the person added. */
  id: string | null;
  text: string;
  /** Seconds on the recording. */
  start: number;
  end: number;
  speaker: string | null;
  /** 0..1, what the stage reads as loudness. */
  size: number;
  line: number;
}

export interface CaptionDocument {
  generation: number;
  /** In colour order. */
  speakers: string[];
  words: EditWord[];
}

export interface EditLine {
  /** Index of its first and last word. */
  first: number;
  last: number;
  start: number;
  end: number;
}

/** The size a word wears when nothing about the voice stands out. */
export const NORMAL_SIZE = 2 / 9;

/** The shortest a word may be, as the server enforces it. */
export const MIN_WORD_S = 0.05;

export function linesOf(words: readonly EditWord[]): EditLine[] {
  const lines: EditLine[] = [];
  words.forEach((word, index) => {
    const last = lines.at(-1);
    if (last && words[last.first].line === word.line) {
      last.last = index;
      last.end = Math.max(last.end, word.end);
    } else {
      lines.push({first: index, last: index, start: word.start, end: word.end});
    }
  });
  return lines;
}

export function lineAt(lines: readonly EditLine[], index: number): EditLine | null {
  return lines.find((line) => index >= line.first && index <= line.last) ?? null;
}

function mapRange(
  words: readonly EditWord[],
  first: number,
  last: number,
  change: (word: EditWord) => EditWord,
): EditWord[] {
  return words.map((word, index) =>
    index >= first && index <= last ? change(word) : word);
}

function scope(
  words: readonly EditWord[],
  index: number,
  wholeLine: boolean,
): [number, number] {
  const line = wholeLine ? lineAt(linesOf(words), index) : null;
  return line ? [line.first, line.last] : [index, index];
}

/** An emptied word is removed by the server; a typed space adds one. */
export function setText(
  words: readonly EditWord[],
  index: number,
  text: string,
): EditWord[] {
  return mapRange(words, index, index, (word) => ({
    ...word,
    text: text.trim().split(/\s+/).join(" "),
  }));
}

export function setSpeaker(
  words: readonly EditWord[],
  index: number,
  speaker: string | null,
  wholeLine: boolean,
): EditWord[] {
  const [first, last] = scope(words, index, wholeLine);
  return mapRange(words, first, last, (word) => ({...word, speaker}));
}

export function setSize(
  words: readonly EditWord[],
  index: number,
  size: number,
  wholeLine: boolean,
): EditWord[] {
  const [first, last] = scope(words, index, wholeLine);
  const clamped = Math.min(1, Math.max(0, size));
  return mapRange(words, first, last, (word) => ({...word, size: clamped}));
}

/** Move a word in time, keeping its length and its place in the order. */
export function moveStart(
  words: readonly EditWord[],
  index: number,
  start: number,
): EditWord[] {
  const word = words[index];
  if (!word || !Number.isFinite(start)) return [...words];
  const floor = index > 0 ? words[index - 1].start + 0.001 : 0;
  const ceiling = index + 1 < words.length
    ? words[index + 1].start - 0.001
    : Number.POSITIVE_INFINITY;
  const placed = Math.max(floor, Math.min(ceiling, start));
  const length = Math.max(MIN_WORD_S, word.end - word.start);
  return mapRange(words, index, index, (current) => ({
    ...current,
    start: Number(placed.toFixed(3)),
    end: Number((placed + length).toFixed(3)),
  }));
}

function renumber(words: readonly EditWord[], starts: ReadonlySet<number>): EditWord[] {
  let line = -1;
  return words.map((word, index) => {
    if (index === 0 || starts.has(index)) line += 1;
    return {...word, line};
  });
}

function lineStarts(words: readonly EditWord[]): Set<number> {
  return new Set(linesOf(words).map((line) => line.first));
}

/** Start a new caption line at this word. */
export function breakBefore(words: readonly EditWord[], index: number): EditWord[] {
  const starts = lineStarts(words);
  starts.add(index);
  return renumber(words, starts);
}

/** Put this word's line on the end of the line before it. */
export function joinPrevious(words: readonly EditWord[], index: number): EditWord[] {
  const line = lineAt(linesOf(words), index);
  const starts = lineStarts(words);
  if (line && line.first > 0) starts.delete(line.first);
  return renumber(words, starts);
}

export function removeWord(words: readonly EditWord[], index: number): EditWord[] {
  return words.filter((_, at) => at !== index);
}

/** The next unused `S<n>` name. */
export function nextSpeaker(speakers: readonly string[]): string {
  let n = speakers.length + 1;
  while (speakers.includes(`S${n}`)) n += 1;
  return `S${n}`;
}

/** What to play to see one caption line: from its first word to the end of its last. */
export function playWindow(
  words: readonly EditWord[],
  index: number,
): {from: number; until: number} | null {
  const line = lineAt(linesOf(words), Math.min(index, words.length - 1));
  return line ? {from: line.start, until: line.end} : null;
}

/** The first word at which two versions of the captions differ, for choosing what to replay. */
export function firstChange(
  before: readonly EditWord[],
  after: readonly EditWord[],
): number {
  const shared = Math.min(before.length, after.length);
  for (let index = 0; index < shared; index += 1) {
    const a = before[index];
    const b = after[index];
    if (a.text !== b.text || a.start !== b.start || a.end !== b.end
        || a.speaker !== b.speaker || a.size !== b.size || a.line !== b.line) {
      return index;
    }
  }
  return Math.max(0, Math.min(shared, after.length - 1));
}

/** `m:ss.t` */
export function clockLabel(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

/** The shortest a caption line may be made by dragging it. */
export const MIN_LINE_S = 0.2;

/** Where a line may go without crossing its neighbours: from the word before it to the word after it. */
export function lineRoom(
  words: readonly EditWord[],
  first: number,
  last: number,
): {minS: number; maxS: number} {
  const start = words[first].start;
  const end = Math.max(...words.slice(first, last + 1).map((word) => word.end));
  return {
    minS: first > 0 ? Math.min(words[first - 1].end, start) : 0,
    maxS: last + 1 < words.length ? Math.max(words[last + 1].start, end) : Number.POSITIVE_INFINITY,
  };
}

/** The line from `first` to `last` set to run from `startS` to `endS`, every word keeping its share of it. */
export function retimeLine(
  words: readonly EditWord[],
  first: number,
  last: number,
  startS: number,
  endS: number,
): EditWord[] {
  const oldStart = words[first].start;
  const oldEnd = Math.max(...words.slice(first, last + 1).map((word) => word.end));
  const {minS, maxS} = lineRoom(words, first, last);
  let start = Math.max(minS, startS);
  let end = Math.min(maxS, endS);
  if (end - start < MIN_LINE_S) {
    if (startS !== oldStart) start = Math.max(minS, end - MIN_LINE_S);
    else end = Math.min(maxS, start + MIN_LINE_S);
  }
  const scale = (end - start) / Math.max(1e-6, oldEnd - oldStart);
  const place = (t: number) => Number((start + (t - oldStart) * scale).toFixed(3));
  return mapRange(words, first, last, (word) => ({
    ...word,
    start: place(word.start),
    end: Math.max(place(word.start) + MIN_WORD_S / 2, place(word.end)),
  }));
}

/** The same line moved by `deltaS`, as far as its neighbours allow. */
export function moveLine(
  words: readonly EditWord[],
  first: number,
  last: number,
  deltaS: number,
): EditWord[] {
  const oldStart = words[first].start;
  const oldEnd = Math.max(...words.slice(first, last + 1).map((word) => word.end));
  const {minS, maxS} = lineRoom(words, first, last);
  const delta = Math.min(maxS - oldEnd, Math.max(minS - oldStart, deltaS));
  return retimeLine(words, first, last, oldStart + delta, oldEnd + delta);
}

/** The line a timing key acts on: the one under the playhead, else the last one before it, else the first. */
export function lineForPlayhead(lines: readonly EditLine[], positionS: number): EditLine | null {
  let found: EditLine | null = lines[0] ?? null;
  for (const line of lines) {
    if (line.start <= positionS) found = line;
    else break;
  }
  return found;
}

/** How an added caption moves: its size drives the swell, its time per word the hold. */
export interface CaptionPreset {
  id: string;
  label: string;
  size: number;
  perWordS: number;
}

export const CAPTION_PRESETS: readonly CaptionPreset[] = [
  {id: "normal", label: "Normal", size: NORMAL_SIZE, perWordS: 0.4},
  {id: "shout", label: "Shout", size: 0.95, perWordS: 0.5},
  {id: "whisper", label: "Whisper", size: 0.06, perWordS: 0.45},
  {id: "drawn", label: "Drawn out", size: 0.6, perWordS: 1.4},
];

const ADDED_GAP_S = 0.05;

/**
 * Add a caption line at `atS`, or just after the line playing there. It runs
 * for its preset's time per word, cut short by the next line or by the end of
 * the recording at `endS`. Returns the words and the index of the first added one.
 */
export function insertLine(
  words: readonly EditWord[],
  atS: number,
  text: string,
  speaker: string | null,
  preset: CaptionPreset,
  endS = Number.POSITIVE_INFINITY,
): {words: EditWord[]; index: number} | null {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const lines = linesOf(words);
  let start = Math.max(0, atS);
  for (const line of lines) {
    if (line.end <= start) continue;
    if (line.start >= start + MIN_LINE_S + ADDED_GAP_S) break;
    start = Math.max(start, line.end + ADDED_GAP_S);
  }
  start = Math.min(start, Math.max(0, endS - MIN_LINE_S));
  const next = lines.find((line) => line.start >= start);
  const wanted = Math.max(MIN_LINE_S, preset.perWordS * parts.length);
  const room = (next ? next.start - ADDED_GAP_S : endS) - start;
  const span = Math.max(MIN_LINE_S, Math.min(wanted, room));
  const index = next ? next.first : words.length;
  const line = words.reduce((top, word) => Math.max(top, word.line), -1) + 1;
  const letters = parts.reduce((sum, part) => sum + part.length, 0);
  let cursor = start;
  const added = parts.map((part) => {
    const length = (span * part.length) / letters;
    const word: EditWord = {
      id: null,
      text: part,
      start: cursor,
      end: cursor + Math.max(MIN_WORD_S, length),
      speaker,
      size: preset.size,
      line,
    };
    cursor += length;
    return word;
  });
  return {words: [...words.slice(0, index), ...added, ...words.slice(index)], index};
}
