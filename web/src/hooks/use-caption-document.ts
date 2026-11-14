"use client";

import {useCallback, useEffect, useState} from "react";
import {
  firstChange,
  playWindow,
  type CaptionDocument,
  type EditWord,
} from "@/lib/caption-edit";

const CAPTIONS_URL = "/session/captions";
const HISTORY_LIMIT = 50;

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

export interface CaptionSpan {
  startS: number;
  endS: number;
  /** Take the picture to the change when it is out of sight. */
  follow: boolean;
}

export interface CaptionDocumentState {
  doc: CaptionDocument | null;
  error: string | null;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Apply `words`; `focus` is the word whose line changed. */
  commit: (words: EditWord[], focus: number, follow?: boolean) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  revert: () => Promise<void>;
}

/** A recording's captions as a person adjusts them, shared by the editor and the timeline. */
export function useCaptionDocument(
  enabled: boolean,
  changed: (span: CaptionSpan) => void,
): CaptionDocumentState {
  const [doc, setDoc] = useState<CaptionDocument | null>(null);
  const [past, setPast] = useState<EditWord[][]>([]);
  const [future, setFuture] = useState<EditWord[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

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
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change was refused.");
      setDoc(await request().catch(() => before));
      return null;
    } finally {
      setBusy(false);
    }
  }, [doc]);

  const announce = useCallback((words: EditWord[], focus: number, follow: boolean) => {
    const window = playWindow(words, focus);
    if (window) changed({startS: window.from, endS: window.until, follow});
  }, [changed]);

  const commit = useCallback(async (words: EditWord[], focus: number, follow = true) => {
    if (!doc) return false;
    const before = doc.words;
    const next = await run({action: "adjust", words}, words);
    if (!next) return false;
    setPast((history) => [...history.slice(1 - HISTORY_LIMIT), before]);
    setFuture([]);
    announce(next.words, focus, follow);
    return true;
  }, [announce, doc, run]);

  const step = useCallback(async (
    from: EditWord[][],
    setFrom: (update: (history: EditWord[][]) => EditWord[][]) => void,
    setTo: (update: (history: EditWord[][]) => EditWord[][]) => void,
  ) => {
    const target = from.at(-1);
    if (!target || !doc) return;
    const before = doc.words;
    const focus = firstChange(before, target);
    const next = await run({action: "adjust", words: target}, target);
    if (!next) return;
    setFrom((history) => history.slice(0, -1));
    setTo((history) => [...history.slice(1 - HISTORY_LIMIT), before]);
    announce(next.words, focus, true);
  }, [announce, doc, run]);

  const undo = useCallback(() => step(past, setPast, setFuture), [past, step]);
  const redo = useCallback(() => step(future, setFuture, setPast), [future, step]);

  const revert = useCallback(async () => {
    if (!doc) return;
    const before = doc.words;
    const next = await run({action: "revert"});
    if (!next) return;
    setPast((history) => [...history.slice(1 - HISTORY_LIMIT), before]);
    setFuture([]);
    announce(next.words, 0, true);
  }, [announce, doc, run]);

  return {
    doc,
    error,
    busy,
    canUndo: past.length > 0 && !busy,
    canRedo: future.length > 0 && !busy,
    commit,
    undo,
    redo,
    revert,
  };
}
