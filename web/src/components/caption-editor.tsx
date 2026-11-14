"use client";

import {Play, RotateCcw, Square, Undo2, X} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  NORMAL_SIZE,
  breakBefore,
  clockLabel,
  firstChange,
  joinPrevious,
  lineAt,
  linesOf,
  moveStart,
  nextSpeaker,
  playWindow,
  removeWord,
  setSize,
  setSpeaker,
  setText,
  type CaptionDocument,
  type EditLine,
  type EditWord,
} from "@/lib/caption-edit";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const CAPTIONS_URL = "/session/captions";
const HISTORY_LIMIT = 50;
const NUDGE_S = 0.05;
const SIZE_SNAP = 0.03;

async function request(body?: object): Promise<CaptionDocument> {
  const response = await fetch(CAPTIONS_URL, body ? {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  } : undefined);
  const value = await response.json().catch(() => null) as
    (CaptionDocument & {error?: string}) | null;
  if (!response.ok || !value) {
    throw new Error(value?.error ?? "The captions could not be reached.");
  }
  return value;
}

function sizeLabel(size: number): string {
  if (size < NORMAL_SIZE - SIZE_SNAP) return "Small";
  if (size <= NORMAL_SIZE + SIZE_SNAP) return "Normal";
  return size < 0.75 ? "Large" : "Largest";
}

function WordInspector({
  word,
  startsLine,
  firstLine,
  speakers,
  colors,
  wholeLine,
  setWholeLine,
  onText,
  onSpeaker,
  onSize,
  onStart,
  onBreak,
  onJoin,
  onRemove,
}: {
  word: EditWord;
  startsLine: boolean;
  firstLine: boolean;
  speakers: readonly string[];
  colors: SpeakerColorMap;
  wholeLine: boolean;
  setWholeLine: (value: boolean) => void;
  onText: (text: string) => void;
  onSpeaker: (speaker: string) => void;
  onSize: (size: number) => void;
  onStart: (start: number) => void;
  onBreak: () => void;
  onJoin: () => void;
  onRemove: () => void;
}) {
  const [text, setTextDraft] = useState(word.text);
  const [size, setSizeDraft] = useState(word.size);
  const [start, setStartDraft] = useState(word.start.toFixed(2));
  const saved = `${word.text}|${word.size}|${word.start}`;
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setTextDraft(word.text);
    setSizeDraft(word.size);
    setStartDraft(word.start.toFixed(2));
  }
  const commitText = () => {
    if (text.trim() !== word.text) onText(text);
  };
  const commitSize = () => {
    const snapped = Math.abs(size - NORMAL_SIZE) <= SIZE_SNAP ? NORMAL_SIZE : size;
    if (Math.abs(snapped - word.size) > 1e-4) onSize(snapped);
  };
  const commitStart = () => {
    const value = Number(start);
    if (Number.isFinite(value) && Math.abs(value - word.start) > 1e-3) onStart(value);
    else setStartDraft(word.start.toFixed(2));
  };
  return (
    <div className="editor-inspector">
      <label className="editor-field">
        <span>Text</span>
        <input
          type="text"
          value={text}
          spellCheck={false}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <small>A space adds a word. Empty removes it.</small>
      </label>

      <div className="editor-field">
        <span>Speaker</span>
        <div className="speaker-choices">
          {speakers.map((speaker) => (
            <button
              key={speaker}
              type="button"
              data-active={word.speaker === speaker}
              onClick={() => onSpeaker(speaker)}
            >
              <i style={{"--dot": speakerColor(speaker, colors)} as CSSVars} />
              {speaker}
            </button>
          ))}
          <button type="button" onClick={() => onSpeaker(nextSpeaker(speakers))}>
            New
          </button>
        </div>
      </div>

      <label className="range-control editor-size">
        <span>Size</span>
        <output>{sizeLabel(size)}</output>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={size}
          style={{"--fill": `${size * 100}%`} as CSSVars}
          onChange={(event) => setSizeDraft(Number(event.target.value))}
          onPointerUp={commitSize}
          onKeyUp={commitSize}
          onBlur={commitSize}
        />
      </label>

      <button
        type="button"
        className="toggle-row"
        aria-pressed={wholeLine}
        onClick={() => setWholeLine(!wholeLine)}
      >
        <span>Speaker and size on the whole line</span>
        <i data-on={wholeLine ? "true" : "false"} />
      </button>

      <div className="editor-field editor-time">
        <span>Starts at</span>
        <div>
          <button
            type="button"
            aria-label="Earlier"
            onClick={() => onStart(word.start - NUDGE_S)}
          >
            −
          </button>
          <input
            type="number"
            step={NUDGE_S}
            min="0"
            value={start}
            onChange={(event) => setStartDraft(event.target.value)}
            onBlur={commitStart}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <button
            type="button"
            aria-label="Later"
            onClick={() => onStart(word.start + NUDGE_S)}
          >
            +
          </button>
          <em>s</em>
        </div>
      </div>

      <div className="editor-word-actions">
        {startsLine ? (
          <button type="button" onClick={onJoin} disabled={firstLine}>
            Join the line above
          </button>
        ) : (
          <button type="button" onClick={onBreak}>
            New line here
          </button>
        )}
        <button type="button" onClick={onRemove}>
          Remove word
        </button>
      </div>
    </div>
  );
}

