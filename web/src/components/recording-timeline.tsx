"use client";

import {
  AudioLines,
  Captions,
  Keyboard,
  Maximize2,
  Plus,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {CaptionDocumentState} from "@/hooks/use-caption-document";
import type {RecordingTransport} from "@/hooks/use-recording-transport";
import {
  CAPTION_PRESETS,
  insertLine,
  linesOf,
  moveLine,
  retimeLine,
  setColour,
  type EditWord,
} from "@/lib/caption-edit";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import {
  fitView,
  followView,
  levelBars,
  minorTicks,
  nextLineStart,
  panView,
  positionLabel,
  previousLineStart,
  rulerTicks,
  tickLabel,
  zoomView,
  type View,
} from "@/lib/transport";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const ZOOM_STEP = 1.6;
const BAR_PX = 4;
const SNAP_PX = 8;
const DRAG_PX = 3;
const SPEEDS = [1, 0.75, 0.5];
const JUMP_S = 0.15;
const GLIDE_MS = 220;
const PREVIEW_SETTLE_MS = 200;
const ROW_H = 26;
const ROW_GAP = 3;
const RAINBOW_ROW = "~rainbow";
const NEW_CAPTION = "Caption";

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ["Space or K", "Play and pause"],
  ["← →", "One second back or forward"],
  ["⇧ ← →", "Five seconds"],
  ["⌥ ← →", "One frame"],
  ["↑ ↓", "Previous or next line"],
  ["Home End", "Start or end"],
  ["[ ]", "Start or end the current line here"],
  ["⌘Z ⇧⌘Z", "Undo and redo"],
  ["Click a line", "Edit it"],
  ["Drag a line up or down", "Give it to another speaker or the rainbow"],
  ["⌘ scroll", "Zoom"],
];

type DragMode = "move" | "start" | "end";

interface Drag {
  cue: number;
  mode: DragMode;
  x0: number;
  y0: number;
  /** The speaker row it started on and the one it is over. */
  row0: number;
  row: number;
  moved: boolean;
  /** Released and sent: kept on screen until the new score arrives. */
  sent: boolean;
  /** Where the line goes, placed exactly as the change will place it. */
  span: {startS: number; endS: number} | null;
}

/** The words after dragging line `cue` by `deltaS`, with its moving edges snapped. */
function dragged(
  words: readonly EditWord[],
  cue: number,
  mode: DragMode,
  deltaS: number,
  snap: (seconds: number) => number,
): {words: EditWord[]; first: number} | null {
  const line = linesOf(words).find((entry) => words[entry.first].line === cue);
  if (!line) return null;
  if (mode === "move") {
    const start = snap(line.start + deltaS);
    const end = snap(line.end + deltaS);
    const delta = start !== line.start + deltaS ? start - line.start : end - line.end;
    return {words: moveLine(words, line.first, line.last, delta), first: line.first};
  }
  return {
    words: mode === "start"
      ? retimeLine(words, line.first, line.last, snap(line.start + deltaS), line.end)
      : retimeLine(words, line.first, line.last, line.start, snap(line.end + deltaS)),
    first: line.first,
  };
}

function spanOf(words: readonly EditWord[], cue: number): {startS: number; endS: number} | null {
  const mine = words.filter((word) => word.line === cue);
  if (!mine.length) return null;
  return {startS: mine[0].start, endS: Math.max(...mine.map((word) => word.end))};
}

