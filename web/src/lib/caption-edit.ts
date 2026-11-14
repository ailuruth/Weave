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
