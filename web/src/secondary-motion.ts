import { DampedSpring } from './damped-spring';

/**
 * One deterministic ambient layer for the non-arm physics outputs.
 *
 * The native solver remains the owner of physical response.  This controller
 * only returns small additive offsets; the caller applies `addSecondaryMotion`
 * after physics so existing inertia and limits remain intact.  A zero `dt`
 * is a true hold, which lets a paused stage reuse the last output safely.
 */

export const secondaryMotionChannels=[
  {id:'ParamEarLPhysics',amplitude:.055,gustAmplitude:.16,phase:.11,delay:.08,frequency:.67,secondaryFrequency:1.03,secondaryWeight:.22,response:.42,impulseGain:.16},
  {id:'ParamEarRPhysics',amplitude:.052,gustAmplitude:.15,phase:.43,delay:.17,frequency:.73,secondaryFrequency:1.11,secondaryWeight:.2,response:.44,impulseGain:.16},
  {id:'ParamAhogeMid',amplitude:.07,gustAmplitude:.22,phase:.27,delay:.11,frequency:.59,secondaryFrequency:.91,secondaryWeight:.24,response:.48,impulseGain:.2},
  {id:'ParamAhogeTip',amplitude:.13,gustAmplitude:.38,phase:.61,delay:.27,frequency:.71,secondaryFrequency:1.18,secondaryWeight:.27,response:.82,impulseGain:.3},
  // Hair roots stay restrained while the tips receive the widest fan-out.
  {id:'ParamHairFront',amplitude:.08,gustAmplitude:.22,phase:.19,delay:.1,frequency:.79,secondaryFrequency:1.29,secondaryWeight:.2,response:.48,impulseGain:.18},
  {id:'ParamHairSideL',amplitude:.23,gustAmplitude:.58,phase:.34,delay:.2,frequency:.74,secondaryFrequency:1.22,secondaryWeight:.24,response:.7,impulseGain:.26},
  {id:'ParamHairBackUpper',amplitude:.045,gustAmplitude:.18,phase:.03,delay:.06,frequency:.63,secondaryFrequency:1.02,secondaryWeight:.2,response:.38,impulseGain:.15},
  {id:'ParamHairBackMid',amplitude:.2,gustAmplitude:.55,phase:.48,delay:.3,frequency:.69,secondaryFrequency:1.1,secondaryWeight:.25,response:.72,impulseGain:.25},
  {id:'ParamHairBackTip',amplitude:.36,gustAmplitude:.84,phase:.86,delay:.64,frequency:.77,secondaryFrequency:1.31,secondaryWeight:.28,response:.98,impulseGain:.36},
  {id:'ParamHairSideR',amplitude:.2,gustAmplitude:.54,phase:.72,delay:.45,frequency:.82,secondaryFrequency:1.27,secondaryWeight:.23,response:.68,impulseGain:.24},
  {id:'ParamRibbonHead',amplitude:.13,gustAmplitude:.38,phase:.58,delay:.22,frequency:.61,secondaryFrequency:1.05,secondaryWeight:.22,response:.58,impulseGain:.22},
  {id:'ParamChainHead',amplitude:.16,gustAmplitude:.46,phase:1.02,delay:.34,frequency:.68,secondaryFrequency:1.14,secondaryWeight:.25,response:.64,impulseGain:.25},
  {id:'ParamRibbonBody',amplitude:.18,gustAmplitude:.72,phase:.39,delay:.35,frequency:.57,secondaryFrequency:.96,secondaryWeight:.24,response:.82,impulseGain:.34},
  {id:'ParamChainBody',amplitude:.17,gustAmplitude:.62,phase:.91,delay:.5,frequency:.64,secondaryFrequency:1.08,secondaryWeight:.27,response:.78,impulseGain:.32},
  {id:'ParamClothSway',amplitude:.22,gustAmplitude:.95,phase:.07,delay:.13,frequency:.55,secondaryFrequency:.89,secondaryWeight:.25,response:.92,impulseGain:.42},
] as const;

export type SecondaryMotionChannel=typeof secondaryMotionChannels[number];
export type SecondaryMotionId=SecondaryMotionChannel['id'];
export type SecondaryMotionAdditives=Record<SecondaryMotionId,number>;

export interface SecondaryMotionVector {x?:number;y?:number;z?:number}

/** Presence parameters and optional articulated values used to seed a gust. */
export interface SecondaryMotionInput {
  ParamAngleX?:number;
  ParamAngleY?:number;
  ParamAngleZ?:number;
  ParamBodyAngleX?:number;
  ParamBodyAngleY?:number;
  ParamBodyAngleZ?:number;
  ParamBreath?:number;
  ParamShoulderLiftL?:number;
  ParamElbowCurlL?:number;
  ParamWristAngleL?:number;
  ParamShoulderLiftR?:number;
  ParamElbowCurlR?:number;
  ParamWristAngleR?:number;
  head?:SecondaryMotionVector;
  body?:SecondaryMotionVector;
  /** Optional signed impulse in [-1,1] supplied by a gesture owner. */
  impulse?:number;
  /** Optional unsigned articulated gesture strength in [0,1]. */
  gestureStrength?:number;
}

