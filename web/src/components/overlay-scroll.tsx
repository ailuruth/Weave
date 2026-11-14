"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const IDLE_MS = 900;
const MIN_THUMB_PX = 24;

type Thumb = {top: number; height: number} | null;
type Edges = {above: boolean; below: boolean};

export const OverlayScroll = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  as?: "div" | "ol";
  frameClassName?: string;
  children: ReactNode;
}>(function OverlayScroll({as = "div", frameClassName, className, children, onScroll, ...rest}, outer) {
  const scroller = useRef<HTMLElement>(null);
  useImperativeHandle(outer, () => scroller.current as HTMLElement);
  const [thumb, setThumb] = useState<Thumb>(null);
  const [edges, setEdges] = useState<Edges>({above: false, below: false});
  const [active, setActive] = useState(false);
  const idle = useRef(0);
  const drag = useRef<{y: number; top: number} | null>(null);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const {scrollTop, scrollHeight, clientHeight} = el;
    const above = scrollTop > 1;
    const below = scrollHeight - clientHeight - scrollTop > 1;
    setEdges((previous) => (previous.above === above && previous.below === below ? previous : {above, below}));
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const height = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * clientHeight);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
    setThumb((previous) => (previous && Math.abs(previous.top - top) < 0.5 && Math.abs(previous.height - height) < 0.5
      ? previous
      : {top, height}));
  }, []);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if (!drag.current) setActive(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutate = new MutationObserver(measure);
    mutate.observe(el, {childList: true, subtree: true, attributes: true});
    return () => {
      resize.disconnect();
      mutate.disconnect();
      window.clearTimeout(idle.current);
    };
  }, [measure]);

  const Tag = as;
  return (
    <div
      className={`overlay-scroll ${frameClassName ?? ""}`}
      data-above={edges.above ? "true" : undefined}
      data-below={edges.below ? "true" : undefined}
      onPointerEnter={wake}
    >
      <Tag
        {...rest}
        ref={scroller as never}
        className={className}
        onScroll={(event: never) => {
          measure();
          wake();
          onScroll?.(event);
        }}
      >
        {children}
      </Tag>
      {thumb && (
        <div
          className="overlay-thumb"
          data-active={active ? "true" : "false"}
          aria-hidden="true"
          style={{transform: `translateY(${thumb.top}px)`, height: thumb.height}}
          onPointerDown={(event) => {
            const el = scroller.current;
            if (!el) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {y: event.clientY, top: el.scrollTop};
            setActive(true);
          }}
          onPointerMove={(event) => {
            const el = scroller.current;
            if (!el || !drag.current) return;
            const travel = el.clientHeight - thumb.height;
            const range = el.scrollHeight - el.clientHeight;
            el.scrollTop = drag.current.top + ((event.clientY - drag.current.y) * range) / Math.max(1, travel);
          }}
          onPointerUp={() => {
            drag.current = null;
            wake();
          }}
        />
      )}
    </div>
  );
});