export function CaptionEditor({
  colors,
  close,
}: {
  colors: SpeakerColorMap;
  close: () => void;
}) {
  const [doc, setDoc] = useState<CaptionDocument | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [wholeLine, setWholeLine] = useState(true);
  const [history, setHistory] = useState<EditWord[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request()
      .then((value) => {
        if (!cancelled) setDoc(value);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = useMemo<EditLine[]>(() => linesOf(doc?.words ?? []), [doc]);

  const run = useCallback(async (
    body: object,
    optimistic?: EditWord[],
  ): Promise<CaptionDocument | null> => {
    const before = doc;
    if (!before) return null;
    setBusy(true);
    setError(null);
    if (optimistic) setDoc({...before, words: optimistic});
    try {
      const next = await request(body);
      setDoc((current) =>
        current && next.generation < current.generation ? current : next);
      setSelected((index) => index === null || !next.words.length
        ? null
        : Math.min(index, next.words.length - 1));
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change was refused.");
      setDoc(await request().catch(() => before));
      return null;
    } finally {
      setBusy(false);
    }
  }, [doc]);

  const commit = useCallback(async (words: EditWord[], focus: number) => {
    if (!doc) return;
    const before = doc.words;
    const window = playWindow(words, focus);
    const next = await run(
      {action: "adjust", words, from: window?.from, until: window?.until},
      words,
    );
    if (next) setHistory((past) => [...past.slice(1 - HISTORY_LIMIT), before]);
  }, [doc, run]);

  const undo = useCallback(async () => {
    const previous = history.at(-1);
    if (!previous || !doc) return;
    const window = playWindow(previous, firstChange(doc.words, previous));
    const next = await run(
      {action: "adjust", words: previous, from: window?.from, until: window?.until},
      previous,
    );
    if (next) setHistory((past) => past.slice(0, -1));
  }, [doc, history, run]);

  const revert = useCallback(async () => {
    if (!doc) return;
    const before = doc.words;
    const next = await run({action: "revert", from: 0});
    if (next) setHistory((past) => [...past.slice(1 - HISTORY_LIMIT), before]);
  }, [doc, run]);

  const word = doc && selected !== null ? doc.words[selected] : undefined;
  const line = selected !== null ? lineAt(lines, selected) : null;

  return (
    <section className="caption-editor" aria-label="Caption editor" data-busy={busy}>
      <header className="editor-bar">
        <h2>Captions</h2>
        <div>
          <button
            className="icon-button"
            type="button"
            aria-label="Play from the start"
            title="Play from the start"
            onClick={() => void run({action: "play", from: 0})}
          >
            <Play size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={() => void run({action: "stop"})}
          >
            <Square size={13} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Undo"
            title="Undo"
            disabled={!history.length || busy}
            onClick={() => void undo()}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Back to Weave's captions"
            title="Back to Weave's captions"
            disabled={!doc || doc.generation === 0 || busy}
            onClick={() => void revert()}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Close the editor"
            title="Close"
            onClick={close}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      {error && <p className="editor-error" role="alert">{error}</p>}
      {!doc && !error && <p className="editor-note">Reading the captions…</p>}
      {doc && !doc.words.length && (
        <p className="editor-note">This recording has no captions yet.</p>
      )}

      {doc && (
        <ol className="editor-lines">
          {lines.map((entry) => (
            <li key={entry.first} data-selected={line?.first === entry.first}>
              <button
                type="button"
                className="editor-line-play"
                aria-label={`Play the line at ${clockLabel(entry.start)}`}
                onClick={() => void run({
                  action: "play", from: entry.start, until: entry.end,
                })}
              >
                <Play size={10} />
                {clockLabel(entry.start)}
              </button>
              <p>
                {doc.words.slice(entry.first, entry.last + 1).map((item, offset) => {
                  const index = entry.first + offset;
                  const previous = offset ? doc.words[index - 1] : undefined;
                  return (
                    <span key={item.id ?? `new:${index}`}>
                      {previous?.speaker !== item.speaker && (
                        <i
                          className="editor-dot"
                          title={item.speaker ?? "Unknown speaker"}
                          style={{"--dot": speakerColor(item.speaker, colors)} as CSSVars}
                        />
                      )}
                      <button
                        type="button"
                        className="editor-word"
                        data-selected={selected === index}
                        data-size={sizeLabel(item.size).toLowerCase()}
                        onClick={() => setSelected(index)}
                      >
                        {item.text}
                      </button>
                    </span>
                  );
                })}
              </p>
            </li>
          ))}
        </ol>
      )}

      {doc && word && selected !== null ? (
        <WordInspector
          key={selected}
          word={word}
          startsLine={line?.first === selected}
          firstLine={line?.first === 0}
          speakers={doc.speakers}
          colors={colors}
          wholeLine={wholeLine}
          setWholeLine={setWholeLine}
          onText={(text) => void commit(setText(doc.words, selected, text), selected)}
          onSpeaker={(speaker) => void commit(
            setSpeaker(doc.words, selected, speaker, wholeLine), selected)}
          onSize={(size) => void commit(
            setSize(doc.words, selected, size, wholeLine), selected)}
          onStart={(start) => void commit(moveStart(doc.words, selected, start), selected)}
          onBreak={() => void commit(breakBefore(doc.words, selected), selected)}
          onJoin={() => void commit(joinPrevious(doc.words, selected), selected)}
          onRemove={() => void commit(removeWord(doc.words, selected), selected)}
        />
      ) : doc?.words.length ? (
        <p className="editor-note">Choose a word to change it.</p>
      ) : null}
    </section>
  );
}