export interface SecondaryMotionOutput {
  /** Runtime-owned elapsed seconds; never advances when `update(0, ...)` runs. */
  clock:number;
  /** Signed normalized body/head impulse used for directional follow-through. */
  impulse:number;
  /** Unsigned articulated strength used to fan out long hair and cloth. */
  gestureStrength:number;
  /** Seconds since the current articulated impulse began; -1 when quiet. */
  gestureAge:number;
  additives:SecondaryMotionAdditives;
}

const MAX_DT=.1;
const RAMP_SECONDS=2.4;
const TWO_PI=Math.PI*2;
// Keep the ambient breeze visible without letting an additive layer become a
// second physics solver. Tips still receive more motion through their channel
// amplitudes and slower spring response, while roots remain quiet.
const AMBIENT_GAIN=.15;
const AMBIENT_LIMIT=.58;

const clamp=(value:number,low:number,high:number):number=>Math.max(low,Math.min(high,value));
const finite=(value:number,fallback=0):number=>Number.isFinite(value)?value:fallback;
const smoothStep=(value:number):number=>{
  const t=clamp(finite(value),0,1);
  return t*t*(3-2*t);
};
const approach=(current:number,target:number,rate:number,dt:number):number=>{
  const alpha=1-Math.exp(-rate*dt);
  return current+(target-current)*alpha;
};
const fallbackFinite=(primary:number|undefined,fallback:number|undefined):number=>finite(primary,finite(fallback));

const zeroAdditives=():SecondaryMotionAdditives=>{
  const result={} as SecondaryMotionAdditives;
  for(const channel of secondaryMotionChannels)result[channel.id]=0;
  return result;
};
const cloneAdditives=(source:SecondaryMotionAdditives):SecondaryMotionAdditives=>{
  const result={} as SecondaryMotionAdditives;
  for(const channel of secondaryMotionChannels)result[channel.id]=clamp(finite(source[channel.id]),-1,1);
  return result;
};
const cloneOutput=(source:SecondaryMotionOutput):SecondaryMotionOutput=>({
  clock:source.clock,
  impulse:source.impulse,
  gestureStrength:source.gestureStrength,
  gestureAge:source.gestureAge,
  additives:cloneAdditives(source.additives),
});

function deriveImpulse(input:SecondaryMotionInput|undefined):number {
  const source=input??{};
  const headX=fallbackFinite(source.head?.x,source.ParamAngleX)/30;
  const headY=fallbackFinite(source.head?.y,source.ParamAngleY)/28;
  const headZ=fallbackFinite(source.head?.z,source.ParamAngleZ)/9;
  const bodyX=fallbackFinite(source.body?.x,source.ParamBodyAngleX)/10;
  const bodyY=fallbackFinite(source.body?.y,source.ParamBodyAngleY)/10;
  const bodyZ=fallbackFinite(source.body?.z,source.ParamBodyAngleZ)/4;
  const breath=(finite(source.ParamBreath,.5)-.5)*2;
  const explicit=Number.isFinite(source.impulse)?source.impulse:0;
  return clamp(explicit+headX*.13+headY*.04+headZ*.12+bodyX*.38+bodyY*.08+bodyZ*.18+breath*.08,-1,1);
}

function deriveGestureStrength(input:SecondaryMotionInput|undefined):number {
  const source=input??{};
  const values=[
    source.ParamShoulderLiftL,source.ParamElbowCurlL,source.ParamWristAngleL,
    source.ParamShoulderLiftR,source.ParamElbowCurlR,source.ParamWristAngleR,
  ].map(value=>Math.abs(finite(value)));
  const articulated=Math.max(...values,0);
  return clamp(Math.max(articulated,finite(source.gestureStrength)),0,1);
}

/**
 * Apply an additive while preserving the native physical value's headroom.
 * Invalid values are neutralized and the final result is always in [-1,1].
 */
export function addSecondaryMotion(physical:number,additive:number):number {
  const base=clamp(finite(physical),-1,1);
  const offset=clamp(finite(additive),-1,1);
  return clamp(base+offset*Math.max(0,1-Math.abs(base)),-1,1);
}

/** Alias for callers that describe the layer as a secondary breeze. */
export const addSecondaryBreeze=addSecondaryMotion;

