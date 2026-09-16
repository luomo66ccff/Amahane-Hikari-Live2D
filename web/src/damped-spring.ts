/**
 * Stable scalar damped spring integration.
 *
 * The state is advanced with the closed-form solution of a second-order
 * spring.  This keeps a fixed target trajectory independent of whether the
 * caller renders at 30, 60, or 120 fps, and avoids the frame-rate sensitivity
 * and occasional explosion of explicit Euler integration.
 */

const TWO_PI=Math.PI*2;
const MAX_DT=.1;
const DEFAULT_FREQUENCY_HZ=4;
const DEFAULT_DAMPING_RATIO=.72;
const MIN_FREQUENCY_HZ=.05;
const MAX_FREQUENCY_HZ=24;
const MIN_DAMPING_RATIO=.05;
const MAX_DAMPING_RATIO=4;
const EPSILON=1e-6;

const finite=(value:number,fallback:number):number=>Number.isFinite(value)?value:fallback;
const clamp=(value:number,low:number,high:number):number=>Math.max(low,Math.min(high,value));

const safeDt=(dt:number):number=>{
  if(!Number.isFinite(dt)||dt<=0)return 0;
  return Math.min(dt,MAX_DT);
};

/**
 * One-dimensional damped spring state.
 *
 * `frequencyHz` is the undamped natural frequency in cycles per second and
 * `dampingRatio` is the conventional dimensionless ratio. Values below one
 * are underdamped and produce a controlled overshoot; one is critical;
 * values above one are overdamped. Invalid options fall back to conservative
 * defaults, while the result remains finite and bounded for finite targets.
 */
export class DampedSpring {
  public value:number;
  public velocity:number;

  constructor(value=0){
    this.value=finite(value,0);
    this.velocity=0;
  }

  /** Reset position and clear momentum. */
  reset(value=0):void {
    this.value=finite(value,0);
    this.velocity=0;
  }

  /**
   * Advance toward `target` by a bounded amount of time.
   *
   * Zero, negative, NaN, and infinite `dt` values are a true hold. A finite
   * interval above the render guard is capped so a delayed tab cannot inject
   * an unstable jump. The current sample is always returned for convenient
   * composition in a renderer-independent controller.
   */
  update(target:number,dt:number,frequencyHz=DEFAULT_FREQUENCY_HZ,dampingRatio=DEFAULT_DAMPING_RATIO):number {
    const seconds=safeDt(dt);
    if(seconds===0)return this.value;

    const goal=finite(target,this.value);
    const hz=clamp(finite(frequencyHz,DEFAULT_FREQUENCY_HZ),MIN_FREQUENCY_HZ,MAX_FREQUENCY_HZ);
    const ratio=clamp(finite(dampingRatio,DEFAULT_DAMPING_RATIO),MIN_DAMPING_RATIO,MAX_DAMPING_RATIO);
    const omega=TWO_PI*hz;
    const displacement=this.value-goal;
    const initialVelocity=finite(this.velocity,0);

    let nextDisplacement:number;
    let nextVelocity:number;
    if(ratio<1-EPSILON){
      // Underdamped closed form:
      // y(t)=e^(-a t)[y0 cos(wd t)+(v0+a y0)/wd sin(wd t)].
      const decay=ratio*omega;
      const dampedFrequency=omega*Math.sqrt(Math.max(0,1-ratio*ratio));
      const angle=dampedFrequency*seconds;
      const envelope=Math.exp(-decay*seconds);
      const cosine=Math.cos(angle);
      const sine=Math.sin(angle);
      const sineCoefficient=(initialVelocity+decay*displacement)/dampedFrequency;
      nextDisplacement=envelope*(displacement*cosine+sineCoefficient*sine);
      nextVelocity=envelope*(
        initialVelocity*cosine
          -((decay*initialVelocity+omega*omega*displacement)/dampedFrequency)*sine
      );
    }else if(Math.abs(ratio-1)<=EPSILON){
      // Critically damped closed form.
      const envelope=Math.exp(-omega*seconds);
      const weighted=initialVelocity+omega*displacement;
      nextDisplacement=envelope*(displacement+weighted*seconds);
      nextVelocity=envelope*(initialVelocity-omega*weighted*seconds);
    }else{
      // Overdamped closed form using the two real negative roots.
      const root=Math.sqrt(Math.max(0,ratio*ratio-1));
      const rootFast=-omega*(ratio+root);
      const rootSlow=-omega*(ratio-root);
      const denominator=rootFast-rootSlow;
      const fastCoefficient=(initialVelocity-rootSlow*displacement)/denominator;
      const slowCoefficient=displacement-fastCoefficient;
      const fast=Math.exp(rootFast*seconds);
      const slow=Math.exp(rootSlow*seconds);
      nextDisplacement=fastCoefficient*fast+slowCoefficient*slow;
      nextVelocity=fastCoefficient*rootFast*fast+slowCoefficient*rootSlow*slow;
    }

    this.value=finite(goal+nextDisplacement,goal);
    this.velocity=finite(nextVelocity,0);
    return this.value;
  }
}

export default DampedSpring;
