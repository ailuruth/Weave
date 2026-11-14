"use client";

import {Merge, Plus, RotateCcw, Scissors, Trash2, Undo2, X} from "lucide-react";
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
  insertLine,
  joinPrevious,
  lineAt,
  linesOf,
  nextSpeaker,
  parseClock,
  presetOf,
  removeLine,
  retimeLine,
  setColour,
  setLineText,
  setSize,
  type EditLine,
  type EditWord,
} from "@/lib/caption-edit";
import {positionLabel} from "@/lib/transport";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const PREVIEW_LEAD_S = 0.3;
const PREVIEW_TAIL_S = 0.5;
const NEW_CAPTION = "Caption";
const WORD_SIZES: ReadonlyArray<[string, number]> = [
  ["Small", 0.08],
  ["Normal", NORMAL_SIZE],
  ["Large", 0.6],
  ["Largest", 0.95],
];

function sizeName(size: number): string {
  let best = WORD_SIZES[0];
  for (const entry of WORD_SIZES) {
    if (Math.abs(entry[1] - size) < Math.abs(best[1] - size)) best = entry;
  }
  return best[0];
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(positionLabel(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(positionLabel(value));
  }
  const commit = () => {
    const parsed = parseClock(draft);
    if (parsed !== null && Math.abs(parsed - value) > 1e-3) onChange(parsed);
    else setDraft(positionLabel(value));
  };
  return (
    <input
      className="card-time"
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label={label}
      title={`${label}. Type a time, or use the arrow keys to nudge it.`}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          setDraft(positionLabel(value));
          event.currentTarget.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 0.5 : 0.05));
        }
      }}
    />
  );
}

