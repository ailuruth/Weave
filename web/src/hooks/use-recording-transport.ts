"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {CaptionEvent} from "@/lib/caption-store";
import {
  dueBetween,
  scoreLevels,
  scoreLines,
  scoreSounds,
  seekBatch,
  type Score,
  type TimelineLine,
  type TimelineSound,
} from "@/lib/transport";

/** How many events the stage is handed on a seek: as many as it keeps. */
const SEEK_KEEP = 150;
/** A caption preview starts this far before its line and holds this long after it. */
export const PREVIEW_LEAD_S = 0.3;

export interface StageFeed {
  dispatch: (event: CaptionEvent) => void;
  restage: (speakers: string[]) => void;
  /** Apply what a seek handed over in the same render as its restage. */
  settle: () => void;
  driveClock: (acousticMs: number, held: boolean) => void;
  rebaseSchedule: () => void;
  showLevel: (event: CaptionEvent) => void;
  readAheadDelayMs: number;
}

export interface RecordingTransport {
  ready: boolean;
  playing: boolean;
  /** Playback speed; 1 is real time. */
  rate: number;
  setRate: (rate: number) => void;
  durationS: number;
  generation: number;
  lines: TimelineLine[];
  sounds: TimelineSound[];
  levels: Array<[number, number]>;
  /** Where the picture is, in seconds, updated every frame without a render. */
  positionRef: React.RefObject<number>;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (positionS: number) => void;
  /** Play only the captions from `startS` to `endS`, the picture held, then come back. */
  previewLine: (startS: number, endS: number) => void;
  /** True while `previewLine` runs: the picture and sound stay still. */
  previewing: boolean;
  /** Fetch the score again after the captions changed, and show the same moment. */
  reload: () => Promise<void>;
}

