"use client";

import {
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
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
import type {RecordingTransport} from "@/hooks/use-recording-transport";
import {speakerColor, type SpeakerColorMap} from "@/lib/speaker-colors";
import {
  fitView,
  followView,
  levelBars,
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
const BAR_PX = 3;

export function RecordingTimeline({
  transport,
  colors,
  currentCue,
}: {
  transport: RecordingTransport;
  colors: SpeakerColorMap;
  /** The caption line under the playhead, to mark its block. */
  currentCue: number | null;
}) {
  const {durationS, lines, levels, positionRef, playing, seek, play, pause, toggle} = transport;
  const [view, setView] = useState<View>(() => fitView(durationS));
  const [fittedTo, setFittedTo] = useState(durationS);
  if (fittedTo !== durationS) {
    setFittedTo(durationS);
    setView(fitView(durationS));
  }
  const [width, setWidth] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef(view);
  const scrubRef = useRef<{resume: boolean; pending: number | null} | null>(null);

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
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const position = positionRef.current ?? 0;
      const shown = viewRef.current;
      const span = shown.endS - shown.startS;
      const track = trackRef.current;
      const head = playheadRef.current;
      if (track && head && span > 0) {
        const x = ((position - shown.startS) / span) * track.clientWidth;
        head.style.transform = `translateX(${x.toFixed(1)}px)`;
        head.dataset.outside = x < 0 || x > track.clientWidth ? "true" : "false";
      }
      if (timeRef.current) timeRef.current.textContent = positionLabel(position);
      const scrub = scrubRef.current;
      if (scrub && scrub.pending !== null) {
        seek(scrub.pending);
        scrub.pending = null;
      }
      if (playing && !scrub) {
        const followed = followView(shown, position, durationS);
        if (followed !== shown) setView(followed);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [durationS, playing, positionRef, seek]);

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

  const timeAt = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return view.startS + share * (view.endS - view.startS);
  };

  const startScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".timeline-line")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = {resume: playing, pending: timeAt(event.clientX)};
    if (playing) pause();
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubRef.current) scrubRef.current.pending = timeAt(event.clientX);
  };
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seek(scrub.pending ?? timeAt(event.clientX));
    if (scrub.resume) play();
  };

  const span = Math.max(1e-6, view.endS - view.startS);
  const at = (seconds: number) => ((seconds - view.startS) / span) * 100;
  const {step, ticks} = useMemo(() => rulerTicks(view, width), [view, width]);
  const bars = useMemo(
    () => levelBars(levels, view, Math.max(1, Math.floor(width / BAR_PX))),
    [levels, view, width],
  );
  const wave = useMemo(() => bars.map((height, index) => {
    const h = Math.max(0.04, height) * 100;
    return `M${index * BAR_PX} ${(100 - h) / 2}h${BAR_PX - 1}v${h}h-${BAR_PX - 1}z`;
  }).join(""), [bars]);
  const shownLines = lines.filter((line) => line.endS > view.startS && line.startS < view.endS);
  const position = () => positionRef.current ?? 0;

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <div className="timeline-transport">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous line"
            title="Previous line (↑)"
            onClick={() => seek(previousLineStart(lines, position()))}
          >
            <SkipBack size={15} />
          </button>
          <button
            type="button"
            className="icon-button timeline-play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={toggle}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
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
            <SkipForward size={15} />
          </button>
          <span className="timeline-time">
            <span ref={timeRef}>{positionLabel(0)}</span>
            <span> / {positionLabel(durationS)}</span>
          </span>
        </div>
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

      <div
        className="timeline-track"
        ref={trackRef}
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        <div className="timeline-ruler" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{left: `${at(tick)}%`}}>{tickLabel(tick, step)}</span>
          ))}
        </div>
        <svg
          className="timeline-wave"
          viewBox={`0 0 ${Math.max(1, bars.length * BAR_PX)} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} />
        </svg>
        <div className="timeline-lines">
          {shownLines.map((line) => (
            <button
              key={line.cue}
              type="button"
              className="timeline-line"
              data-current={line.cue === currentCue}
              style={{
                left: `${at(line.startS)}%`,
                width: `${Math.max(0.2, at(line.endS) - at(line.startS))}%`,
                "--line-color": speakerColor(line.speaker, colors),
              } as CSSVars}
              title={line.text}
              onClick={() => seek(line.startS)}
            >
              <span>{line.text}</span>
            </button>
          ))}
        </div>
        <div className="timeline-playhead" ref={playheadRef} aria-hidden="true" />
      </div>
    </section>
  );
}
