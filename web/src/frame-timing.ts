// SPDX-License-Identifier: MIT
/** Bound catch-up work without slowing ordinary low-frame-rate animation. */
export const MAX_FRAME_SECONDS = 0.25;
export const MAX_SIMULATION_STEP_SECONDS = 1 / 30;

export type FrameTiming = Readonly<{
  elapsedSeconds: number;
  stepSeconds: number;
  stepCount: number;
}>;

/**
 * The first frame (also after pause/visibility/reset) samples without advancing.
 * Timestamp zero is valid; null, not a truthiness check, marks an unset clock.
 * Long stalls discard time beyond 250 ms to avoid unbounded catch-up work.
 * Every controller and the physics solver consume the same bounded substeps;
 * the caller presents/draws once, after all substeps have completed.
 */
export function getFrameTiming(
  timeMs: number,
  previousTimeMs: number | null,
  paused = false,
): FrameTiming {
  let elapsedSeconds = 0;
  if (!paused && previousTimeMs !== null && Number.isFinite(timeMs)
    && Number.isFinite(previousTimeMs) && timeMs >= 0 && previousTimeMs >= 0) {
    elapsedSeconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (timeMs - previousTimeMs) / 1000));
  }
  // Still run one zero-time sample while paused so outfit/debug writes apply.
  const stepCount = Math.max(1, Math.ceil(elapsedSeconds / MAX_SIMULATION_STEP_SECONDS));
  return { elapsedSeconds, stepSeconds: elapsedSeconds / stepCount, stepCount };
}
