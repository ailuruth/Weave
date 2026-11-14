"use client";

import {Merge, Play, Plus, RotateCcw, Scissors, Trash2, Undo2, X} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type Ref,
} from "react";
import {
  CAPTION_PRESETS,
  applyPreset,
  applyWordPreset,
  insertLine,
  joinPrevious,
  lineAt,
  linesOf,
  nextSpeaker,
  parseClock,
  presetOf,
  removeLine,
  removeWord,
  retimeLine,
  retimeWord,
  setColour,
  setLineText,
  splitLineAt,
  wordPresetOf,
  type EditLine,
  type EditWord,
} from "@/lib/caption-edit";
import {positionLabel} from "@/lib/transport";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const NEW_CAPTION = "Caption";
const FOLLOW_AFTER_SCROLL_MS = 4000;
function speakerName(speaker: string | null): string {
  if (!speaker) return "No speaker";
  const n = /^S(\d+)$/.exec(speaker);
  return n ? `Speaker ${n[1]}` : speaker;
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
  textRef,
  caretRef,
}: {
  text: string;
  autoFocus: boolean;
  onCommit: (text: string) => void;
  onFocus: () => void;
  textRef?: Ref<HTMLTextAreaElement>;
  caretRef?: MutableRefObject<number | null>;
}) {
  const remember = (el: HTMLTextAreaElement) => {
    if (caretRef) caretRef.current = el.selectionStart;
  };
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }
  return (
    <textarea
      className="card-text"
      ref={textRef}
      value={draft}
      onSelect={(event) => remember(event.currentTarget)}
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
  seek,
  preview,
  captions,
  focus,
}: {
  colors: SpeakerColorMap;
  close: () => void;
  /** Where the picture is, from the published playhead. */
  positionS: number;
  durationS: number;
  playing: boolean;
  seek: (positionS: number) => void;
  /** Show the captions from `startS` to `endS` moving, the picture held still. */
  preview: (startS: number, endS: number) => void;
  captions: CaptionDocumentState;
  /** A word to open on, from outside the editor; `n` changes on every request. */
  focus?: {index: number; n: number} | null;
}) {
  const {doc, error, busy, canUndo, commit, undo, revert} = captions;
  const [picked, setPicked] = useState<number | null>(focus?.index ?? null);
  const [typing, setTyping] = useState<number | null>(focus?.index ?? null);
  const [target, setTarget] = useState<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const scrolledAtRef = useRef(0);
  const [focusSeen, setFocusSeen] = useState(focus?.n ?? null);
  if (focus && focus.n !== focusSeen) {
    setFocusSeen(focus.n);
    setPicked(focus.index);
    setTyping(focus.index);
    setTarget(null);
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
  const following = playing && picked === null;
  useEffect(() => {
    if (!following || currentFirst === null) return;
    if (performance.now() - scrolledAtRef.current < FOLLOW_AFTER_SCROLL_MS) return;
    listRef.current?.querySelector(`[data-first="${currentFirst}"]`)
      ?.scrollIntoView({block: "nearest"});
  }, [currentFirst, following]);
  const selectedFirst = selectedLine?.first ?? null;
  useEffect(() => {
    if (selectedFirst === null) return;
    listRef.current?.querySelector(`[data-first="${selectedFirst}"]`)
      ?.scrollIntoView({block: "nearest"});
  }, [selectedFirst]);

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
      setTarget(null);
      caretRef.current = null;
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
      setTarget(null);
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
            aria-label="Add a caption"
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
        <ol
          className="caption-cards"
          ref={listRef}
          onWheel={() => { scrolledAtRef.current = performance.now(); }}
          onTouchMove={() => { scrolledAtRef.current = performance.now(); }}
        >
          {lines.map((line, number) => {
            const selected = selectedLine?.first === line.first;
            const lineWords = words.slice(line.first, line.last + 1);
            const first = lineWords[0];
            const aim = selected && target !== null && target >= line.first && target <= line.last ? target : null;
            const scoped = aim === null ? first : words[aim];
            const preset = aim === null ? presetOf(words, line.first) : wordPresetOf(words[aim]);
            const at = aim ?? line.first;
            const whole = aim === null;
            return (
              <li
                key={`line-${number}`}
                className="caption-card"
                data-first={line.first}
                data-selected={selected}
                data-current={current?.first === line.first}
                style={{"--card-color": first.rainbow ? "transparent" : speakerColor(first.speaker, colors)} as CSSVars}
                data-rainbow={first.rainbow ? "true" : undefined}
                onClick={() => choose(line)}
              >
                <div className="card-head">
                  <TimeField
                    label="Start"
                    value={line.start}
                    onChange={(value) => change(
                      retimeLine(words, line.first, line.last, value, line.end), line.first)}
                  />
                  <span className="card-arrow" aria-hidden="true">–</span>
                  <TimeField
                    label="End"
                    value={line.end}
                    onChange={(value) => change(
                      retimeLine(words, line.first, line.last, line.start, value), line.first)}
                  />
                </div>
                <CaptionText
                  text={lineWords.map((word) => word.text).join(" ")}
                  autoFocus={typing === line.first}
                  textRef={selected ? textRef : undefined}
                  caretRef={selected ? caretRef : undefined}
                  onFocus={() => {
                    choose(line);
                    if (typing !== null) setTyping(null);
                  }}
                  onCommit={(text) => change(setLineText(words, line.first, text), line.first)}
                />
                {selected && (
                  <div className="card-tools" onClick={(event) => event.stopPropagation()}>
                    <div className="card-row">
                      <span>Edit</span>
                      <div className="card-words" role="radiogroup" aria-label="What to edit">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={whole}
                          className="card-word card-word-all"
                          onClick={() => setTarget(null)}
                        >
                          Whole line
                        </button>
                        {lineWords.map((word, offset) => {
                          const index = line.first + offset;
                          return (
                            <button
                              key={`word-${offset}`}
                              type="button"
                              role="radio"
                              aria-checked={aim === index}
                              className="card-word"
                              onClick={() => setTarget(aim === index ? null : index)}
                            >
                              {word.text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="card-row">
                      <span>Color</span>
                      <div className="swatches" role="radiogroup" aria-label="Color">
                        {doc.speakers.map((speaker) => (
                          <button
                            key={speaker}
                            type="button"
                            role="radio"
                            aria-checked={!scoped.rainbow && scoped.speaker === speaker}
                            aria-label={speakerName(speaker)}
                            title={speakerName(speaker)}
                            className="swatch"
                            style={{"--dot": speakerColor(speaker, colors)} as CSSVars}
                            onClick={() => change(setColour(words, at, {speaker}, whole), at, true)}
                          />
                        ))}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={Boolean(scoped.rainbow)}
                          aria-label="Rainbow"
                          title="Rainbow"
                          className="swatch rainbow-dot"
                          onClick={() => change(setColour(words, at, {rainbow: true}, whole), at, true)}
                        />
                        <button
                          type="button"
                          className="swatch swatch-new"
                          aria-label={`New speaker, ${speakerName(newSpeaker)}`}
                          title={`New speaker (${speakerName(newSpeaker)})`}
                          onClick={() => change(setColour(words, at, {speaker: newSpeaker}, whole), at, true)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="card-row">
                      <span>Style</span>
                      <div className="segmented" role="radiogroup" aria-label="Style">
                        {CAPTION_PRESETS.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            role="radio"
                            aria-checked={preset?.id === choice.id}
                            data-active={preset?.id === choice.id}
                            onClick={() => change(whole
                              ? applyPreset(words, line.first, choice, durationS)
                              : applyWordPreset(words, at, choice, durationS), at, true)}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {!whole && (
                      <div className="card-row">
                        <span>Time</span>
                        <div className="card-span">
                          <TimeField
                            label="Word start"
                            value={words[at].start}
                            onChange={(value) => change(retimeWord(words, at, value, words[at].end), at)}
                          />
                          <span className="card-arrow" aria-hidden="true">–</span>
                          <TimeField
                            label="Word end"
                            value={words[at].end}
                            onChange={(value) => change(retimeWord(words, at, words[at].start, value), at)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="card-actions">
                      <button
                        type="button"
                        className="card-preview"
                        title="Show how this caption moves, without playing the video"
                        onClick={() => preview(line.start, line.end)}
                      >
                        <Play size={12} fill="currentColor" strokeWidth={0} />
                        Preview
                      </button>
                      <button
                        type="button"
                        disabled={lineWords.length < 2 && lineWords[0].text.length < 2}
                        title="Split into two captions where the text cursor is"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          const draft = textRef.current?.value ?? lineWords.map((word) => word.text).join(" ");
                          const split = splitLineAt(words, line.first, draft, caretRef.current);
                          if (!split) return;
                          caretRef.current = null;
                          setTarget(null);
                          change(split.words, line.first);
                        }}
                      >
                        <Scissors size={13} />
                        Split
                      </button>
                      <button
                        type="button"
                        disabled={line.first === 0}
                        title="Make this and the caption above one caption"
                        onClick={() => {
                          setTarget(null);
                          change(joinPrevious(words, line.first), line.first);
                        }}
                      >
                        <Merge size={13} />
                        Join
                      </button>
                      <button
                        type="button"
                        className="card-delete"
                        aria-label={whole ? "Delete this caption" : `Delete “${words[at].text}”`}
                        title={whole ? "Delete this caption" : `Delete “${words[at].text}”`}
                        onClick={() => {
                          if (whole) {
                            setPicked(null);
                            change(removeLine(words, line.first), Math.max(0, line.first - 1));
                          } else {
                            setTarget(null);
                            change(removeWord(words, at), line.first);
                          }
                        }}
                      >
                        <Trash2 size={14} />
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
