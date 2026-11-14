import type {CaptionEvent} from "@/lib/caption-store";

declare global {
  interface Window {
    /** Set by the renderer's page script: this page draws a recording to video, so it does not play it itself. */
    __weaveRendering?: boolean;
    __cwiStudio?: {
      dispatch: (event: CaptionEvent, eventId?: number) => void;
      report: () => {
        connection: string;
        words: number;
        visible: number;
        clockStarted: boolean;
        readAheadDelayMs: number;
        readAheadMs: number;
        minReadAheadMs: number;
        aheadWords: number;
        activeMotions: number;
        scheduledWords: number;
        lateWords: number;
        rearmedWords: number;
        frozenTextRevisions: number;
        frozenSpeakerRevisions: number;
        playheadMs: number | null;
        newestAcousticMs: number | null;
        clockEpoch: number;
        reducedMotion: boolean;
        directionKnown: boolean;
      };
    };
  }
}

export {};
