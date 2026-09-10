/** Small ambient motion layered onto the rig's existing hair parameters. */
export const hairBreezeChannels = [
  {id:'ParamHairBackUpper', amplitude:.035, delay:0},
  {id:'ParamHairBackMid', amplitude:.14, delay:.30},
  {id:'ParamHairBackTip', amplitude:.28, delay:.68},
  {id:'ParamHairSideL', amplitude:.17, delay:.22},
  {id:'ParamHairSideR', amplitude:.15, delay:.47},
  {id:'ParamHairFront', amplitude:.055, delay:.10},
] as const;

/** Seconds advance only while the stage is playing and visible. */
export function hairBreezeAt(seconds:number, delay:number):number {
  const time=Math.max(0,seconds-delay);
  // Start gently after mount/reset. Two slow waves avoid a metronomic sway.
  const ramp=Math.min(time/2.4,1);
  const envelope=ramp*ramp*(3-2*ramp);
  return envelope*(Math.sin(time*.83)*.76+Math.sin(time*1.37)*.24);
}

/** Leave the physical response intact, using only its remaining headroom. */
export function addHairBreeze(physical:number, breeze:number):number {
  return physical+breeze*Math.max(0,1-Math.abs(physical));
}
