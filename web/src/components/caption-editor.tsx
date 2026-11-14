"use client";

import {Merge, Play, Plus, RotateCcw, Scissors, Trash2, Undo2, X} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
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
  retimeLine,
  retimeWord,
  setColour,
  setLineText,
  splitLineAt,
  wordPresetOf,
  wordsInSelection,
  type EditLine,
  type EditWord,
} from "@/lib/caption-edit";
import {positionLabel} from "@/lib/transport";
import {OverlayScroll} from "@/components/overlay-scroll";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const NEW_CAPTION = "Caption";
const FOLLOW_AFTER_SCROLL_MS = 4000;
const TOOLS_OPEN_MS = 200;
const SLOW_WORD_S = 0.9;
const keepTextFocus = (event: {target: EventTarget; preventDefault: () => void}) => {
  if ((event.target as HTMLElement).closest("button")) event.preventDefault();
};
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
  caretRef,
  onSelectRange,
}: {
  text: string;
  autoFocus: boolean;
  onCommit: (text: string) => void;
  onFocus: () => void;
  caretRef?: MutableRefObject<number | null>;
  onSelectRange?: (value: string, start: number, end: number) => void;
}) {
  const remember = (el: HTMLTextAreaElement) => {
    if (caretRef) caretRef.current = el.selectionStart;
    onSelectRange?.(el.value, el.selectionStart, el.selectionEnd);
  };
  const own = useRef<HTMLTextAreaElement | null>(null);
  const rememberRef = useRef(remember);
  useEffect(() => {
    rememberRef.current = remember;
  });
  useEffect(() => {
    const el = own.current;
    if (!el) return;
    const read = () => rememberRef.current(el);
    el.addEventListener("select", read);
    el.addEventListener("selectionchange", read);
    return () => {
      el.removeEventListener("select", read);
      el.removeEventListener("selectionchange", read);
    };
  }, []);
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }
  return (
    <textarea
      className="card-text"
      ref={own}
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
  const [sel, setSel] = useState<[number, number] | null>(null);
  const anchorRef = useRef<number | null>(null);
  const caretRef = useRef<number | null>(null);
  const scrolledAtRef = useRef(0);
  const [focusSeen, setFocusSeen] = useState(focus?.n ?? null);
  if (focus && focus.n !== focusSeen) {
    setFocusSeen(focus.n);
    setPicked(focus.index);
    setTyping(focus.index);
    setSel(null);
  }

  const words = doc?.words ?? [];
  const lines = useMemo<EditLine[]>(() => linesOf(doc?.words ?? []), [doc]);
  const selectedLine = picked !== null && words.length
    ? lineAt(lines, Math.min(picked, words.length - 1))
    : null;
  const current = lines.find((entry) => positionS >= entry.start && positionS <= entry.end)
    ?? null;

  const listRef = useRef<HTMLElement>(null);
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
    const timer = window.setTimeout(() => {
      listRef.current?.querySelector(`[data-first="${selectedFirst}"]`)
        ?.scrollIntoView({block: "nearest", behavior: "smooth"});
    }, TOOLS_OPEN_MS);
    return () => window.clearTimeout(timer);
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
      setSel(null);
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
      setSel(null);
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
        <OverlayScroll
          as="ol"
          frameClassName="caption-cards-frame"
          className="caption-cards"
          ref={listRef}
          onWheel={() => { scrolledAtRef.current = performance.now(); }}
          onTouchMove={() => { scrolledAtRef.current = performance.now(); }}
        >
          {lines.map((line, number) => {
            const selected = selectedLine?.first === line.first;
            const lineWords = words.slice(line.first, line.last + 1);
            const first = lineWords[0];
            const text = lineWords.map((word) => word.text).join(" ");
            const range = selected && sel && sel[0] >= line.first && sel[1] <= line.last ? sel : null;
            const picked = range ? words.slice(range[0], range[1] + 1) : lineWords;
            const across = (edit: (current: EditWord[], index: number) => EditWord[]) => {
              let next = [...words];
              for (let index = range![0]; index <= range![1]; index += 1) next = edit(next, index);
              return next;
            };
            const presetIds = new Set(picked.map((word) => wordPresetOf(word)?.id ?? ""));
            const preset = range
              ? (presetIds.size === 1 ? wordPresetOf(picked[0]) : null)
              : presetOf(words, line.first);
            const colour = picked[0];
            const recolour = (choice: {speaker: string | null} | {rainbow: true}) => change(range
              ? across((current, index) => setColour(current, index, choice, false))
              : setColour(words, line.first, choice, true), range ? range[0] : line.first, true);
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
                  {selected && (
                    <div className="card-icons" onMouseDown={keepTextFocus}>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Preview"
                        title="Preview its motion"
                        onClick={() => preview(line.start, line.end)}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Split at the cursor"
                        title="Split at the cursor"
                        disabled={lineWords.length < 2 && first.text.length < 2}
                        onClick={() => {
                          const field = listRef.current?.querySelector<HTMLTextAreaElement>(
                            ".caption-card[data-selected=true] .card-text");
                          const draft = field?.value ?? text;
                          const split = splitLineAt(words, line.first, draft, caretRef.current);
                          if (!split) return;
                          caretRef.current = null;
                          setSel(null);
                          change(split.words, line.first);
                        }}
                      >
                        <Scissors size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Join with the caption above"
                        title="Join with the caption above"
                        disabled={line.first === 0}
                        onClick={() => {
                          setSel(null);
                          change(joinPrevious(words, line.first), line.first);
                        }}
                      >
                        <Merge size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button card-delete"
                        aria-label={range ? "Delete the selected words" : "Delete this caption"}
                        title={range ? "Delete the selected words" : "Delete this caption"}
                        onClick={() => {
                          if (range) {
                            setSel(null);
                            change(words.filter((_, index) => index < range[0] || index > range[1]), line.first);
                          } else {
                            setPicked(null);
                            change(removeLine(words, line.first), Math.max(0, line.first - 1));
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <CaptionText
                  text={text}
                  autoFocus={typing === line.first}
                  caretRef={selected ? caretRef : undefined}
                  onSelectRange={selected ? (value, start, end) => {
                    const found = value === text ? wordsInSelection(value, start, end) : null;
                    const next: [number, number] | null = found
                      ? [line.first + found[0], line.first + found[1]]
                      : null;
                    if (next?.[0] !== sel?.[0] || next?.[1] !== sel?.[1]) setSel(next);
                  } : undefined}
                  onFocus={() => {
                    choose(line);
                    if (typing !== null) setTyping(null);
                  }}
                  onCommit={(value) => {
                    setSel(null);
                    change(setLineText(words, line.first, value), line.first);
                  }}
                />
                {selected && (
                  <div
                    className="card-tools"
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={keepTextFocus}
                  >
                    <div className="card-strip" role="group" aria-label="Words, as they will move">
                      {lineWords.map((word, offset) => {
                        const index = line.first + offset;
                        const on = range !== null && index >= range[0] && index <= range[1];
                        return (
                          <button
                            key={`word-${offset}`}
                            type="button"
                            className="strip-word"
                            aria-pressed={on}
                            data-rainbow={word.rainbow ? "true" : undefined}
                            data-slow={word.end - word.start > SLOW_WORD_S ? "true" : undefined}
                            title={`${word.text}, ${wordPresetOf(word)?.label ?? "as spoken"}`}
                            style={{
                              "--s": word.size.toFixed(3),
                              "--ink": word.rainbow ? undefined : speakerColor(word.speaker, colors),
                            } as CSSVars}
                            onClick={(event) => {
                              if (event.shiftKey && anchorRef.current !== null
                                && anchorRef.current >= line.first && anchorRef.current <= line.last) {
                                const from = Math.min(anchorRef.current, index);
                                setSel([from, Math.max(anchorRef.current, index)]);
                                return;
                              }
                              anchorRef.current = index;
                              setSel(range && range[0] === index && range[1] === index ? null : [index, index]);
                            }}
                          >
                            {word.text}
                          </button>
                        );
                      })}
                    </div>
                    {range && range[0] === range[1] && (
                      <div className="card-scope">
                        <span>“{words[range[0]].text}”</span>
                        <span className="card-span">
                          <TimeField
                            label="Word start"
                            value={words[range[0]].start}
                            onChange={(value) => change(
                              retimeWord(words, range[0], value, words[range[0]].end), range[0])}
                          />
                          <span className="card-arrow" aria-hidden="true">–</span>
                          <TimeField
                            label="Word end"
                            value={words[range[0]].end}
                            onChange={(value) => change(
                              retimeWord(words, range[0], words[range[0]].start, value), range[0])}
                          />
                        </span>
                      </div>
                    )}
                    <div className="swatches" role="radiogroup" aria-label="Color">
                      {doc.speakers.map((speaker) => (
                        <button
                          key={speaker}
                          type="button"
                          role="radio"
                          aria-checked={!colour.rainbow && colour.speaker === speaker}
                          aria-label={speakerName(speaker)}
                          title={speakerName(speaker)}
                          className="swatch"
                          style={{"--dot": speakerColor(speaker, colors)} as CSSVars}
                          onClick={() => recolour({speaker})}
                        />
                      ))}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={Boolean(colour.rainbow)}
                        aria-label="Rainbow"
                        title="Rainbow"
                        className="swatch rainbow-dot"
                        onClick={() => recolour({rainbow: true})}
                      />
                      <button
                        type="button"
                        className="swatch swatch-new"
                        aria-label={`New speaker, ${speakerName(newSpeaker)}`}
                        title={`New speaker (${speakerName(newSpeaker)})`}
                        onClick={() => recolour({speaker: newSpeaker})}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Style">
                      {CAPTION_PRESETS.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          role="radio"
                          aria-checked={preset?.id === choice.id}
                          data-active={preset?.id === choice.id}
                          onClick={() => change(range
                            ? across((current, index) => applyWordPreset(current, index, choice, durationS))
                            : applyPreset(words, line.first, choice, durationS), range ? range[0] : line.first, true)}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </OverlayScroll>
      )}
    </section>
  );
}