export class SecondaryMotionController {
  private elapsed=0;
  private impulse=0;
  private gestureStrength=0;
  private gestureAge=-1;
  private previousDrive:number|null=null;
  private previousJoints:number[]|null=null;
  private history:{time:number;drive:number;energy:number}[]=[];
  private springs=new Map<SecondaryMotionId,DampedSpring>();
  private output:SecondaryMotionOutput={clock:0,impulse:0,gestureStrength:0,gestureAge:-1,additives:zeroAdditives()};

  get clock():number { return this.elapsed; }

  reset():void {
    this.elapsed=0;
    this.impulse=0;
    this.gestureStrength=0;
    this.gestureAge=-1;
    this.previousDrive=null;
    this.previousJoints=null;
    this.history=[];
    this.springs.clear();
    this.output={clock:0,impulse:0,gestureStrength:0,gestureAge:-1,additives:zeroAdditives()};
  }

  update(dt:number,input:SecondaryMotionInput={}):SecondaryMotionOutput {
    const seconds=clamp(finite(dt),0,MAX_DT);
    // A paused stage must be able to pass its latest input without changing
    // either the clock or the returned sample.
    if(seconds===0)return cloneOutput(this.output);
    this.elapsed+=seconds;
    // Movement supplies energy. Holding a tilted head or a raised shoulder
    // must not continuously pump the hair like a fan.
    const drive=deriveImpulse(input);
    const speed=this.previousDrive===null?0:clamp((drive-this.previousDrive)/seconds,-2,2);
    this.previousDrive=drive;
    // A fast pointer supplies a short impulse, not a continuously saturated
    // target. The analytic channel springs retain the small recoil after the
    // pointer stops and then settle back toward the ambient layer.
    this.impulse=approach(this.impulse,clamp(-speed*.45,-.9,.9),10,seconds);
    const joints=[input.ParamShoulderLiftL,input.ParamShoulderLiftR,
      input.ParamElbowCurlL,input.ParamElbowCurlR].map(value=>finite(value));
    const jointSpeed=this.previousJoints===null?0:Math.max(...joints.map((value,index)=>
      Math.abs(value-this.previousJoints[index])/seconds));
    this.previousJoints=joints;
    const targetGesture=clamp(Math.abs(speed)*.35+jointSpeed*.18,0,1);
    const wasQuiet=this.gestureStrength<.035;
    this.gestureStrength=approach(this.gestureStrength,targetGesture,7.2,seconds);
    if(targetGesture>.08&&wasQuiet)this.gestureAge=0;
    else if(this.gestureAge>=0)this.gestureAge+=seconds;
    if(targetGesture<.02&&this.gestureStrength<.025)this.gestureAge=-1;

    this.history.push({time:this.elapsed,drive:this.impulse,energy:this.gestureStrength});
    while(this.history.length>2&&this.history[1].time<this.elapsed-1)this.history.shift();
    const delayed=(time:number):{drive:number;energy:number}=>{
      if(time<this.history[0].time)return {drive:0,energy:0};
      for(let i=1;i<this.history.length;i++){
        const a=this.history[i-1],b=this.history[i];
        if(b.time>=time){const t=clamp((time-a.time)/(b.time-a.time),0,1);
          return {drive:a.drive+(b.drive-a.drive)*t,energy:a.energy+(b.energy-a.energy)*t};}
      }
      return this.history[this.history.length-1];
    };
    const additives=zeroAdditives();
    const ramp=smoothStep(this.elapsed/RAMP_SECONDS);
    for(const channel of secondaryMotionChannels){
      const time=Math.max(0,this.elapsed-channel.delay);
      const envelope=time>0?ramp:0;
      const primary=Math.sin((time+channel.phase)*channel.frequency*TWO_PI);
      const secondary=Math.sin((time+channel.phase*1.7)*channel.secondaryFrequency*TWO_PI);
      const wave=primary*(1-channel.secondaryWeight)+secondary*channel.secondaryWeight;
      const delayedInput=delayed(this.elapsed-channel.delay*.45);
      let spring=this.springs.get(channel.id);
      if(!spring){spring=new DampedSpring();this.springs.set(channel.id,spring);}
      // Short roots react quickly; longer tips arrive later and settle with
      // one visible recoil. The native Cubism solver still runs underneath.
      const frequency=3-channel.response*1.35;
      const damping=.72-channel.response*.2;
      const inertia=spring.update(delayedInput.drive*channel.impulseGain*1.1,seconds,frequency,damping);
      const ambient=AMBIENT_GAIN*envelope*channel.amplitude*wave*channel.response;
      additives[channel.id]=clamp(ambient+inertia,-AMBIENT_LIMIT,AMBIENT_LIMIT);
    }
    this.output={clock:this.elapsed,impulse:this.impulse,gestureStrength:this.gestureStrength,gestureAge:this.gestureAge,additives};
    return cloneOutput(this.output);
  }
}

export const createSecondaryMotionController=():SecondaryMotionController=>new SecondaryMotionController();
