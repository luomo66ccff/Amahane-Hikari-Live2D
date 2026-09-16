// SPDX-License-Identifier: MIT
/** Bound long stalls without turning normal 15/30/60/120 FPS into slow motion. */
export const MAX_FRAME_DELTA_SECONDS = 0.1;
export const MAX_PHYSICS_STEP_SECONDS = 1 / 60;

/** A null baseline (first frame, resume or visibility change) advances no time. */
export function frameDeltaSeconds(nowMs:number, previousMs:number|null):number {
  if(previousMs===null||!Number.isFinite(nowMs)||!Number.isFinite(previousMs))return 0;
  return Math.max(0,Math.min((nowMs-previousMs)/1000,MAX_FRAME_DELTA_SECONDS));
}

/** Preserve the accepted elapsed time while bounding each native solver step. */
export function forEachPhysicsStep(dt:number, evaluate:(seconds:number)=>void):void {
  if(!Number.isFinite(dt)||dt<=0)return;
  const seconds=Math.min(dt,MAX_FRAME_DELTA_SECONDS);
  const count=Math.ceil(seconds/MAX_PHYSICS_STEP_SECONDS);
  const step=seconds/count;
  for(let i=0;i<count;i++)evaluate(step);
}