export function RecordingTimeline({
  transport,
  captions,
  colors,
  currentCue,
  onEditWord,
}: {
  transport: RecordingTransport;
  captions: CaptionDocumentState;
  colors: SpeakerColorMap;
  /** The caption line under the playhead, to mark its block. */
  currentCue: number | null;
  /** Open the editor on the word at this index. */
  onEditWord?: (index: number) => void;
}) {
  const {
    durationS, lines, sounds, levels, positionRef, playing, rate, generation,
    seek, play, pause, toggle, setRate, previewing,
  } = transport;
  const [view, setView] = useState<View>(() => fitView(durationS));
  const [fittedTo, setFittedTo] = useState(durationS);
  if (fittedTo !== durationS) {
    setFittedTo(durationS);
    setView(fitView(durationS));
  }
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scoreSeen, setScoreSeen] = useState(generation);
  if (scoreSeen !== generation) {
    setScoreSeen(generation);
    if (drag?.sent) setDrag(null);
  }
  const [width, setWidth] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const hoverRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef(view);
  const scrubRef = useRef<{resume: boolean; pending: number | null} | null>(null);
  const shownRef = useRef<{at: number | null; glide: {from: number; startMs: number} | null}>({at: null, glide: null});
  const previewRef = useRef({on: previewing, endedMs: -Infinity});
  useEffect(() => {
    const state = previewRef.current;
    if (state.on && !previewing) state.endedMs = performance.now();
    state.on = previewing;
  }, [previewing]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => setWidth(track.clientWidth));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.querySelector(".studio-shell")?.getAttribute("data-reduced-motion") === "true";
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const actual = positionRef.current ?? 0;
      const shownState = shownRef.current;
      const preview = previewRef.current;
      const settled = !playing && !preview.on && now - preview.endedMs > PREVIEW_SETTLE_MS;
      if (!settled) shownState.glide = null;
      if (settled && shownState.at !== null && !scrubRef.current && !still()
        && Math.abs(actual - shownState.at) > JUMP_S && !shownState.glide) {
        shownState.glide = {from: shownState.at, startMs: now};
      }
      if (scrubRef.current) shownState.glide = null;
      let position = actual;
      const glide = shownState.glide;
      if (glide) {
        const t = Math.min(1, (now - glide.startMs) / GLIDE_MS);
        position = glide.from + (actual - glide.from) * (1 - (1 - t) ** 3);
        if (t >= 1) shownState.glide = null;
      }
      shownState.at = position;
      const shown = viewRef.current;
      const span = shown.endS - shown.startS;
      const track = trackRef.current;
      const head = playheadRef.current;
      if (track && head && span > 0) {
        const x = ((position - shown.startS) / span) * track.clientWidth;
        head.style.transform = `translateX(${x.toFixed(1)}px)`;
        track.style.setProperty("--played", `${Math.max(0, x).toFixed(1)}px`);
        head.dataset.outside = x < 0 || x > track.clientWidth ? "true" : "false";
      }
      if (timeRef.current) timeRef.current.textContent = positionLabel(actual);
      const scrub = scrubRef.current;
      if (scrub && scrub.pending !== null) {
        seek(scrub.pending);
        scrub.pending = null;
      }
      if (playing && !scrub) {
        const followed = followView(shown, actual, durationS);
        if (followed !== shown) setView(followed);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [durationS, playing, positionRef, seek]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "?") setKeysOpen((open) => !open);
      else if (event.key === "Escape") setKeysOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const shown = viewRef.current;
      const span = shown.endS - shown.startS;
      const box = track.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const anchor = shown.startS + ((event.clientX - box.left) / box.width) * span;
        setView(zoomView(shown, Math.exp(event.deltaY * 0.004), anchor, durationS));
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      setView(panView(shown, (delta / box.width) * span, durationS));
    };
    track.addEventListener("wheel", onWheel, {passive: false});
    return () => track.removeEventListener("wheel", onWheel);
  }, [durationS]);

  const span = Math.max(1e-6, view.endS - view.startS);
  const perPx = span / Math.max(1, width);
  const at = (seconds: number) => ((seconds - view.startS) / span) * 100;
  const position = () => positionRef.current ?? 0;

  const timeAt = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return view.startS + share * span;
  };

  const startScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".timeline-line")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = {resume: playing, pending: timeAt(event.clientX)};
    if (playheadRef.current) playheadRef.current.dataset.held = "true";
    if (playing) pause();
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubRef.current) scrubRef.current.pending = timeAt(event.clientX);
    const track = trackRef.current;
    const hover = hoverRef.current;
    if (!track || !hover) return;
    const x = event.clientX - track.getBoundingClientRect().left;
    hover.style.transform = `translateX(${x.toFixed(1)}px)`;
    hover.dataset.side = x > track.clientWidth - 64 ? "left" : "right";
    hover.dataset.visible = "true";
    const label = hover.firstElementChild;
    if (label) label.textContent = positionLabel(timeAt(event.clientX));
  };
  const hideHover = () => {
    if (hoverRef.current) hoverRef.current.dataset.visible = "false";
  };
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (playheadRef.current) playheadRef.current.dataset.held = "false";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seek(scrub.pending ?? timeAt(event.clientX));
    if (scrub.resume) play();
  };

  const snapTo = (cue: number) => {
    const marks = [position(), ...lines.filter((line) => line.cue !== cue)
      .flatMap((line) => [line.startS, line.endS])];
    return (seconds: number) => {
      let best = seconds;
      let distance = SNAP_PX * perPx;
      for (const mark of marks) {
        if (Math.abs(mark - seconds) < distance) {
          best = mark;
          distance = Math.abs(mark - seconds);
        }
      }
      return best;
    };
  };

  const placed = (current: Drag, clientX: number) => {
    const words = captions.doc?.words;
    if (!words) return null;
    return dragged(words, current.cue, current.mode, (clientX - current.x0) * perPx,
      snapTo(current.cue));
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cue: number,
    row: number,
  ) => {
    if (event.button !== 0 || !captions.doc || captions.busy) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const mode: DragMode = edge === "start" || edge === "end" ? edge : "move";
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      cue, mode, x0: event.clientX, y0: event.clientY, row0: row, row,
      moved: false, sent: false, span: null,
    });
  };
  const rowFor = (current: Drag, clientY: number) => current.mode !== "move"
    ? current.row0
    : Math.min(rows.length - 1, Math.max(0,
      current.row0 + Math.round((clientY - current.y0) / (ROW_H + ROW_GAP))));
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.sent) return;
    const sideways = Math.abs(event.clientX - drag.x0) > DRAG_PX;
    const moved = drag.moved || sideways || Math.abs(event.clientY - drag.y0) > DRAG_PX;
    if (!moved) return;
    const next = sideways ? placed(drag, event.clientX) : null;
    setDrag({
      ...drag, moved, row: rowFor(drag, event.clientY),
      span: next ? spanOf(next.words, drag.cue) : drag.span,
    });
  };
  const editLine = (cue: number) => {
    const index = captions.doc?.words.findIndex((word) => word.line === cue) ?? -1;
    if (index >= 0) onEditWord?.(index);
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, startS: number) => {
    if (!drag || drag.sent) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) {
      setDrag(null);
      seek(startS);
      editLine(drag.cue);
      return;
    }
    const words = captions.doc?.words;
    const row = rowFor(drag, event.clientY);
    const sideways = Math.abs(event.clientX - drag.x0) > DRAG_PX;
    const timed = sideways ? placed(drag, event.clientX) : null;
    const first = words?.findIndex((word) => word.line === drag.cue) ?? -1;
    if (!words || first < 0 || (!timed && row === drag.row0)) {
      setDrag(null);
      return;
    }
    let next = timed?.words ?? [...words];
    if (row !== drag.row0) {
      next = setColour(next, timed?.first ?? first,
        rows[row] === RAINBOW_ROW ? {rainbow: true} : {speaker: rows[row] || null}, true);
    }
    setDrag({...drag, row, sent: true, span: spanOf(next, drag.cue)});
    void captions.commit(next, timed?.first ?? first, false).then((ok) => {
      if (!ok) setDrag(null);
    });
  };

  const addCaption = () => {
    const words = captions.doc?.words;
    if (!words) return;
    const atS = position();
    const here = lines.find((line) => atS >= line.startS && atS <= line.endS);
    const speaker = here && !here.rainbow ? here.speaker : rows.find((row) => row && row !== RAINBOW_ROW) ?? null;
    const added = insertLine(words, atS, NEW_CAPTION, speaker, CAPTION_PRESETS[0], durationS);
    if (!added) return;
    void captions.commit(added.words, added.index, true).then((ok) => {
      if (ok) onEditWord?.(added.index);
    });
  };

  const {step, ticks} = useMemo(() => rulerTicks(view, width), [view, width]);
  const minor = useMemo(() => minorTicks(view, step), [view, step]);
  const bars = useMemo(
    () => levelBars(levels, view, Math.max(1, Math.floor(width / BAR_PX))),
    [levels, view, width],
  );
  const wave = useMemo(() => bars.map((height, index) => {
    const h = Math.max(0.06, height) * 100;
    return `M${index * BAR_PX} ${(100 - h) / 2}h${BAR_PX - 1.5}v${h}h-${BAR_PX - 1.5}z`;
  }).join(""), [bars]);
  const rowKey = (line: {speaker: string | null; rainbow?: boolean}) =>
    line.rainbow ? RAINBOW_ROW : line.speaker ?? "";
  const order = [...(captions.doc?.speakers ?? [])];
  for (const line of lines) {
    const key = rowKey(line);
    if (!order.includes(key)) order.push(key);
  }
  const rows = order.length ? order : [""];
  const rowOf = (line: {speaker: string | null; rainbow?: boolean}) =>
    Math.max(0, rows.indexOf(rowKey(line)));
  const shownLines = lines
    .map((line) => (drag?.span && drag.cue === line.cue ? {...line, ...drag.span} : line))
    .filter((line) => line.endS > view.startS && line.startS < view.endS);
  const shownSounds = sounds.filter((sound) => sound.endS > view.startS && sound.startS < view.endS);
  const editable = Boolean(captions.doc);

  return (
    <section
      className="timeline"
      aria-label="Timeline"
      style={{"--lane-captions": `${rows.length * ROW_H + (rows.length - 1) * ROW_GAP}px`} as CSSVars}
    >
      {keysOpen && (
        <div className="timeline-keys" role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            {SHORTCUTS.map(([keys, does]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{does}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="timeline-bar">
        <span className="timeline-time">
          <span ref={timeRef}>{positionLabel(0)}</span>
          <span>{positionLabel(durationS)}</span>
        </span>
        <div className="timeline-transport">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous line"
            title="Previous line (↑)"
            onClick={() => seek(previousLineStart(lines, position()))}
          >
            <SkipBack size={16} fill="currentColor" />
          </button>
          <button
            type="button"
            className="timeline-play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={toggle}
          >
            {playing
              ? <Pause size={18} fill="currentColor" strokeWidth={0} />
              : <Play size={18} fill="currentColor" strokeWidth={0} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next line"
            title="Next line (↓)"
            onClick={() => {
              const next = nextLineStart(lines, position());
              if (next !== null) seek(next);
            }}
          >
            <SkipForward size={16} fill="currentColor" />
          </button>
        </div>
        <div className="timeline-view">
          <div className="timeline-speed" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                role="radio"
                aria-checked={rate === speed}
                data-active={rate === speed}
                onClick={() => setRate(speed)}
              >
                {speed}×
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button timeline-add-toggle"
            aria-label="Add a caption at the playhead"
            title="Add a caption at the playhead"
            disabled={!captions.doc || captions.busy}
            onClick={addCaption}
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            className="icon-button timeline-keys-toggle"
            aria-label="Keyboard shortcuts"
            aria-expanded={keysOpen}
            title="Keyboard shortcuts (?)"
            onClick={() => setKeysOpen((open) => !open)}
          >
            <Keyboard size={16} />
          </button>
          <div className="timeline-zoom">
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom out"
              title="Zoom out (⌘ scroll)"
              onClick={() => setView(zoomView(view, ZOOM_STEP, position(), durationS))}
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Show the whole recording"
              title="Show the whole recording"
              onClick={() => setView({startS: 0, endS: Math.max(2, durationS)})}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom in"
              title="Zoom in (⌘ scroll)"
              onClick={() => setView(zoomView(view, 1 / ZOOM_STEP, position(), durationS))}
            >
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="timeline-body">
      <ul className="timeline-lanes" aria-hidden="true">
        <li data-lane="audio"><AudioLines size={14} />Audio</li>
        <li data-lane="captions">
          {rows.map((speaker) => (
            <span key={speaker || "unknown"}>
              {speaker === RAINBOW_ROW
                ? <i className="rainbow-dot" />
                : speaker
                  ? <i style={{"--dot": speakerColor(speaker, colors)} as CSSVars} />
                  : <Captions size={13} />}
              {speaker === RAINBOW_ROW ? "Rainbow" : speaker || "Unknown"}
            </span>
          ))}
        </li>
        <li data-lane="sounds"><Volume2 size={14} />Sounds</li>
      </ul>
      <div
        className="timeline-track"
        ref={trackRef}
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onPointerLeave={hideHover}
      >
        <div className="timeline-band" data-lane="audio" aria-hidden="true" />
        <div className="timeline-band" data-lane="sounds" aria-hidden="true" />
        <div className="timeline-ruler" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{left: `${at(tick)}%`}}>{tickLabel(tick, step)}</span>
          ))}
          {minor.map((tick) => <i key={tick} style={{left: `${at(tick)}%`}} />)}
        </div>
        {[false, true].map((played) => (
          <svg
            key={String(played)}
            className="timeline-wave"
            data-played={played ? "" : undefined}
            viewBox={`0 0 ${Math.max(1, bars.length * BAR_PX)} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={wave} />
          </svg>
        ))}
        <div className="timeline-lines">
          {rows.map((speaker, row) => (
            <div
              key={speaker || "unknown"}
              className="timeline-row"
              style={{top: `${row * (ROW_H + ROW_GAP)}px`, height: `${ROW_H}px`}}
              aria-hidden="true"
            />
          ))}
          {shownLines.map((line) => {
            const row = drag?.cue === line.cue && drag.moved ? drag.row : rowOf(line);
            return (
            <button
              key={line.cue}
              type="button"
              className="timeline-line"
              data-current={line.cue === currentCue}
              data-dragging={drag?.cue === line.cue && drag.moved}
              data-editable={editable}
              style={{
                left: `${at(line.startS)}%`,
                width: `${Math.max(0.2, at(line.endS) - at(line.startS))}%`,
                top: `${row * (ROW_H + ROW_GAP)}px`,
                height: `${ROW_H}px`,
                "--line-color": speakerColor(
                  rows[row] && rows[row] !== RAINBOW_ROW ? rows[row] : line.speaker, colors),
              } as CSSVars}
              data-rainbow={rows[row] === RAINBOW_ROW ? "true" : undefined}
              title={line.text}
              onPointerDown={(event) => startDrag(event, line.cue, rowOf(line))}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event, line.startS)}
              onPointerCancel={() => setDrag(null)}
              onClick={(event) => {
                if (event.detail !== 0) return;
                seek(line.startS);
                editLine(line.cue);
              }}
            >
              {editable && <i data-edge="start" aria-hidden="true" />}
              <span>{line.text}</span>
              {editable && <i data-edge="end" aria-hidden="true" />}
            </button>
            );
          })}
        </div>
        <div className="timeline-sounds" aria-label="Sounds">
          {shownSounds.map((sound) => (
            <span
              key={`${sound.startS}:${sound.label}`}
              style={{
                left: `${at(sound.startS)}%`,
                width: `${Math.max(0.2, at(sound.endS) - at(sound.startS))}%`,
              }}
              title={`[${sound.label}]`}
            >
              [{sound.label}]
            </span>
          ))}
        </div>
        <div className="timeline-hover" ref={hoverRef} data-visible="false" aria-hidden="true">
          <span />
        </div>
        <div
          className="timeline-playhead"
          ref={playheadRef}
          data-playing={playing ? "true" : "false"}
          aria-hidden="true"
        />
      </div>
      </div>
    </section>
  );
}
