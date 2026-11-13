/** KEEPING AN IMPORTED RECORDING ON THE CAPTION PLAYHEAD. */

export interface MediaSyncInput {
  /** The caption playhead, in ms on the source timeline. */
  playheadMs: number;
  /** The player's `currentTime`, in seconds. */
  currentTimeS: number;
  paused: boolean;
  ended: boolean;
  /** The player's `duration`; NaN until metadata has loaded. */
  durationS: number;
  /** How far the player may sit from the playhead before it is moved. */
  toleranceS?: number;
}

export type MediaSyncAction =
  /** The playhead has not reached the recording: wait on its first frame. */
  | {kind: "hold"}
  /** Start (or restart) playback from this position. */
  | {kind: "play"; atS: number}
  /** Playing, but parted from the playhead: move without pausing. */
  | {kind: "seek"; atS: number}
  /** Close enough not to seek: run at this rate to close the rest. */
  | {kind: "trim"; rate: number}
  /** Finished: leave the player alone. */
  | {kind: "none"};

/** A quarter of a second is past where lip sync reads as wrong, and well above the jitter of a 66 ms playhead tick. */
export const MEDIA_SYNC_TOLERANCE_S = 0.25;

/** Inside this the player is in step and runs at exactly 1x. */
export const MEDIA_SYNC_DEADBAND_S = 0.03;

/** The most the rate may lean to close a small gap. */
export const MEDIA_SYNC_MAX_TRIM = 0.05;

export function mediaSyncAction({
  playheadMs,
  currentTimeS,
  paused,
  ended,
  durationS,
  toleranceS = MEDIA_SYNC_TOLERANCE_S,
}: MediaSyncInput): MediaSyncAction {
  if (!Number.isFinite(playheadMs) || playheadMs < 0) return {kind: "hold"};
  const target = playheadMs / 1000;
  if (ended || (Number.isFinite(durationS) && target >= durationS)) {
    return {kind: "none"};
  }
  if (paused) return {kind: "play", atS: target};
  const error = currentTimeS - target;
  if (Math.abs(error) > toleranceS) return {kind: "seek", atS: target};
  if (Math.abs(error) <= MEDIA_SYNC_DEADBAND_S) return {kind: "trim", rate: 1};
  const lean = Math.max(-MEDIA_SYNC_MAX_TRIM,
    Math.min(MEDIA_SYNC_MAX_TRIM, -error * 0.5));
  return {kind: "trim", rate: 1 + lean};
}
