/** KEEPING AN IMPORTED RECORDING ON THE CAPTION PLAYHEAD.

    The server reads the file's audio against a source clock that starts at
    zero, and the captions present from a playhead that runs a fixed delay
    behind it. The browser plays its OWN copy of the picture, so that copy has
    to sit on the playhead, not on the wall clock: a word turns colour at its
    onset on the playhead, and that is the frame in which it must be heard.

    The player runs on its own clock between corrections. Both clocks are real
    time, so a correction is only a seek when the two have actually parted --
    seeking on every tick would stutter the picture to fix an error nobody can
    see. */

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

/** A quarter of a second is past where lip sync reads as wrong, and well
   above the jitter of a 66 ms playhead tick. */
export const MEDIA_SYNC_TOLERANCE_S = 0.25;

/** Inside this the player is in step and runs at exactly 1x. */
export const MEDIA_SYNC_DEADBAND_S = 0.03;

/** The most the rate may lean to close a small gap. A player starts ~150 ms
   behind the position it was given (measured: median -144 ms, never corrected,
   because that is inside the seek tolerance). A seek to fix it would stutter;
   5% is under where speech sounds altered and closes 150 ms in three seconds. */
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
  // Past the end the playhead keeps running and the recording does not. A seek
  // there would restart a finished player on its last frame, forever.
  if (ended || (Number.isFinite(durationS) && target >= durationS)) {
    return {kind: "none"};
  }
  if (paused) return {kind: "play", atS: target};
  const error = currentTimeS - target;
  if (Math.abs(error) > toleranceS) return {kind: "seek", atS: target};
  if (Math.abs(error) <= MEDIA_SYNC_DEADBAND_S) return {kind: "trim", rate: 1};
  // Proportional, so the lean eases off as the gap closes instead of
  // overshooting and hunting around zero.
  const lean = Math.max(-MEDIA_SYNC_MAX_TRIM,
    Math.min(MEDIA_SYNC_MAX_TRIM, -error * 0.5));
  return {kind: "trim", rate: 1 + lean};
}
