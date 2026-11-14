"use client";

import {Play, Plus, RotateCcw, Undo2, X} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CAPTION_PRESETS,
  NORMAL_SIZE,
  applyPreset,
  breakBefore,
  clockLabel,
  insertLine,
  joinPrevious,
  lineAt,
  linesOf,
  nextSpeaker,
  presetOf,
  removeLine,
  removeWord,
  retimeLine,
  setColour,
  setSize,
  setText,
  type CaptionPreset,
  type EditLine,
  type EditWord,
} from "@/lib/caption-edit";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const NUDGE_S = 0.05;
const SIZE_SNAP = 0.03;
const PREVIEW_LEAD_S = 0.3;
const PREVIEW_TAIL_S = 0.5;
const NEW_CAPTION = "Caption";

function sizeLabel(size: number): string {
  if (size < NORMAL_SIZE - SIZE_SNAP) return "Small";
  if (size <= NORMAL_SIZE + SIZE_SNAP) return "Normal";
  return size < 0.75 ? "Large" : "Largest";
}

function LineInspector({
  word,
  line,
  startsLine,
  firstLine,
  speakers,
  colors,
  preset,
  wholeLine,
  setWholeLine,
  onText,
  onColour,
  onPreset,
  onSize,
  onSpan,
  onBreak,
  onJoin,
  onRemoveWord,
  onRemoveLine,
  onMove,
  onPreview,
}: {
  word: EditWord;
  line: EditLine;
  startsLine: boolean;
  firstLine: boolean;
  speakers: readonly string[];
  colors: SpeakerColorMap;
  preset: CaptionPreset | null;
  wholeLine: boolean;
  setWholeLine: (value: boolean) => void;
  onText: (text: string) => void;
  onColour: (colour: {speaker: string | null} | {rainbow: true}) => void;
  onPreset: (preset: CaptionPreset) => void;
  onSize: (size: number) => void;
  onSpan: (startS: number, endS: number) => void;
  onBreak: () => void;
  onJoin: () => void;
  onRemoveWord: () => void;
  onRemoveLine: () => void;
  /** Go to the word `delta` places away. */
  onMove: (delta: number) => void;
  onPreview: () => void;
}) {
  const [text, setTextDraft] = useState(word.text);
  const [size, setSizeDraft] = useState(word.size);
  const saved = `${word.text}|${word.size}`;
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setTextDraft(word.text);
    setSizeDraft(word.size);
  }
  const commitText = () => {
    if (text.trim() !== word.text) onText(text);
  };
  const commitSize = () => {
    const snapped = Math.abs(size - NORMAL_SIZE) <= SIZE_SNAP ? NORMAL_SIZE : size;
    if (Math.abs(snapped - word.size) > 1e-4) onSize(snapped);
  };
  const newSpeaker = nextSpeaker(speakers);
  return (
    <div className="editor-inspector">
      <label className="editor-field">
        <span>Text</span>
        <input
          type="text"
          value={text}
          spellCheck={false}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            else if (event.key === "Escape") {
              setTextDraft(word.text);
              event.currentTarget.blur();
            } else if (event.key === "Tab") {
              event.preventDefault();
              commitText();
              onMove(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <small>Enter keeps it. Tab goes to the next word. A space adds a word.</small>
      </label>

      <div className="editor-field">
        <span>Colour</span>
        <div className="speaker-choices">
          {speakers.map((speaker) => (
            <button
              key={speaker}
              type="button"
              data-active={!word.rainbow && word.speaker === speaker}
              onClick={() => onColour({speaker})}
            >
              <i style={{"--dot": speakerColor(speaker, colors)} as CSSVars} />
              {speaker}
            </button>
          ))}
          <button
            type="button"
            data-active={Boolean(word.rainbow)}
            onClick={() => onColour({rainbow: true})}
          >
            <i className="rainbow-dot" />
            Rainbow
          </button>
          <button type="button" onClick={() => onColour({speaker: newSpeaker})}>
            <i style={{"--dot": speakerColor(newSpeaker, colors)} as CSSVars} />
            New
          </button>
        </div>
      </div>

      <div className="editor-field">
        <span>Motion</span>
        <div className="motion-presets" role="radiogroup" aria-label="Motion">
          {CAPTION_PRESETS.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={preset?.id === choice.id}
              data-active={preset?.id === choice.id}
              onClick={() => onPreset(choice)}
            >
              <b data-preset={choice.id} aria-hidden="true">Aa</b>
              {choice.label}
            </button>
          ))}
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
        <span>Colour and size on the whole line</span>
        <i data-on={wholeLine ? "true" : "false"} />
      </button>

      <div className="editor-field editor-span">
        <span>Line</span>
        <div>
          <SpanField
            label="Start"
            value={line.start}
            onChange={(value) => onSpan(value, line.end)}
          />
          <SpanField
            label="End"
            value={line.end}
            onChange={(value) => onSpan(line.start, value)}
          />
          <button type="button" className="editor-preview" onClick={onPreview} title="Play this line">
            <Play size={13} fill="currentColor" strokeWidth={0} />
            Preview
          </button>
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
        <button type="button" onClick={onRemoveWord}>
          Remove word
        </button>
        <button type="button" onClick={onRemoveLine}>
          Remove line
        </button>
      </div>
    </div>
  );
}

function SpanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value.toFixed(2));
  }
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && Math.abs(parsed - value) > 1e-3) onChange(parsed);
    else setDraft(value.toFixed(2));
  };
  return (
    <span className="span-field">
      <small>{label}</small>
      <button type="button" aria-label={`${label} earlier`} onClick={() => onChange(value - NUDGE_S)}>
        −
      </button>
      <input
        type="number"
        step={NUDGE_S}
        min="0"
        value={draft}
        aria-label={`${label} in seconds`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <button type="button" aria-label={`${label} later`} onClick={() => onChange(value + NUDGE_S)}>
        +
      </button>
    </span>
  );
}

export function CaptionEditor({
  colors,
  close,
  positionS,
  durationS,
  playing,
  rate,
  seek,
  play,
  pause,
  captions,
  focus,
}: {
  colors: SpeakerColorMap;
  close: () => void;
  /** Where the picture is, from the published playhead. */
  positionS: number;
  durationS: number;
  playing: boolean;
  rate: number;
  seek: (positionS: number) => void;
  play: () => void;
  pause: () => void;
  captions: CaptionDocumentState;
  /** A word to open on, from outside the editor; `n` changes on every request. */
  focus?: {index: number; n: number} | null;
}) {
  const {doc, error, busy, canUndo, commit, undo, revert} = captions;
  const [picked, setSelected] = useState<number | null>(focus?.index ?? null);
  const [focusSeen, setFocusSeen] = useState(focus?.n ?? null);
  if (focus && focus.n !== focusSeen) {
    setFocusSeen(focus.n);
    setSelected(focus.index);
  }
  const [wholeLine, setWholeLine] = useState(true);
  const selected = picked !== null && doc && doc.words.length
    ? Math.min(picked, doc.words.length - 1)
    : null;

  const lines = useMemo<EditLine[]>(() => linesOf(doc?.words ?? []), [doc]);
  const current = lines.find((entry) => positionS >= entry.start && positionS <= entry.end)
    ?? null;
  const currentRef = useRef<HTMLLIElement>(null);
  const currentFirst = current?.first ?? null;
  useEffect(() => {
    if (playing && currentFirst !== null) {
      currentRef.current?.scrollIntoView({block: "nearest"});
    }
  }, [currentFirst, playing]);

  const word = doc && selected !== null ? doc.words[selected] : undefined;
  const line = selected !== null ? lineAt(lines, selected) : null;
  const selectedRef = useRef<HTMLLIElement>(null);
  const selectedFirst = line?.first ?? null;
  useEffect(() => {
    if (selectedFirst !== null) selectedRef.current?.scrollIntoView({block: "nearest"});
  }, [selectedFirst]);

  const previewTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
  }, []);
  const preview = (startS: number, endS: number) => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    seek(Math.max(0, startS - PREVIEW_LEAD_S));
    play();
    const span = endS - startS + PREVIEW_LEAD_S + PREVIEW_TAIL_S;
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      pause();
    }, (span / Math.max(0.1, rate)) * 1000);
  };
  const spanOfLine = (words: readonly EditWord[], index: number) => {
    const found = lineAt(linesOf(words), index);
    return found ? {startS: found.start, endS: found.end} : null;
  };
  const change = (words: EditWord[], index: number, show = false) => {
    void commit(words, index).then((ok) => {
      if (!ok || !show) return;
      const span = spanOfLine(words, index);
      if (span) window.setTimeout(() => preview(span.startS, span.endS), 250);
    });
  };

  const move = (delta: number) => {
    if (!doc || selected === null) return;
    const next = Math.min(doc.words.length - 1, Math.max(0, selected + delta));
    setSelected(next);
    seek(doc.words[next].start);
  };

  const addCaption = () => {
    if (!doc) return;
    const here = lines.find((entry) => positionS >= entry.start && positionS <= entry.end);
    const speaker = here ? doc.words[here.first].speaker : doc.speakers[0] ?? null;
    const added = insertLine(doc.words, positionS, NEW_CAPTION, speaker, CAPTION_PRESETS[0], durationS);
    if (!added) return;
    void commit(added.words, added.index).then((ok) => {
      if (ok) setSelected(added.index);
    });
  };

  return (
    <section className="caption-editor" aria-label="Caption editor" data-busy={busy}>
      <header className="editor-bar">
        <h2>Captions</h2>
        <div>
          <button
            className="icon-button"
            type="button"
            aria-label="Add a caption at the playhead"
            title="Add a caption at the playhead"
            disabled={!doc || busy}
            onClick={addCaption}
          >
            <Plus size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!canUndo}
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
        <p className="editor-note">This recording has no captions yet. Press + to add one.</p>
      )}

      {doc && (
        <ol className="editor-lines">
          {lines.map((entry) => (
            <li
              key={entry.first}
              ref={line?.first === entry.first
                ? selectedRef
                : current?.first === entry.first ? currentRef : undefined}
              data-selected={line?.first === entry.first}
              data-current={current?.first === entry.first}
              style={current?.first === entry.first ? {
                "--progress": `${(Math.min(1, Math.max(0,
                  (positionS - entry.start) / Math.max(0.01, entry.end - entry.start))) * 100).toFixed(1)}%`,
              } as CSSVars : undefined}
            >
              <button
                type="button"
                className="editor-line-play"
                aria-label={`Go to the line from ${clockLabel(entry.start)} to ${clockLabel(entry.end)}`}
                title="Go to this line"
                onClick={() => seek(entry.start)}
              >
                <span>{clockLabel(entry.start)}</span>
                <span>{clockLabel(entry.end)}</span>
              </button>
              <p>
                {doc.words.slice(entry.first, entry.last + 1).map((item, offset) => {
                  const index = entry.first + offset;
                  const previous = offset ? doc.words[index - 1] : undefined;
                  const colourChanged = !previous
                    || previous.speaker !== item.speaker
                    || Boolean(previous.rainbow) !== Boolean(item.rainbow);
                  return (
                    <span key={item.id ?? `new:${index}`}>
                      {colourChanged && (
                        <i
                          className={item.rainbow ? "editor-dot rainbow-dot" : "editor-dot"}
                          title={item.rainbow ? "Rainbow" : item.speaker ?? "Unknown speaker"}
                          style={item.rainbow ? undefined
                            : {"--dot": speakerColor(item.speaker, colors)} as CSSVars}
                        />
                      )}
                      <button
                        type="button"
                        className="editor-word"
                        data-selected={selected === index}
                        data-size={sizeLabel(item.size).toLowerCase()}
                        onClick={() => {
                          setSelected(index);
                          seek(item.start);
                        }}
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

      {doc && word && line && selected !== null ? (
        <LineInspector
          key={selected}
          word={word}
          line={line}
          startsLine={line.first === selected}
          firstLine={line.first === 0}
          speakers={doc.speakers}
          colors={colors}
          preset={presetOf(doc.words, selected)}
          wholeLine={wholeLine}
          setWholeLine={setWholeLine}
          onText={(text) => change(setText(doc.words, selected, text), selected)}
          onColour={(colour) => change(setColour(doc.words, selected, colour, wholeLine), selected, true)}
          onPreset={(choice) => change(applyPreset(doc.words, selected, choice, durationS), selected, true)}
          onSize={(size) => change(setSize(doc.words, selected, size, wholeLine), selected, true)}
          onSpan={(startS, endS) => change(
            retimeLine(doc.words, line.first, line.last, startS, endS), selected)}
          onBreak={() => change(breakBefore(doc.words, selected), selected)}
          onJoin={() => change(joinPrevious(doc.words, selected), selected)}
          onRemoveWord={() => change(removeWord(doc.words, selected), selected)}
          onRemoveLine={() => {
            setSelected(null);
            change(removeLine(doc.words, selected), Math.max(0, line.first - 1));
          }}
          onMove={move}
          onPreview={() => preview(line.start, line.end)}
        />
      ) : doc?.words.length ? (
        <p className="editor-note">Choose a word to change it, or press + to add a caption.</p>
      ) : null}
    </section>
  );
}