function CaptionText({
  text,
  autoFocus,
  onCommit,
  onFocus,
}: {
  text: string;
  autoFocus: boolean;
  onCommit: (text: string) => void;
  onFocus: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }
  return (
    <textarea
      className="card-text"
      value={draft}
      rows={1}
      spellCheck={false}
      autoFocus={autoFocus}
      aria-label="Caption text"
      onFocus={(event) => {
        onFocus();
        if (autoFocus) event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onBlur={() => {
        if (draft.trim() !== text) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(text);
          event.currentTarget.blur();
        }
      }}
    />
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
  const [picked, setPicked] = useState<number | null>(focus?.index ?? null);
  const [typing, setTyping] = useState<number | null>(focus?.index ?? null);
  const [chosenWord, setChosenWord] = useState<number | null>(null);
  const [focusSeen, setFocusSeen] = useState(focus?.n ?? null);
  if (focus && focus.n !== focusSeen) {
    setFocusSeen(focus.n);
    setPicked(focus.index);
    setTyping(focus.index);
    setChosenWord(null);
  }

  const words = doc?.words ?? [];
  const lines = useMemo<EditLine[]>(() => linesOf(doc?.words ?? []), [doc]);
  const selectedLine = picked !== null && words.length
    ? lineAt(lines, Math.min(picked, words.length - 1))
    : null;
  const current = lines.find((entry) => positionS >= entry.start && positionS <= entry.end)
    ?? null;

  const listRef = useRef<HTMLOListElement>(null);
  const currentFirst = current?.first ?? null;
  useEffect(() => {
    if (!playing || currentFirst === null) return;
    listRef.current?.querySelector(`[data-first="${currentFirst}"]`)
      ?.scrollIntoView({block: "nearest"});
  }, [currentFirst, playing]);
  const selectedFirst = selectedLine?.first ?? null;
  useEffect(() => {
    if (selectedFirst === null) return;
    listRef.current?.querySelector(`[data-first="${selectedFirst}"]`)
      ?.scrollIntoView({block: "nearest"});
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
  const change = (next: EditWord[], index: number, show = false) => {
    void commit(next, index).then((ok) => {
      if (!ok || !show) return;
      const line = lineAt(linesOf(next), Math.min(index, next.length - 1));
      if (line) window.setTimeout(() => preview(line.start, line.end), 250);
    });
  };

  const choose = (line: EditLine) => {
    if (selectedLine?.first !== line.first) {
      setPicked(line.first);
      setChosenWord(null);
      if (!playing) seek(line.start);
    }
  };

  const addCaption = () => {
    if (!doc) return;
    const here = lines.find((entry) => positionS >= entry.start && positionS <= entry.end);
    const speaker = here ? words[here.first].speaker : doc.speakers[0] ?? null;
    const added = insertLine(words, positionS, NEW_CAPTION, speaker, CAPTION_PRESETS[0], durationS);
    if (!added) return;
    void commit(added.words, added.index).then((ok) => {
      if (!ok) return;
      setPicked(added.index);
      setTyping(added.index);
      setChosenWord(null);
    });
  };

  const newSpeaker = nextSpeaker(doc?.speakers ?? []);

  return (
    <section className="caption-editor" aria-label="Caption editor" data-busy={busy}>
      <header className="editor-bar">
        <h2>Captions</h2>
        <div>
          <button
            type="button"
            className="editor-add"
            title="Add a caption at the playhead"
            disabled={!doc || busy}
            onClick={addCaption}
          >
            <Plus size={15} />
            Caption
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
      {doc && !words.length && (
        <p className="editor-note">No captions yet. Add one at the playhead.</p>
      )}

      {doc && (
        <ol className="caption-cards" ref={listRef}>
          {lines.map((line, number) => {
            const selected = selectedLine?.first === line.first;
            const lineWords = words.slice(line.first, line.last + 1);
            const first = lineWords[0];
            const preset = presetOf(words, line.first);
            const isCurrent = current?.first === line.first;
            return (
              <li
                key={`${line.first}:${first.id ?? "new"}`}
                className="caption-card"
                data-first={line.first}
                data-selected={selected}
                data-current={isCurrent}
                style={{
                  "--card-color": first.rainbow ? "transparent" : speakerColor(first.speaker, colors),
                  ...(isCurrent ? {
                    "--progress": `${(Math.min(1, Math.max(0,
                      (positionS - line.start) / Math.max(0.01, line.end - line.start))) * 100).toFixed(1)}%`,
                  } : {}),
                } as CSSVars}
                data-rainbow={first.rainbow ? "true" : undefined}
                onClick={() => choose(line)}
              >
                <div className="card-head">
                  <span className="card-number">{number + 1}</span>
                  <TimeField
                    label="Start"
                    value={line.start}
                    onChange={(value) => change(
                      retimeLine(words, line.first, line.last, value, line.end), line.first)}
                  />
                  <span className="card-arrow" aria-hidden="true">→</span>
                  <TimeField
                    label="End"
                    value={line.end}
                    onChange={(value) => change(
                      retimeLine(words, line.first, line.last, line.start, value), line.first)}
                  />
                  <span className="card-duration">{(line.end - line.start).toFixed(2)}s</span>
                </div>
                <CaptionText
                  text={lineWords.map((word) => word.text).join(" ")}
                  autoFocus={typing === line.first}
                  onFocus={() => {
                    choose(line);
                    if (typing !== null) setTyping(null);
                  }}
                  onCommit={(text) => change(setLineText(words, line.first, text), line.first)}
                />
                {selected && (
                  <div className="card-tools" onClick={(event) => event.stopPropagation()}>
                    <div className="card-row">
                      <span>Colour</span>
                      <div className="swatches" role="radiogroup" aria-label="Colour">
                        {doc.speakers.map((speaker) => (
                          <button
                            key={speaker}
                            type="button"
                            role="radio"
                            aria-checked={!first.rainbow && first.speaker === speaker}
                            aria-label={speaker}
                            title={speaker}
                            className="swatch"
                            style={{"--dot": speakerColor(speaker, colors)} as CSSVars}
                            onClick={() => change(setColour(words, line.first, {speaker}, true), line.first, true)}
                          />
                        ))}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={Boolean(first.rainbow)}
                          aria-label="Rainbow"
                          title="Rainbow"
                          className="swatch rainbow-dot"
                          onClick={() => change(setColour(words, line.first, {rainbow: true}, true), line.first, true)}
                        />
                        <button
                          type="button"
                          className="swatch swatch-new"
                          aria-label={`New speaker, ${newSpeaker}`}
                          title={`New speaker (${newSpeaker})`}
                          onClick={() => change(
                            setColour(words, line.first, {speaker: newSpeaker}, true), line.first, true)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="card-row">
                      <span>Motion</span>
                      <div className="segmented" role="radiogroup" aria-label="Motion">
                        {CAPTION_PRESETS.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            role="radio"
                            aria-checked={preset?.id === choice.id}
                            data-active={preset?.id === choice.id}
                            onClick={() => change(
                              applyPreset(words, line.first, choice, durationS), line.first, true)}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="card-row">
                      <span>Words</span>
                      <div className="card-words">
                        {lineWords.map((word, offset) => {
                          const index = line.first + offset;
                          return (
                            <button
                              key={`${index}:${word.text}`}
                              type="button"
                              className="card-word"
                              data-chosen={chosenWord === index}
                              data-size={sizeName(word.size).toLowerCase()}
                              title={`${sizeName(word.size)}. Choose to change its size, or split the line here.`}
                              onClick={() => setChosenWord(chosenWord === index ? null : index)}
                            >
                              {word.text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {chosenWord !== null && chosenWord >= line.first && chosenWord <= line.last && (
                      <div className="card-row">
                        <span>Size</span>
                        <div className="segmented" role="radiogroup" aria-label="Word size">
                          {WORD_SIZES.map(([name, size]) => (
                            <button
                              key={name}
                              type="button"
                              role="radio"
                              aria-checked={sizeName(words[chosenWord].size) === name}
                              data-active={sizeName(words[chosenWord].size) === name}
                              onClick={() => change(setSize(words, chosenWord, size, false), chosenWord, true)}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="card-actions">
                      <button type="button" onClick={() => preview(line.start, line.end)}>
                        Play line
                      </button>
                      <button
                        type="button"
                        disabled={chosenWord === null || chosenWord <= line.first || chosenWord > line.last}
                        title="Choose a word above, then split the line before it"
                        onClick={() => {
                          if (chosenWord === null) return;
                          change(breakBefore(words, chosenWord), chosenWord);
                          setChosenWord(null);
                        }}
                      >
                        <Scissors size={13} />
                        Split
                      </button>
                      <button
                        type="button"
                        disabled={line.first === 0}
                        title="Join this line to the one above"
                        onClick={() => change(joinPrevious(words, line.first), line.first)}
                      >
                        <Merge size={13} />
                        Merge up
                      </button>
                      <button
                        type="button"
                        className="card-delete"
                        onClick={() => {
                          setPicked(null);
                          change(removeLine(words, line.first), Math.max(0, line.first - 1));
                        }}
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
