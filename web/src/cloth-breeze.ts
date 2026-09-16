/** Small ambient motion layered onto the rig's existing cloth parameters. */
export const clothBreezeChannels = [
  {id:'ParamClothSway', amplitude:.20, delay:0},
  {id:'ParamRibbonBody', amplitude:.14, delay:.36},
] as const;

/**
 * Return a deterministic wind sample for a runtime-owned clock.
 *
 * The clock is deliberately supplied by the caller: a reset sets it back to
 * zero and a paused runtime can hold it still. Invalid inputs are treated as
 * a neutral sample so one bad frame cannot poison the model parameters.
 */
export function clothBreezeAt(seconds:number, delay:number):number {
  if(!Number.isFinite(seconds)||!Number.isFinite(delay))return 0;
  const time=Math.max(0,Math.max(0,seconds)-Math.max(0,delay));
  // Start gently after mount/reset. The two slow waves keep the cloth from
  // moving as a metronome while staying well below one cycle per second.
  const ramp=Math.min(time/2.4,1);
  const envelope=ramp*ramp*(3-2*ramp);
  return envelope*(Math.sin(time*.63)*.76+Math.sin(time*1.03)*.24);
}

/** Leave the physical response intact, using only its remaining headroom. */
export function addClothBreeze(physical:number,breeze:number):number {
  const base=Number.isFinite(physical)?Math.max(-1,Math.min(1,physical)):0;
  const offset=Number.isFinite(breeze)?breeze:0;
  const value=base+offset*Math.max(0,1-Math.abs(base));
  return Math.max(-1,Math.min(1,value));
}
