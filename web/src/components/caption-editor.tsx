"use client";

import {Check, Merge, Play, Plus, RotateCcw, Scissors, Trash2, Undo2, X} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
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
import {PREVIEW_LEAD_S} from "@/hooks/use-recording-transport";
import {speakerColor, speakerName, type SpeakerColorMap} from "@/lib/speaker-colors";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";
import type {CueLook} from "@/hooks/use-caption-stream";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const NEW_CAPTION = "Caption";
const FOLLOW_AFTER_SCROLL_MS = 4000;
const SELECT_SCROLL_MS = 200;
const SLOW_WORD_S = 0.9;
const ENTER_MS = 420;
const LEAVE_MS = 170;
const SIZE_STEP = 0.05;
const POSITIONS = [
  {id: "bottom", label: "Bottom"},
  {id: "top", label: "Top"},
] as const;

const keepTextFocus = (event: {target: EventTarget; preventDefault: () => void}) => {
  if ((event.target as HTMLElement).closest("button")) event.preventDefault();
};

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
      className="field field-time"
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
          event.stopPropagation();
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
  caretRef: MutableRefObject<number | null>;
  onSelectRange: (value: string, start: number, end: number) => void;
}) {
  const remember = (el: HTMLTextAreaElement) => {
    caretRef.current = el.selectionStart;
    onSelectRange(el.value, el.selectionStart, el.selectionEnd);
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
      className="field field-text"
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
          event.stopPropagation();
          setDraft(text);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Section({label, aside, children}: {label: string; aside?: ReactNode; children: ReactNode}) {
  return (
    <div className="inspector-section">
      <div className="inspector-label">
        <span>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Switch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly {id: T; label: string}[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  const at = options.findIndex((option) => option.id === value);
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{"--seg-n": options.length, "--seg-i": Math.max(0, at), "--seg-on": at < 0 ? 0 : 1} as CSSVars}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          data-active={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InspectorFrame({view, children}: {view: string; children: ReactNode}) {
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const target = useRef(-1);
  const fit = useCallback((glide: boolean) => {
    const outer = frame.current;
    const body = inner.current;
    if (!outer || !body) return;
    const height = body.offsetHeight;
    if (height === target.current) return;
    outer.style.transition = glide && target.current >= 0 ? "" : "none";
    outer.style.height = `${height}px`;
    target.current = height;
  }, []);
  useLayoutEffect(() => {
    fit(true);
  }, [view, fit]);
  useLayoutEffect(() => {
    const body = inner.current;
    if (!body) return;
    const observer = new ResizeObserver(() => fit(false));
    observer.observe(body);
    return () => observer.disconnect();
  }, [fit]);
  return (
    <div className="inspector-frame" ref={frame}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

function marked(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

export function CaptionEditor({
  colors,
  close,
  positionS,
  durationS,
  playing,
  seek,
  preview,
  previewing,
  captions,
  focus,
  look,
  sizeRange,
  setLook,
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
  previewing: boolean;
  captions: CaptionDocumentState;
  /** A word to open on, from outside the editor; `n` changes on every request. */
  focus?: {index: number; n: number} | null;
  look: CueLook;
  sizeRange: [number, number];
  setLook: (look: CueLook) => void;
}) {
  const {doc, error, busy, canUndo, commit, undo, revert} = captions;
  const [picked, setPicked] = useState<number | null>(focus?.index ?? null);
  const [typing, setTyping] = useState<number | null>(focus?.index ?? null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<number | null>(null);
  const caretRef = useRef<number | null>(null);
  const scrolledAtRef = useRef(0);
  const inspectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = inspectorRef.current;
    if (!box) return;
    const mark = () => {
      const more = box.scrollHeight - box.clientHeight - box.scrollTop > 1;
      box.dataset.more = more ? "true" : "false";
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    box.addEventListener("scroll", mark, {passive: true});
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", mark);
    };
  }, []);
  const [fresh, setFresh] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const flash = (set: (value: (current: number | null) => number | null) => void, value: number, ms: number) => {
    set(() => value);
    window.setTimeout(() => set((current) => (current === value ? null : current)), ms);
  };
  const [focusSeen, setFocusSeen] = useState(focus?.n ?? null);
  if (focus && focus.n !== focusSeen) {
    setFocusSeen(focus.n);
    setPicked(focus.index);
    setTyping(focus.index);
    setSel(null);
  }

  const words = useMemo(() => doc?.words ?? [], [doc]);
  const lines = useMemo<EditLine[]>(() => linesOf(words), [words]);
  const texts = useMemo(
    () => lines.map((line) => words.slice(line.first, line.last + 1).map((word) => word.text).join(" ")),
    [lines, words],
  );
  const selectedLine = picked !== null && words.length
    ? lineAt(lines, Math.min(picked, words.length - 1))
    : null;
  const current = lines.find((entry) => positionS >= entry.start && positionS <= entry.end)
    ?? null;
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? lines.filter((_, number) => texts[number].toLowerCase().includes(needle)) : []),
    [lines, needle, texts],
  );

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
    }, SELECT_SCROLL_MS);
    return () => window.clearTimeout(timer);
  }, [selectedFirst]);

  const change = (next: EditWord[], index: number, show = false) => {
    void commit(next, index).then((ok) => {
      if (!ok || !show) return;
      const line = lineAt(linesOf(next), Math.min(index, next.length - 1));
      if (line) window.setTimeout(() => preview(line.start, line.end), 250);
    });
  };

  const deselect = () => {
    setPicked(null);
    setSel(null);
    caretRef.current = null;
  };

  const choose = (line: EditLine, always = false) => {
    if (selectedLine?.first === line.first && !always) {
      deselect();
      return;
    }
    if (selectedLine?.first !== line.first) {
      setPicked(line.first);
      setSel(null);
      caretRef.current = null;
    }
    if (always || !playing) seek(line.start);
  };

  const jump = (step: 1 | -1) => {
    if (!matches.length) return;
    const from = selectedLine?.first ?? (step > 0 ? -1 : Number.POSITIVE_INFINITY);
    const target = step > 0
      ? matches.find((line) => line.first > from) ?? matches[0]
      : [...matches].reverse().find((line) => line.first < from) ?? matches[matches.length - 1];
    choose(target, true);
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
      flash(setFresh, added.index, ENTER_MS);
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    if (sel) setSel(null);
    else if (picked !== null) deselect();
  };

  const splitAtCaret = (line: EditLine, text: string) => {
    const field = inspectorRef.current?.querySelector<HTMLTextAreaElement>(".field-text");
    const split = splitLineAt(words, line.first, field?.value ?? text, caretRef.current);
    if (!split) return;
    caretRef.current = null;
    setSel(null);
    change(split.words, line.first);
    flash(setFresh, split.first, ENTER_MS);
  };

  const newSpeaker = nextSpeaker(doc?.speakers ?? []);

  const lineInspector = (line: EditLine) => {
    const lineWords = words.slice(line.first, line.last + 1);
    const first = lineWords[0];
    const text = texts[lines.indexOf(line)] ?? "";
    const range = sel && sel[0] >= line.first && sel[1] <= line.last ? sel : null;
    const chosen = range ? words.slice(range[0], range[1] + 1) : lineWords;
    const across = (edit: (current: EditWord[], index: number) => EditWord[]) => {
      let next = [...words];
      for (let index = range![0]; index <= range![1]; index += 1) next = edit(next, index);
      return next;
    };
    const presetIds = new Set(chosen.map((word) => wordPresetOf(word)?.id ?? ""));
    const preset = range
      ? (presetIds.size === 1 ? wordPresetOf(chosen[0]) : null)
      : presetOf(words, line.first);
    const colour = chosen[0];
    const speaking = new Set(words.map((word) => word.speaker));
    const voices = doc!.speakers.filter((speaker) => speaking.has(speaker) || speaker === colour.speaker);
    const recolour = (choice: {speaker: string | null} | {rainbow: true}) => change(range
      ? across((current, index) => setColour(current, index, choice, false))
      : setColour(words, line.first, choice, true), range ? range[0] : line.first, true);
    const captionName = `Caption ${lines.indexOf(line) + 1}`;
    const scopeName = !range
      ? null
      : range[0] === range[1] ? `“${words[range[0]].text}”` : `${range[1] - range[0] + 1} words`;
    const span = range
      ? {start: words[range[0]].start, end: words[range[1]].end}
      : {start: line.start, end: line.end};
    const retime = (edge: "start" | "end", value: number) => {
      if (!range) {
        change(retimeLine(words, line.first, line.last,
          edge === "start" ? value : line.start, edge === "end" ? value : line.end), line.first);
        return;
      }
      const index = edge === "start" ? range[0] : range[1];
      change(retimeWord(words, index,
        edge === "start" ? value : words[index].start,
        edge === "end" ? value : words[index].end), range[0]);
    };
    const pickWord = (index: number, extend: boolean) => {
      if (extend && anchorRef.current !== null
        && anchorRef.current >= line.first && anchorRef.current <= line.last) {
        setSel([Math.min(anchorRef.current, index), Math.max(anchorRef.current, index)]);
        return;
      }
      anchorRef.current = index;
      setSel(range && range[0] === index && range[1] === index ? null : [index, index]);
    };
    return (
      <div
        className="inspector-body"
        key={`line-${line.first}`}
        data-previewing={previewing ? "true" : undefined}
        onMouseDown={keepTextFocus}
      >
        <div className="inspector-head">
          <h3>
            {scopeName ? (
              <>
                <button type="button" className="inspector-crumb" onClick={() => setSel(null)}>
                  {captionName}
                </button>
                <span className="inspector-crumb-sep" aria-hidden="true">/</span>
                <span>{scopeName}</span>
              </>
            ) : captionName}
          </h3>
          <div className="inspector-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Preview"
              title="Preview its motion"
              onClick={() => preview(line.start, line.end)}
            >
              <Play size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Split at the cursor"
              title="Split at the cursor"
              disabled={lineWords.length < 2 && first.text.length < 2}
              onClick={() => splitAtCaret(line, text)}
            >
              <Scissors size={16} />
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
              <Merge size={16} />
            </button>
            <button
              type="button"
              className="icon-button inspector-delete"
              aria-label={range ? "Delete the selected words" : "Delete this caption"}
              title={range ? "Delete the selected words" : "Delete this caption"}
              onClick={() => {
                if (range) {
                  setSel(null);
                  change(words.filter((_, index) => index < range[0] || index > range[1]), line.first);
                  return;
                }
                setLeaving(line.first);
                window.setTimeout(() => {
                  setLeaving(null);
                  deselect();
                  change(removeLine(words, line.first), Math.max(0, line.first - 1));
                }, LEAVE_MS);
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div className="word-strip" role="group" aria-label="Words, as they will move">
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
                  "--at": `${(word.start - line.start + PREVIEW_LEAD_S).toFixed(3)}s`,
                  "--len": `${Math.max(0.12, word.end - word.start).toFixed(3)}s`,
                  "--s": word.size.toFixed(3),
                  "--ink": word.rainbow ? undefined : speakerColor(word.speaker, colors),
                } as CSSVars}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  pickWord(index, event.shiftKey);
                }}
                onClick={(event) => {
                  if (event.detail === 0) pickWord(index, event.shiftKey);
                }}
              >
                {word.text}
              </button>
            );
          })}
        </div>
        <Section label="Text">
          <CaptionText
            text={text}
            autoFocus={typing === line.first}
            caretRef={caretRef}
            onSelectRange={(value, start, end) => {
              const found = value === text ? wordsInSelection(value, start, end) : null;
              const whole = found !== null && found[0] === 0 && found[1] === line.last - line.first;
              const next: [number, number] | null = found && !whole
                ? [line.first + found[0], line.first + found[1]]
                : null;
              if (next?.[0] !== sel?.[0] || next?.[1] !== sel?.[1]) setSel(next);
            }}
            onFocus={() => {
              if (typing !== null) setTyping(null);
            }}
            onCommit={(value) => {
              setSel(null);
              change(setLineText(words, line.first, value), line.first);
            }}
          />
        </Section>
        <Section label="Color">
          <div
            className="swatches"
            role="radiogroup"
            aria-label="Color"
          >
            {voices.map((speaker) => (
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
              >
                {!colour.rainbow && colour.speaker === speaker && <Check size={12} strokeWidth={2.75} />}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={Boolean(colour.rainbow)}
              aria-label="Rainbow"
              title="Rainbow"
              className="swatch rainbow-dot"
              onClick={() => recolour({rainbow: true})}
            >
              {colour.rainbow && <Check size={12} strokeWidth={2.75} />}
            </button>
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
        </Section>
        <Section label="Style">
          <Switch
            label="Style"
            options={CAPTION_PRESETS}
            value={preset?.id ?? null}
            onChange={(id) => {
              const choice = CAPTION_PRESETS.find((option) => option.id === id)!;
              change(range
                ? across((current, index) => applyWordPreset(current, index, choice, durationS))
                : applyPreset(words, line.first, choice, durationS), range ? range[0] : line.first, true);
            }}
          />
        </Section>
        <Section label="Timing">
          <div className="time-pair">
            <TimeField
              label={!range ? "Start" : range[0] === range[1] ? "Word start" : "Words start"}
              value={span.start}
              onChange={(value) => retime("start", value)}
            />
            <span aria-hidden="true">–</span>
            <TimeField
              label={!range ? "End" : range[0] === range[1] ? "Word end" : "Words end"}
              value={span.end}
              onChange={(value) => retime("end", value)}
            />
          </div>
        </Section>
      </div>
    );
  };

  const [low, high] = sizeRange;
  const lookInspector = (
    <div className="inspector-body" key="look">
      <div className="inspector-head">
        <h3>All captions</h3>
      </div>
      <Section label="Position">
        <Switch
          label="Position"
          options={POSITIONS}
          value={look.position}
          onChange={(position) => setLook({...look, position})}
        />
      </Section>
      <Section
        label="Size"
        aside={<output htmlFor="caption-look-size">{Math.round(look.size * 100)}%</output>}
      >
        <input
          id="caption-look-size"
          className="look-range"
          type="range"
          min={low}
          max={high}
          step={SIZE_STEP}
          value={look.size}
          aria-label="Size"
          title="Double-click to reset"
          style={{"--fill": `${((look.size - low) / (high - low)) * 100}%`} as CSSVars}
          onChange={(event) => setLook({...look, size: Number(event.target.value)})}
          onDoubleClick={() => setLook({...look, size: 1})}
        />
      </Section>
    </div>
  );

  return (
    <section
      className="caption-editor"
      aria-label="Caption editor"
      data-busy={busy}
      onKeyDown={onKeyDown}
    >
      <header className="editor-bar">
        <input
          className="field editor-search"
          type="search"
          value={query}
          placeholder="Search captions"
          aria-label="Search captions"
          title="Enter for the next match, Shift-Enter for the one before"
          spellCheck={false}
          disabled={!doc}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              jump(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        <div>
          <button
            type="button"
            className="editor-add"
            aria-label="Add a caption"
            title="Add a caption at the playhead"
            disabled={!doc || busy}
            onClick={addCaption}
          >
            <Plus size={14} />
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
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Back to Weave's captions"
            title="Back to Weave's captions"
            disabled={!doc || doc.generation === 0 || busy}
            onClick={() => void revert()}
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Close the editor"
            title="Close"
            onClick={close}
          >
            <X size={16} />
          </button>
        </div>
      </header>


      {error && <p className="editor-error" role="alert">{error}</p>}
      {!doc && !error && <p className="editor-note">Reading the captions…</p>}

      {doc && (
        <div className="inspector" ref={inspectorRef}>
          <InspectorFrame view={selectedLine ? `line-${selectedLine.first}` : "look"}>
            {selectedLine ? lineInspector(selectedLine) : lookInspector}
          </InspectorFrame>
        </div>
      )}

      {doc && !words.length && (
        <p className="editor-note">No captions yet. Add one at the playhead.</p>
      )}

      {doc && (
        <OverlayScroll
          as="ol"
          frameClassName="caption-list-frame"
          className="caption-list"
          ref={listRef}
          data-searching={needle ? "true" : undefined}
          onWheel={() => { scrolledAtRef.current = performance.now(); }}
          onTouchMove={() => { scrolledAtRef.current = performance.now(); }}
          onClick={(event) => {
            if (event.target === event.currentTarget) deselect();
          }}
        >
          {lines.map((line, number) => {
            const first = words[line.first];
            return (
              <li
                key={`line-${number}`}
                data-first={line.first}
                data-fresh={fresh === line.first ? "true" : undefined}
                data-leaving={leaving === line.first ? "true" : undefined}
              >
                <button
                  type="button"
                  className="caption-row"
                  aria-current={selectedLine?.first === line.first ? "true" : undefined}
                  data-current={current?.first === line.first}
                  data-match={needle ? texts[number].toLowerCase().includes(needle) : undefined}
                  onClick={() => choose(line)}
                >
                  <i
                    className={first.rainbow ? "row-dot rainbow-dot" : "row-dot"}
                    style={first.rainbow ? undefined : {"--dot": speakerColor(first.speaker, colors)} as CSSVars}
                    aria-hidden="true"
                  />
                  <span className="row-time">{positionLabel(line.start)}</span>
                  <span className="row-text">{marked(texts[number], needle)}</span>
                </button>
              </li>
            );
          })}
        </OverlayScroll>
      )}
    </section>
  );
}