/** The studio plays an imported recording itself, so it can stand still and jump. */
export function useRecordingTransport(enabled: boolean, feed: StageFeed): RecordingTransport {
  const [score, setScore] = useState<Score | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const rateRef = useRef(1);
  const scoreRef = useRef<Score | null>(null);
  const feedRef = useRef(feed);
  const positionRef = useRef(0);
  const playingRef = useRef(false);
  const anchorRef = useRef({positionS: 0, atMs: 0});
  const nextRef = useRef(0);
  const startedRef = useRef(false);
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef<{timer: number; back: number} | null>(null);

  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);

  const delayS = () => Math.max(0, feedRef.current.readAheadDelayMs) / 1000;

  const show = useCallback((positionS: number, keepPlaying: boolean) => {
    const current = scoreRef.current;
    if (!current) return;
    const position = Math.min(Math.max(0, positionS), current.durationS);
    const acousticS = position + delayS();
    const stage = feedRef.current;
    const opening = current.events[0]?.[1];
    stage.restage(opening?.type === "restage" && Array.isArray(opening.speakers)
      ? opening.speakers.map(String)
      : current.speakers);
    stage.driveClock(acousticS * 1000, !keepPlaying);
    const batch = seekBatch(current.events, acousticS, SEEK_KEEP);
    for (const event of batch.events) stage.dispatch(event);
    if (batch.level) stage.showLevel(batch.level);
    stage.settle();
    nextRef.current = batch.next;
    positionRef.current = position;
    anchorRef.current = {positionS: position, atMs: performance.now()};
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/session/score");
    if (!response.ok) throw new Error(String(response.status));
    const next = await response.json() as Score;
    scoreRef.current = next;
    setScore(next);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) {
      scoreRef.current = null;
      startedRef.current = false;
      playingRef.current = false;
      return;
    }
    let cancelled = false;
    fetch("/session/score")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Score>;
      })
      .then((next) => {
        if (cancelled) return;
        scoreRef.current = next;
        setScore(next);
        if (startedRef.current) return;
        startedRef.current = true;
        playingRef.current = true;
        setPlaying(true);
        show(0, true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, show]);

  const cancelPreview = useCallback(() => {
    if (!previewRef.current) return;
    window.clearTimeout(previewRef.current.timer);
    previewRef.current = null;
    setPreviewing(false);
  }, []);

  const pause = useCallback(() => {
    cancelPreview();
    if (!playingRef.current) return;
    playingRef.current = false;
    setPlaying(false);
    feedRef.current.driveClock((positionRef.current + delayS()) * 1000, true);
  }, [cancelPreview]);

  const play = useCallback(() => {
    cancelPreview();
    const current = scoreRef.current;
    if (!current || playingRef.current) return;
    if (positionRef.current >= current.durationS - 0.05) show(0, true);
    playingRef.current = true;
    setPlaying(true);
    anchorRef.current = {positionS: positionRef.current, atMs: performance.now()};
    feedRef.current.driveClock((positionRef.current + delayS()) * 1000, false);
    feedRef.current.rebaseSchedule();
  }, [cancelPreview, show]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback((positionS: number) => {
    if (previewRef.current) {
      cancelPreview();
      playingRef.current = false;
      setPlaying(false);
    }
    show(positionS, playingRef.current);
  }, [cancelPreview, show]);

  const previewLine = useCallback((startS: number, endS: number) => {
    if (!scoreRef.current) return;
    const back = previewRef.current?.back ?? positionRef.current;
    if (previewRef.current) window.clearTimeout(previewRef.current.timer);
    const lead = PREVIEW_LEAD_S;
    setPreviewing(true);
    show(Math.max(0, startS - lead), true);
    playingRef.current = true;
    setPlaying(true);
    const timer = window.setTimeout(() => {
      previewRef.current = null;
      playingRef.current = false;
      setPlaying(false);
      show(back, false);
      setPreviewing(false);
    }, ((endS - startS + lead) / rateRef.current) * 1000);
    previewRef.current = {timer, back};
  }, [show]);

  useEffect(() => () => {
    if (previewRef.current) window.clearTimeout(previewRef.current.timer);
  }, []);

  const setRate = useCallback((next: number) => {
    rateRef.current = next;
    setRateState(next);
    if (startedRef.current) show(positionRef.current, playingRef.current);
  }, [show]);

  const reload = useCallback(async () => {
    await load();
    show(positionRef.current, playingRef.current);
  }, [load, show]);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const step = () => {
      frame = requestAnimationFrame(step);
      const current = scoreRef.current;
      if (!current || !startedRef.current) return;
      const stage = feedRef.current;
      if (!playingRef.current) {
        stage.driveClock((positionRef.current + delayS()) * 1000, true);
        return;
      }
      const now = performance.now();
      let position = anchorRef.current.positionS
        + ((now - anchorRef.current.atMs) / 1000) * rateRef.current;
      if (position >= current.durationS) {
        position = current.durationS;
        playingRef.current = false;
        setPlaying(false);
      }
      positionRef.current = position;
      const acousticS = position + delayS();
      stage.driveClock(acousticS * 1000, !playingRef.current);
      const due = dueBetween(current.events, nextRef.current, acousticS);
      for (const event of due.events) stage.dispatch(event);
      if (due.level) stage.showLevel(due.level);
      nextRef.current = due.next;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  const lines = useMemo(() => (score ? scoreLines(score.events) : []), [score]);
  const levels = useMemo(() => (score ? scoreLevels(score.events) : []), [score]);
  const sounds = useMemo(
    () => (score ? scoreSounds(score.events, score.durationS) : []), [score]);

  return {
    ready: Boolean(score) && enabled,
    playing,
    rate,
    setRate,
    durationS: score?.durationS ?? 0,
    generation: score?.generation ?? 0,
    lines,
    sounds,
    levels,
    positionRef,
    play,
    pause,
    toggle,
    seek,
    previewLine,
    previewing,
    reload,
  };
}
