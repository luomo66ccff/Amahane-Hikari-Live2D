/**
 * Deterministic, renderer-independent presence motion for the Hikari model.
 *
 * Call `update(dt, input)` once per rendered frame.  `dt` is the elapsed time
 * supplied by the caller; a paused or hidden caller should pass no updates.
 * The legacy whole-arm values are additive and are intended to be applied
 * after physics; articulated values are direct parameter targets.  This module
 * never touches the DOM, model geometry, or global time.
 */

import { DampedSpring } from './damped-spring';

export type NormalizedPointer = {x:number;y:number};
export type PresenceOutfit = 0 | 1 | 2;

export interface PresenceInput {
  /** Normalized pointer coordinates, normally in the range [-1, 1]. */
  pointer:NormalizedPointer;
  /** Whether the pointer is currently a usable user target. */
  pointerActive:boolean;
  /** Whether pointer following is enabled by the caller. */
  followEnabled:boolean;
  /** Current outfit, used to gate outfit-specific hand articulation. */
  outfit?:PresenceOutfit;
}

export interface PresenceParameters {
  ParamEyeBallX:number;
  ParamEyeBallY:number;
  ParamAngleX:number;
  ParamAngleY:number;
  ParamAngleZ:number;
  ParamBodyAngleX:number;
  ParamBodyAngleY:number;
  ParamBodyAngleZ:number;
  ParamBreath:number;
  /** Direct preparation controls for the full-body authored rig. */
  ParamTorsoSway:number;
  ParamPelvisSway:number;
  ParamThighShiftL:number;
  ParamThighShiftR:number;
  /** Native local shoulder/neck compression; neutral is exactly zero. */
  ParamShoulderCompress:number;
}

/** Independent shoulder, elbow, and wrist controls for the authored arm mesh. */
export interface ArticulatedArmParameters {
  ParamShoulderLiftL:number;
  ParamElbowCurlL:number;
  ParamWristAngleL:number;
  ParamShoulderLiftR:number;
  ParamElbowCurlR:number;
  ParamWristAngleR:number;
  /** Right swim hand pose: 0 relaxed, 1 open palm. */
  ParamHandPoseR:number;
}

/**
 * A short, renderer-applied cue owned by an automatic broad gesture.
 *
 * Keeping this separate from `parameters` is deliberate: expression motion
 * is applied by the runtime after presence parameters, while the cue must be
 * layered only when the selected expression is the initial Neutral state.
 */
export interface AutonomousCue {
  active:boolean;
  mouthForm:number;
  gazeX:number;
}

export interface PresenceOutput {
  parameters:PresenceParameters;
  /** Add these after the model's physics output to ParamArmSwayL/R. */
  leftArmAdditive:number;
  rightArmAdditive:number;
  /** Direct values for the six independently rigged arm parameters. */
  articulated:ArticulatedArmParameters;
  /** Temporary face cue for scheduled gestures; manual greetings stay zero. */
  autonomousCue:AutonomousCue;
}

/** Conservative limits for the parameters this controller writes. */
export const PRESENCE_LIMITS = {
  ParamEyeBallX:.95,
  ParamEyeBallY:.90,
  ParamAngleX:30,
  ParamAngleY:28,
  ParamAngleZ:9,
  ParamBodyAngleX:10,
  ParamBodyAngleY:10,
  ParamBodyAngleZ:4,
  ParamBreath:{min:.16,max:.84},
  // These four channels are authored full-body controls.  They deliberately
  // use the same normalized [-1, 1] contract as the exported model rig.
  ParamTorsoSway:1,
  ParamPelvisSway:1,
  ParamThighShiftL:1,
  ParamThighShiftR:1,
  ParamShoulderCompress:1,
  // The old whole-arm channel is a quiet follow-through only. Keep its
  // authored waveform below the final runtime envelope instead of relying on
  // a large gesture followed by clipping.
  armAdditive:.012,
} as const;

/** Public arm output envelopes. Elbow, wrist, and hand pose stay neutral. */
export const ARTICULATED_LIMITS = {
  ParamShoulderLiftL:.035,
  ParamElbowCurlL:0,
  ParamWristAngleL:0,
  ParamShoulderLiftR:.035,
  ParamElbowCurlR:0,
  ParamWristAngleR:0,
  ParamHandPoseR:0,
} as const;

const DEFAULT_SEED = 0x51f15e9d;
const TWO_PI = Math.PI*2;
const MAX_DT = .1;
const IDLE_RADIUS_MIN = .08;
const IDLE_RADIUS_MAX = .24;
// Broad, readable gestures: the shoulder leads, the elbow follows, and the
// wrist arrives last.  A short hold keeps the action conversational rather
// than turning it into a static pose.
const GESTURE_ANTICIPATION=.28;
const GESTURE_TRAVEL=.84;
const GESTURE_HOLD=.36;
const GESTURE_SETTLE=1.22;
// The open-palm channel is a small hand pose, not a second arm travel.  It
// should switch decisively while the forearm is moving instead of spending
// most of the travel interval in a visibly mixed pose.
const HAND_POSE_TRANSITION=.18;
const HAND_POSE_TRAVEL_LAG=.24;
const HAND_POSE_SETTLE_LAG=.16;
// The body keeps the planted-weight pose a little longer than the hands.  This
// gives the support leg time to read while the wrist returns softly.
const POSTURE_TRAVEL=.72;
const POSTURE_HOLD=.76;
const POSTURE_SETTLE=1.62;
const GESTURE_TOTAL=Math.max(
  GESTURE_ANTICIPATION+GESTURE_TRAVEL+GESTURE_HOLD+GESTURE_SETTLE,
  GESTURE_ANTICIPATION+POSTURE_TRAVEL+POSTURE_HOLD+POSTURE_SETTLE,
);
const STANCE_INTERVAL_MIN=11;
const STANCE_INTERVAL_MAX=17;
const STANCE_IN_MIN=1.2;
const STANCE_IN_MAX=2;
const STANCE_HOLD_MIN=.8;
const STANCE_HOLD_MAX=1.5;
const STANCE_OUT_MIN=1.8;
const STANCE_OUT_MAX=2.6;
const BASE_RELEASE_DURATION=.18;
// The face cue is intentionally shorter than the broad arm pose.  It rises
// during anticipation, holds through the first part of travel, and has
// already returned to neutral before the authored pose reaches its hold.
const AUTONOMOUS_CUE_PEAK=.26;
const AUTONOMOUS_CUE_RISE=.18;
const AUTONOMOUS_CUE_FALL_START=GESTURE_ANTICIPATION+GESTURE_TRAVEL*.52;
const AUTONOMOUS_CUE_FALL=.36;
const AUTONOMOUS_CUE_GAZE=.085;
// Neutral microexpressions are brief, sparse invitations to notice the face.
// Their peak is deliberately far below the manual greeting cue; the runtime
// still owns the explicit-expression priority gate.
const MICRO_EXPRESSION_PEAK=.055;
const MICRO_EXPRESSION_DURATION_MIN=.72;
const MICRO_EXPRESSION_DURATION_MAX=1.08;
const MICRO_EXPRESSION_INTERVAL_MIN=10;
const MICRO_EXPRESSION_INTERVAL_MAX=16;
// Main attention is still eye -> head -> body, but the latter two stages use
// a lightly underdamped response so a pointer stop has a readable, brief
// follow-through. Frequencies are in Hz; the spring itself is frame-rate
// independent and the final parameter caps below remain the rig boundary.
const HEAD_SPRING_FREQUENCY=3.6;
const BODY_SPRING_FREQUENCY=1.95;
const HEAD_SPRING_DAMPING=.7;
const BODY_SPRING_DAMPING=.78;
// Every outfit now shares one quiet whole-arm sway. This is the authored
// output envelope; the renderer repeats the same guard after physics and
// expressions so a wardrobe or solver layer cannot reintroduce a large pose.
const GENTLE_SHOULDER_LIMIT=.035;

type ArticulatedKey=keyof ArticulatedArmParameters;
const ARTICULATED_KEYS:readonly ArticulatedKey[]=[
  'ParamShoulderLiftL','ParamElbowCurlL','ParamWristAngleL',
  'ParamShoulderLiftR','ParamElbowCurlR','ParamWristAngleR',
  'ParamHandPoseR',
];
const ARM_ARTICULATED_KEYS:readonly ArticulatedKey[]=ARTICULATED_KEYS.filter(key=>key!=='ParamHandPoseR');

const IDLE_ARM_AMPLITUDE:Record<ArticulatedKey,number>={
  ParamShoulderLiftL:.026,ParamElbowCurlL:0,ParamWristAngleL:0,
  ParamShoulderLiftR:.030,ParamElbowCurlR:0,ParamWristAngleR:0,
  ParamHandPoseR:0,
};
const IDLE_ARM_FREQUENCY:Record<ArticulatedKey,number>={
  ParamShoulderLiftL:.105,ParamElbowCurlL:0,ParamWristAngleL:0,
  ParamShoulderLiftR:.115,ParamElbowCurlR:0,ParamWristAngleR:0,
  ParamHandPoseR:0,
};

type ArticulatedPose=Readonly<ArticulatedArmParameters>;
type Leg='L'|'R';
type PosturePose={torso:number;pelvis:number;thighSupport:number;thighFree:number};
type GestureVariant={
  name:'right_invite'|'left_gentle';
  anticipation:ArticulatedPose;
  target:ArticulatedPose;
  overshoot:ArticulatedPose;
  /** Explicit authored direction/support metadata; never inferred from arms. */
  direction:1|-1;
  dominantArm:Leg;
  supportLeg:Leg;
  posture:'balanced'|'asymmetric';
  bodyPosture:PosturePose;
  anticipationFactor:number;
};

const zeroArticulated=():ArticulatedArmParameters=>({
  ParamShoulderLiftL:0,ParamElbowCurlL:0,ParamWristAngleL:0,
  ParamShoulderLiftR:0,ParamElbowCurlR:0,ParamWristAngleR:0,
  ParamHandPoseR:0,
});
const zeroAutonomousCue=():AutonomousCue=>({active:false,mouthForm:0,gazeX:0});
const zeroPosture=():PosturePose=>({torso:0,pelvis:0,thighSupport:0,thighFree:0});
const copyPosture=(value:PosturePose):PosturePose=>({
  torso:finite(value.torso),
  pelvis:finite(value.pelvis),
  thighSupport:finite(value.thighSupport),
  thighFree:finite(value.thighFree),
});
const blendPosture=(from:PosturePose,to:PosturePose,amount:number):PosturePose=>{
  const t=clamp(finite(amount),0,1);
  return {
    torso:from.torso+(to.torso-from.torso)*t,
    pelvis:from.pelvis+(to.pelvis-from.pelvis)*t,
    thighSupport:from.thighSupport+(to.thighSupport-from.thighSupport)*t,
    thighFree:from.thighFree+(to.thighFree-from.thighFree)*t,
  };
};
const scalePosture=(value:PosturePose,scale:number):PosturePose=>({
  torso:value.torso*scale,
  pelvis:value.pelvis*scale,
  thighSupport:value.thighSupport*scale,
  thighFree:value.thighFree*scale,
});

// Two deliberate broad pose families.  Each has one dominant arm and a small
// companion response, so a greeting reads as an invitation or a gentle wave
// instead of two arms moving as a rigid pair. Positive shoulder/elbow values
// are the authored lift/curl direction; the native model supplies the final
// calibrated sign and degree ranges.
const PLAYFUL_VARIANTS:readonly GestureVariant[]=[
  {
    name:'right_invite',
    anticipation:{ParamShoulderLiftL:-.04,ParamElbowCurlL:-.07,ParamWristAngleL:.03,ParamShoulderLiftR:-.08,ParamElbowCurlR:-.1,ParamWristAngleR:-.04,ParamHandPoseR:0},
    target:{ParamShoulderLiftL:.16,ParamElbowCurlL:.12,ParamWristAngleL:-.08,ParamShoulderLiftR:.84,ParamElbowCurlR:.78,ParamWristAngleR:.22,ParamHandPoseR:1},
    overshoot:{ParamShoulderLiftL:.012,ParamElbowCurlL:.016,ParamWristAngleL:-.01,ParamShoulderLiftR:.028,ParamElbowCurlR:.036,ParamWristAngleR:.03,ParamHandPoseR:0},
    direction:1,
    dominantArm:'R',
    supportLeg:'R',
    posture:'asymmetric',
    bodyPosture:{torso:.56,pelvis:-.33,thighSupport:.42,thighFree:-.12},
    anticipationFactor:.18,
  },
  {
    name:'left_gentle',
    anticipation:{ParamShoulderLiftL:-.08,ParamElbowCurlL:-.1,ParamWristAngleL:.04,ParamShoulderLiftR:-.04,ParamElbowCurlR:-.06,ParamWristAngleR:-.03,ParamHandPoseR:0},
    target:{ParamShoulderLiftL:.82,ParamElbowCurlL:.76,ParamWristAngleL:-.18,ParamShoulderLiftR:.14,ParamElbowCurlR:.12,ParamWristAngleR:.08,ParamHandPoseR:0},
    overshoot:{ParamShoulderLiftL:.026,ParamElbowCurlL:.034,ParamWristAngleL:-.026,ParamShoulderLiftR:.012,ParamElbowCurlR:.016,ParamWristAngleR:.01,ParamHandPoseR:0},
    direction:-1,
    dominantArm:'L',
    supportLeg:'L',
    posture:'asymmetric',
    bodyPosture:{torso:-.52,pelvis:.31,thighSupport:-.38,thighFree:.1},
    anticipationFactor:.2,
  },
];

type XY = {x:number;y:number};
type XYZ = {x:number;y:number;z:number};

const clamp=(value:number,low:number,high:number):number=>Math.max(low,Math.min(high,value));
const finite=(value:number,fallback=0):number=>Number.isFinite(value)?value:fallback;
const approach=(current:number,target:number,rate:number,dt:number):number=>{
  const alpha=1-Math.exp(-rate*dt);
  return current+(target-current)*alpha;
};
const smoothPulse=(time:number,delay:number,duration:number):number=>{
  const progress=(time-delay)/duration;
  if(progress<=0||progress>=1)return 0;
  const sine=Math.sin(Math.PI*progress);
  return sine*sine;
};
/**
 * One automatic nod/tilt impulse: a short reverse preparation, one eased
 * travel to the authored peak, a small single overshoot, and a monotonic
 * return to rest. Random duration and overshoot are selected per event so
 * the idle rhythm never becomes a metronome.
 */
const nodEnvelope=(time:number,duration:number,anticipationSeconds:number,overshoot:number):number=>{
  const total=Math.max(.05,finite(duration,.9));
  const anticipationDuration=clamp(finite(anticipationSeconds,.16),.04,total*.3);
  const peakTime=Math.max(anticipationDuration+.08,total*.46);
  const overshootTime=Math.min(total-.04,peakTime+Math.max(.06,total*.12));
  const preparation=-.16;
  if(time<=0)return 0;
  if(time<anticipationDuration)return preparation*smoothStep(time/anticipationDuration);
  if(time<peakTime){
    return preparation+(1-preparation)*smoothStep(
      (time-anticipationDuration)/(peakTime-anticipationDuration),
    );
  }
  if(time<overshootTime)return 1+finite(overshoot,.1)*smoothStep(
    (time-peakTime)/(overshootTime-peakTime),
  );
  if(time<total)return (1+finite(overshoot,.1))*
    (1-smoothStep((time-overshootTime)/(total-overshootTime)));
  return 0;
};
const smoothStep=(progress:number):number=>{
  const t=clamp(finite(progress),0,1);
  return t*t*(3-2*t);
};
const autonomousSmileAt=(time:number):number=>{
  if(time<=0)return 0;
  if(time<AUTONOMOUS_CUE_RISE)return AUTONOMOUS_CUE_PEAK*smoothStep(time/AUTONOMOUS_CUE_RISE);
  if(time<=AUTONOMOUS_CUE_FALL_START)return AUTONOMOUS_CUE_PEAK;
  const fallProgress=(time-AUTONOMOUS_CUE_FALL_START)/AUTONOMOUS_CUE_FALL;
  if(fallProgress<1)return AUTONOMOUS_CUE_PEAK*(1-smoothStep(fallProgress));
  return 0;
};
const microExpressionAt=(time:number,duration:number):number=>{
  if(time<=0||time>=duration)return 0;
  return MICRO_EXPRESSION_PEAK*smoothPulse(time,0,duration);
};
const copyArticulated=(value:ArticulatedPose):ArticulatedArmParameters=>({
  ParamShoulderLiftL:clamp(finite(value.ParamShoulderLiftL),-1,1),
  ParamElbowCurlL:clamp(finite(value.ParamElbowCurlL),-1,1),
  ParamWristAngleL:clamp(finite(value.ParamWristAngleL),-1,1),
  ParamShoulderLiftR:clamp(finite(value.ParamShoulderLiftR),-1,1),
  ParamElbowCurlR:clamp(finite(value.ParamElbowCurlR),-1,1),
  ParamWristAngleR:clamp(finite(value.ParamWristAngleR),-1,1),
  ParamHandPoseR:clamp(finite(value.ParamHandPoseR),0,1),
});
const blendArticulated=(from:ArticulatedPose,to:ArticulatedPose,amount:number):ArticulatedArmParameters=>{
  const t=clamp(finite(amount),0,1),result=zeroArticulated();
  for(const key of ARTICULATED_KEYS)result[key]=from[key]+(to[key]-from[key])*t;
  return copyArticulated(result);
};

function normalizedSeed(value:number):number {
  if(!Number.isFinite(value))return DEFAULT_SEED;
  return Math.trunc(value)>>>0;
}

/**
 * Stateful presence driver.  The small integer generator is local to this
 * instance, so two controllers with the same seed and updates are identical.
 */
export class PresenceController {
  private shoulderCompression=new DampedSpring();
  private seedValue:number;
  private randomState:number;
  private elapsed=0;
  private inputBlend=0;
  private pointer:XY={x:0,y:0};
  private idleGoal:XY={x:0,y:0};
  private idleLook:XY={x:0,y:0};
  private driftGoal:XYZ={x:0,y:0,z:0};
  private drift:XYZ={x:0,y:0,z:0};
  private nextIdleTarget=1;
  private nextDriftTarget=2;
  private nextNod=7;
  private nodTime=-1;
  private nodDuration=.9;
  private nodSign=1;
  private nodAnticipation=.16;
  private nodOvershoot=.1;
  private microExpressionTime=-1;
  private microExpressionDuration=.9;
  private microExpressionSign=1;
  private nextMicroExpression=5;
  private greetingTime=-1;
  private greetingSign=1;
  private breathPhase=0;
  private leftArmPhase=0;
  private rightArmPhase=0;
  private leftArmDetailPhase=0;
  private rightArmDetailPhase=0;
  private leftShoulderIdlePhase=0;
  private leftElbowIdlePhase=0;
  private leftWristIdlePhase=0;
  private rightShoulderIdlePhase=0;
  private rightElbowIdlePhase=0;
  private rightWristIdlePhase=0;
  private eye:XY={x:0,y:0};
  private head:XY={x:0,y:0};
  private body:XY={x:0,y:0};
  private readonly headSpringX=new DampedSpring();
  private readonly headSpringY=new DampedSpring();
  private readonly bodySpringX=new DampedSpring();
  private readonly bodySpringY=new DampedSpring();
  private outfit:PresenceOutfit=0;
  private idleArmBias:ArticulatedArmParameters=zeroArticulated();
  private idleArmBiasTarget:ArticulatedArmParameters=zeroArticulated();
  private idleArmTime=0;
  private nextIdleArmBiasAt=4;
  private articulated:ArticulatedArmParameters=zeroArticulated();
  private gesturePhase:'idle'|'anticipation'|'travel'|'hold'|'settle'='idle';
  private gestureClock=0;
  private gestureVariantIndex=-1;
  private gestureStart=zeroArticulated();
  private gestureAnticipation=zeroArticulated();
  private gestureTarget=zeroArticulated();
  private gestureOvershoot=zeroArticulated();
  private gesturePosture:PosturePose=zeroPosture();
  private gesturePostureStart=zeroPosture();
  private gesturePostureAnticipation=zeroPosture();
  private gesturePostureTarget=zeroPosture();
  private gesturePostureOvershoot=zeroPosture();
  private gestureDirection:1|-1=1;
  private gestureDominantArm:Leg='R';
  private gestureName:'right_invite'|'left_gentle'='right_invite';
  private gestureSupportLeg:Leg='R';
  private gestureIdleBase:ArticulatedArmParameters=zeroArticulated();
  // Base posture is held during the broad pose so the 1.0-1.78s hold is
  // genuinely still even while the ordinary pointer/idle layers continue.
  private gestureBaseTorso=0;
  private gestureBasePelvis=0;
  private gestureBaseThighL=0;
  private gestureBaseThighR=0;
  private baseReleaseClock=-1;
  private baseReleaseTorso=0;
  private baseReleasePelvis=0;
  private baseReleaseThighL=0;
  private baseReleaseThighR=0;
  // Independent stance state.  Targets are selected only while gesturePhase
  // is idle; transitions use a bounded ease in/hold/ease out envelope.
  private stanceGoal=0;
  private stance=0;
  private nextStanceAt=7;
  private stancePhase:'idle'|'in'|'hold'|'out'='idle';
  private stanceClock=0;
  private stanceFrom=0;
  private stanceInDuration=1.2;
  private stanceHoldDuration=1;
  private stanceOutDuration=1.8;
  private nextGestureAt=6;
  private gestureRequested=false;
  private requestedGreeting=false;
  private queuedGreeting=false;
  private gestureAutonomous=false;

  constructor(seed=DEFAULT_SEED){
    this.seedValue=normalizedSeed(seed);
    this.randomState=this.seedValue;
    this.reset();
  }

  /** The normalized seed used by the next reset. */
  get seed():number { return this.seedValue; }

  /** Return a deterministic value in [0, 1), without global state. */
  private random():number {
    // Mulberry32-style mixing is adequate for motion phases and target picks;
    // it is deliberately not a source of security or user-visible randomness.
    this.randomState=(this.randomState+0x6D2B79F5)>>>0;
    let value=this.randomState;
    value=Math.imul(value^(value>>>15),value|1);
    value^=value+Math.imul(value^(value>>>7),value|61);
    return ((value^(value>>>14))>>>0)/4294967296;
  }

  private signed():number { return this.random()*2-1; }

  /** Reset clocks, targets, pulses and the deterministic generator. */
  reset(seed=this.seedValue):void {
    this.seedValue=normalizedSeed(seed);
    this.randomState=this.seedValue;
    this.elapsed=0;
    this.inputBlend=0;
    this.pointer={x:0,y:0};
    this.idleGoal={x:0,y:0};
    this.idleLook={x:0,y:0};
    this.driftGoal={x:0,y:0,z:0};
    this.drift={x:0,y:0,z:0};
    this.nextIdleTarget=1.4+this.random()*1.8;
    this.nextDriftTarget=2.8+this.random()*2.2;
    this.nextNod=8.5+this.random()*5.5;
    this.nodTime=-1;
    this.nodDuration=.9;
    this.nodSign=1;
    this.nodAnticipation=.16;
    this.nodOvershoot=.1;
    this.microExpressionTime=-1;
    this.microExpressionDuration=.9;
    this.microExpressionSign=1;
    this.greetingTime=-1;
    this.greetingSign=1;
    this.breathPhase=this.random()*TWO_PI;
    this.leftArmPhase=this.random()*TWO_PI;
    this.rightArmPhase=this.random()*TWO_PI;
    this.leftArmDetailPhase=this.random()*TWO_PI;
    this.rightArmDetailPhase=this.random()*TWO_PI;
    this.eye={x:0,y:0};
    this.head={x:0,y:0};
    this.body={x:0,y:0};
    this.headSpringX.reset();
    this.shoulderCompression.reset();
    this.headSpringY.reset();
    this.bodySpringX.reset();
    this.bodySpringY.reset();
    this.outfit=0;
    this.idleArmBias=zeroArticulated();
    this.idleArmBiasTarget=zeroArticulated();
    this.idleArmTime=0;
    this.nextIdleArmBiasAt=4;
    this.articulated=zeroArticulated();
    this.gesturePhase='idle';
    this.gestureClock=0;
    this.gestureVariantIndex=-1;
    this.gestureStart=zeroArticulated();
    this.gestureAnticipation=zeroArticulated();
    this.gestureTarget=zeroArticulated();
    this.gestureOvershoot=zeroArticulated();
    this.gesturePosture=zeroPosture();
    this.gesturePostureStart=zeroPosture();
    this.gesturePostureAnticipation=zeroPosture();
    this.gesturePostureTarget=zeroPosture();
    this.gesturePostureOvershoot=zeroPosture();
    this.gestureDirection=1;
    this.gestureDominantArm='R';
    this.gestureName='right_invite';
    this.gestureSupportLeg='R';
    this.gestureIdleBase=zeroArticulated();
    this.gestureBaseTorso=0;
    this.gestureBasePelvis=0;
    this.gestureBaseThighL=0;
    this.gestureBaseThighR=0;
    this.baseReleaseClock=-1;
    this.baseReleaseTorso=0;
    this.baseReleasePelvis=0;
    this.baseReleaseThighL=0;
    this.baseReleaseThighR=0;
    this.stanceGoal=0;
    this.stance=0;
    this.stancePhase='idle';
    this.stanceClock=0;
    this.stanceFrom=0;
    this.stanceInDuration=STANCE_IN_MIN;
    this.stanceHoldDuration=STANCE_HOLD_MIN;
    this.stanceOutDuration=STANCE_OUT_MIN;
    this.nextStanceAt=STANCE_INTERVAL_MIN+this.random()*(STANCE_INTERVAL_MAX-STANCE_INTERVAL_MIN);
    this.nextGestureAt=9+this.random()*5;
    // Initialize the arm layer after the initial schedule. The complete
    // timeline is deterministic for this version; later events share this RNG.
    this.leftShoulderIdlePhase=this.random()*TWO_PI;
    this.leftElbowIdlePhase=this.random()*TWO_PI;
    this.leftWristIdlePhase=this.random()*TWO_PI;
    this.rightShoulderIdlePhase=this.random()*TWO_PI;
    this.rightElbowIdlePhase=this.random()*TWO_PI;
    this.rightWristIdlePhase=this.random()*TWO_PI;
    this.nextIdleArmBiasAt=5+this.random()*4;
    this.nextMicroExpression=3.8+this.random()*2.4;
    this.gestureRequested=false;
    this.requestedGreeting=false;
    this.queuedGreeting=false;
    this.gestureAutonomous=false;
  }

  /** Schedule a broad, asymmetric articulated gesture and a nod response. */
  triggerGreeting():void {
    if(this.gesturePhase==='idle'&&!this.gestureRequested){
      this.requestedGreeting=true;
      this.gestureRequested=true;
      return;
    }
    // A greeting pressed during an active gesture is retained once.  Keeping
    // one slot prevents a click storm from building an unbounded action tail.
    this.queuedGreeting=true;
  }

  /** Trigger the same authored family without the greeting facial cue. */
  triggerPlayfulGesture():void {
    if(this.gesturePhase!=='idle'||this.gestureRequested)return;
    this.requestedGreeting=false;
    this.gestureRequested=true;
  }

  private chooseIdleTarget():void {
    const angle=this.random()*TWO_PI;
    const radius=IDLE_RADIUS_MIN+this.random()*(IDLE_RADIUS_MAX-IDLE_RADIUS_MIN);
    this.idleGoal={x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};
    this.nextIdleTarget=this.elapsed+3.2+this.random()*2.8;
  }

  private chooseDriftTarget():void {
    // Drift is a quiet breathing offset, not a second pointer target. Keep
    // vertical travel especially small so the body stays planted between
    // deliberate nods and greetings.
    this.driftGoal={x:this.signed()*.48,y:this.signed()*.28,z:this.signed()*.36};
    this.nextDriftTarget=this.elapsed+4.5+this.random()*4;
  }

  /** Select a small, bounded rest-pose bias every five to nine seconds. */
  private chooseIdleArmBias():void {
    for(const key of ARM_ARTICULATED_KEYS){
      const amplitude=IDLE_ARM_AMPLITUDE[key];
      this.idleArmBiasTarget[key]=(this.random()*2-1)*amplitude*.18;
    }
    this.idleArmBiasTarget.ParamHandPoseR=0;
    this.nextIdleArmBiasAt=this.elapsed+4+this.random()*3;
  }

  /** Sample one low-frequency whole-arm sway; distal joints stay neutral. */
  private sampleIdleArticulated():ArticulatedArmParameters {
    const result=zeroArticulated();
    // Keep reset/first-frame readback exactly neutral before the idle layer
    // starts. This also avoids a visible jump while the model is mounting.
    if(this.elapsed<1/30)return result;
    const sample=(key:ArticulatedKey,phase:number):number=>{
      const amplitude=IDLE_ARM_AMPLITUDE[key];
      if(amplitude<=0)return 0;
      const frequency=IDLE_ARM_FREQUENCY[key];
      const primary=Math.sin(this.idleArmTime*frequency*TWO_PI+phase);
      const detail=Math.sin(this.idleArmTime*frequency*1.27*TWO_PI+phase*1.41);
      return clamp(
        amplitude*(primary*.84+detail*.16)+this.idleArmBias[key],
        -GENTLE_SHOULDER_LIMIT,GENTLE_SHOULDER_LIMIT,
      );
    };
    result.ParamShoulderLiftL=sample('ParamShoulderLiftL',this.leftShoulderIdlePhase);
    result.ParamShoulderLiftR=sample('ParamShoulderLiftR',this.rightShoulderIdlePhase);
    // Elbow, wrist, and hand controls are intentionally hard-neutral in every
    // outfit.  The shoulder wave represents the complete authored arm sway.
    result.ParamElbowCurlL=0;
    result.ParamElbowCurlR=0;
    result.ParamWristAngleL=0;
    result.ParamWristAngleR=0;
    result.ParamHandPoseR=0;
    return result;
  }

  private advanceIdleArticulated(dt:number):void {
    // Keep the quiet phase clock alive during a greeting/automatic face cue so
    // the small sway does not freeze and jump when that cue ends.
    this.idleArmTime+=dt;
    while(this.elapsed>=this.nextIdleArmBiasAt)this.chooseIdleArmBias();
    for(const key of ARM_ARTICULATED_KEYS){
      this.idleArmBias[key]=approach(this.idleArmBias[key],this.idleArmBiasTarget[key],1.8,dt);
    }
    this.idleArmBias.ParamHandPoseR=0;
    this.articulated=this.sampleIdleArticulated();
  }

  private chooseStanceGoal():number {
    // A neutral target is common enough to keep the center of mass settled;
    // the other targets are small, signed weight shifts rather than a loop.
    if(this.random()<.55)return 0;
    return (this.random()<.5?-1:1)*(.10+this.random()*.06);
  }

  private startStance():void {
    if(this.gesturePhase!=='idle')return;
    this.stanceGoal=this.chooseStanceGoal();
    this.stanceFrom=this.stance;
    this.stanceClock=0;
    this.stanceInDuration=STANCE_IN_MIN+this.random()*(STANCE_IN_MAX-STANCE_IN_MIN);
    this.stanceHoldDuration=STANCE_HOLD_MIN+this.random()*(STANCE_HOLD_MAX-STANCE_HOLD_MIN);
    this.stanceOutDuration=STANCE_OUT_MIN+this.random()*(STANCE_OUT_MAX-STANCE_OUT_MIN);
    this.stancePhase='in';
    this.nextStanceAt=this.elapsed+STANCE_INTERVAL_MIN+this.random()*(STANCE_INTERVAL_MAX-STANCE_INTERVAL_MIN);
  }

  private sampleStance():void {
    if(this.stancePhase==='idle'){
      this.stance=0;
      return;
    }
    const inEnd=this.stanceInDuration;
    const holdEnd=inEnd+this.stanceHoldDuration;
    const outEnd=holdEnd+this.stanceOutDuration;
    if(this.stanceClock<=inEnd){
      this.stancePhase='in';
      this.stance=this.stanceFrom+(this.stanceGoal-this.stanceFrom)*smoothStep(this.stanceClock/inEnd);
      return;
    }
    if(this.stanceClock<=holdEnd){
      this.stancePhase='hold';
      this.stance=this.stanceGoal;
      return;
    }
    if(this.stanceClock<outEnd){
      this.stancePhase='out';
      this.stance=this.stanceGoal*(1-smoothStep((this.stanceClock-holdEnd)/this.stanceOutDuration));
      return;
    }
    this.stancePhase='idle';
    this.stance=0;
  }

  private advanceStance(dt:number):void {
    // A stance event is only scheduled and advanced in the quiet state.  If a
    // gesture overlaps its due time, the next idle frame starts the event.
    if(this.gesturePhase!=='idle'||this.microExpressionTime>=0)return;
    if(this.stancePhase==='idle'&&this.elapsed>=this.nextStanceAt)this.startStance();
    if(this.stancePhase!=='idle'){
      this.stanceClock+=dt;
      this.sampleStance();
    }
  }

  private advanceBaseRelease(dt:number):void {
    if(this.baseReleaseClock<0)return;
    this.baseReleaseClock+=dt;
    if(this.baseReleaseClock>=BASE_RELEASE_DURATION)this.baseReleaseClock=-1;
  }

  private startGesture(isGreeting=false):void {
    this.gestureVariantIndex=(this.gestureVariantIndex+1)%PLAYFUL_VARIANTS.length;
    const variant=PLAYFUL_VARIANTS[this.gestureVariantIndex];
    this.gestureName=variant.name;
    this.gestureDominantArm=variant.dominantArm;
    this.gestureDirection=variant.direction;
    this.gestureSupportLeg=variant.supportLeg;
    this.gestureAutonomous=!isGreeting;
    this.gestureIdleBase=copyArticulated(this.articulated);
    this.gestureStart=copyArticulated(this.articulated);
    this.gestureAnticipation=copyArticulated(variant.anticipation);
    this.gestureTarget=copyArticulated(variant.target);
    this.gestureOvershoot=copyArticulated(variant.overshoot);
    this.gesturePostureStart=copyPosture(this.gesturePosture);
    this.gesturePostureAnticipation=scalePosture(variant.bodyPosture,-variant.anticipationFactor);
    this.gesturePostureTarget=copyPosture(variant.bodyPosture);
    this.gesturePostureOvershoot=scalePosture(variant.bodyPosture,.045+this.random()*.015);
    if(isGreeting){
      this.greetingTime=0;
      this.greetingSign=this.random()<.5?-1:1;
    }else{
      this.greetingTime=-1;
    }
    const liveTorsoBase=clamp(this.idleLook.x/IDLE_RADIUS_MAX*.075,-.075,.075);
    const releaseAmount=this.baseReleaseClock<0
      ?1
      :smoothStep(clamp(this.baseReleaseClock/BASE_RELEASE_DURATION,0,1));
    this.gestureBaseTorso=this.baseReleaseClock<0
      ?liveTorsoBase
      :this.baseReleaseTorso+(liveTorsoBase-this.baseReleaseTorso)*releaseAmount;
    this.gestureBasePelvis=this.baseReleaseClock<0
      ?this.stance
      :this.baseReleasePelvis+(this.stance-this.baseReleasePelvis)*releaseAmount;
    this.gestureBaseThighL=this.baseReleaseClock<0
      ?this.stance
      :this.baseReleaseThighL+(this.stance-this.baseReleaseThighL)*releaseAmount;
    this.gestureBaseThighR=this.baseReleaseClock<0
      ?-this.stance
      :this.baseReleaseThighR+(-this.stance-this.baseReleaseThighR)*releaseAmount;
    this.baseReleaseClock=-1;
    this.gestureClock=0;
    this.gesturePhase='anticipation';
  }

  private finishGesture():void {
    this.baseReleaseTorso=this.gestureBaseTorso;
    this.baseReleasePelvis=this.gestureBasePelvis;
    this.baseReleaseThighL=this.gestureBaseThighL;
    this.baseReleaseThighR=this.gestureBaseThighR;
    this.baseReleaseClock=0;
    this.gestureClock=0;
    this.gesturePhase='idle';
    // Return to the exact quiet pose captured at gesture start.  The next
    // idle frame resumes its low-frequency phases from that same value.
    this.articulated=copyArticulated(this.gestureIdleBase);
    this.greetingTime=-1;
    this.gestureAutonomous=false;
    this.gesturePosture=zeroPosture();
    this.gesturePostureStart=zeroPosture();
    this.gesturePostureAnticipation=zeroPosture();
    this.gesturePostureTarget=zeroPosture();
    this.gesturePostureOvershoot=zeroPosture();
    this.gestureIdleBase=zeroArticulated();
    if(this.queuedGreeting){
      this.queuedGreeting=false;
      this.requestedGreeting=true;
      this.gestureRequested=true;
    }
    // A completed gesture is followed by a longer deterministic quiet
    // interval. The face microexpression layer can still appear in that rest
    // quiet interval, but never stacks with the broad pose.
    this.nextGestureAt=this.elapsed+14+this.random()*10;
  }

  private sampleGesturePosture():void {
    const t=this.gestureClock;
    const travelStart=GESTURE_ANTICIPATION;
    const holdStart=travelStart+POSTURE_TRAVEL;
    const settleStart=holdStart+POSTURE_HOLD;
    if(t<=travelStart){
      this.gesturePosture=blendPosture(this.gesturePostureStart,this.gesturePostureAnticipation,t/GESTURE_ANTICIPATION);
      return;
    }
    if(t<=holdStart){
      const travelTime=t-travelStart;
      const result=copyPosture(this.gesturePostureAnticipation);
      // The torso reaches its peak first. The pelvis and thighs arrive later,
      // leaving a visible but restrained counter-shift under the main arm.
      const torsoAmount=smoothStep(travelTime/.56);
      const pelvisAmount=smoothStep((travelTime-.13)/.54);
      const thighAmount=smoothStep((travelTime-.19)/.5);
      result.torso=this.gesturePostureAnticipation.torso
        +(this.gesturePostureTarget.torso-this.gesturePostureAnticipation.torso)*torsoAmount;
      result.pelvis=this.gesturePostureAnticipation.pelvis
        +(this.gesturePostureTarget.pelvis-this.gesturePostureAnticipation.pelvis)*pelvisAmount;
      result.thighSupport=this.gesturePostureAnticipation.thighSupport
        +(this.gesturePostureTarget.thighSupport-this.gesturePostureAnticipation.thighSupport)*thighAmount;
      result.thighFree=this.gesturePostureAnticipation.thighFree
        +(this.gesturePostureTarget.thighFree-this.gesturePostureAnticipation.thighFree)*thighAmount;
      this.gesturePosture=result;
      return;
    }
    if(t<=settleStart){
      this.gesturePosture=copyPosture(this.gesturePostureTarget);
      return;
    }
    const settleTime=t-settleStart;
    const overshootEnd=.38;
    const settle=(target:number,delta:number,lag:number):number=>{
      // Each delayed channel still has to arrive at neutral at the common
      // gesture boundary; using the full duration would leave residue for
      // finishGesture() to snap away.
      // Finish a short neutral tail before the state machine changes phase;
      // the tail makes the sampled boundary exactly continuous at 60/120fps.
      const duration=Math.max(.01,POSTURE_SETTLE-lag-.12);
      const progress=clamp((settleTime-lag)/duration,0,1);
      const overshoot=target+delta;
      return progress<=overshootEnd
        ? target+(overshoot-target)*smoothStep(progress/overshootEnd)
        : overshoot+(0-overshoot)*smoothStep((progress-overshootEnd)/(1-overshootEnd));
    };
    this.gesturePosture={
      torso:settle(this.gesturePostureTarget.torso,this.gesturePostureOvershoot.torso,0),
      pelvis:settle(this.gesturePostureTarget.pelvis,this.gesturePostureOvershoot.pelvis,.14),
      thighSupport:settle(this.gesturePostureTarget.thighSupport,this.gesturePostureOvershoot.thighSupport,.20),
      thighFree:settle(this.gesturePostureTarget.thighFree,this.gesturePostureOvershoot.thighFree,.20),
    };
  }

  private sampleGesture():void {
    const t=this.gestureClock;
    const travelStart=GESTURE_ANTICIPATION;
    const holdStart=travelStart+GESTURE_TRAVEL;
    const settleStart=holdStart+GESTURE_HOLD;
    if(t<=travelStart){
      this.gesturePhase='anticipation';
      this.articulated=blendArticulated(this.gestureStart,this.gestureAnticipation,t/GESTURE_ANTICIPATION);
      this.sampleGesturePosture();
      return;
    }
    if(t<=holdStart){
      this.gesturePhase='travel';
      const travelTime=t-travelStart,result=zeroArticulated();
      // A short lead/lag across joints makes the large pose read as a gesture
      // rather than one rigid transform applied to the whole arm. The right
      // hand pose follows the wrist and is only active for right_invite.
      for(const key of ARTICULATED_KEYS){
        if(key==='ParamHandPoseR'){
          // Open the palm after the wrist has begun to travel, then finish in
          // a short authored transition.  A dedicated duration keeps this
          // channel from blending for the entire broad-arm travel.
          const amount=smoothStep((travelTime-HAND_POSE_TRAVEL_LAG)/HAND_POSE_TRANSITION);
          result[key]=this.gestureAnticipation[key]
            +(this.gestureTarget[key]-this.gestureAnticipation[key])*amount;
          continue;
        }
        const lag=key.includes('Wrist')?.24:key.includes('Elbow')?.13:0;
        const duration=Math.max(.01,GESTURE_TRAVEL-lag);
        const amount=smoothStep((travelTime-lag)/duration);
        result[key]=this.gestureAnticipation[key]+(this.gestureTarget[key]-this.gestureAnticipation[key])*amount;
      }
      this.articulated=copyArticulated(result);
      this.sampleGesturePosture();
      return;
    }
    if(t<=settleStart){
      this.gesturePhase='hold';
      this.articulated=copyArticulated(this.gestureTarget);
      this.sampleGesturePosture();
      return;
    }
    this.gesturePhase='settle';
    const settleTime=t-settleStart,result=zeroArticulated();
    const overshootEnd=.34;
    for(const key of ARTICULATED_KEYS){
      if(key==='ParamHandPoseR'){
        // Close the hand on the first part of the settle.  It reaches the
        // relaxed value long before the broad arm settles, with no endpoint
        // snap when finishGesture() returns to the idle layer.
        const amount=smoothStep((settleTime-HAND_POSE_SETTLE_LAG)/HAND_POSE_TRANSITION);
        result[key]=this.gestureTarget[key]
          +(0-this.gestureTarget[key])*amount;
        continue;
      }
      const lag=key.includes('Wrist')?.16:key.includes('Elbow')?.09:0;
      const duration=Math.max(.01,GESTURE_SETTLE-lag);
      const progress=clamp((settleTime-lag)/duration,0,1);
      const overshoot=this.gestureTarget[key]+this.gestureOvershoot[key];
      const returnValue=this.gestureIdleBase[key];
      result[key]=progress<=overshootEnd
        ? this.gestureTarget[key]+(overshoot-this.gestureTarget[key])*smoothStep(progress/overshootEnd)
        : overshoot+(returnValue-overshoot)*smoothStep((progress-overshootEnd)/(1-overshootEnd));
    }
    this.articulated=copyArticulated(result);
    this.sampleGesturePosture();
  }

  private advanceGesture(dt:number):void {
    if(this.gestureRequested&&this.gesturePhase==='idle'){
      const greeting=this.requestedGreeting;
      this.gestureRequested=false;
      this.requestedGreeting=false;
      this.startGesture(greeting);
    }else if(this.gesturePhase==='idle'&&this.stancePhase==='idle'
      &&this.microExpressionTime<0&&this.elapsed>=this.nextGestureAt){
      this.startGesture(false);
    }
    if(this.gesturePhase==='idle')return;
    this.gestureClock+=dt;
    if(this.gestureClock>=GESTURE_TOTAL){
      // Sample the exact endpoint before releasing the frozen base.  This
      // makes the last active frame and the first idle frame continuous.
      this.gestureClock=GESTURE_TOTAL;
      this.sampleGesture();
      this.finishGesture();
      return;
    }
    this.sampleGesture();
  }

  private advanceMicroExpression(dt:number):void {
    // A broad gesture, a manual greeting, or a stance owns the stage while it
    // is active. Do not stack a face cue on top of those events; postpone it
    // to a later quiet interval instead.
    if(this.gesturePhase!=='idle'||this.greetingTime>=0||this.stancePhase!=='idle'){
      if(this.microExpressionTime>=0){
        this.microExpressionTime=-1;
        this.nextMicroExpression=this.elapsed+MICRO_EXPRESSION_INTERVAL_MIN
          +this.random()*(MICRO_EXPRESSION_INTERVAL_MAX-MICRO_EXPRESSION_INTERVAL_MIN);
      }
      return;
    }
    if(this.microExpressionTime>=0){
      this.microExpressionTime+=dt;
      if(this.microExpressionTime>=this.microExpressionDuration){
        this.microExpressionTime=-1;
        this.nextMicroExpression=this.elapsed+MICRO_EXPRESSION_INTERVAL_MIN
          +this.random()*(MICRO_EXPRESSION_INTERVAL_MAX-MICRO_EXPRESSION_INTERVAL_MIN);
      }
      return;
    }
    if(this.elapsed<this.nextMicroExpression)return;
    this.microExpressionTime=0;
    this.microExpressionDuration=MICRO_EXPRESSION_DURATION_MIN
      +this.random()*(MICRO_EXPRESSION_DURATION_MAX-MICRO_EXPRESSION_DURATION_MIN);
    this.microExpressionSign=this.random()<.5?-1:1;
    this.nextMicroExpression=this.elapsed+this.microExpressionDuration
      +MICRO_EXPRESSION_INTERVAL_MIN
      +this.random()*(MICRO_EXPRESSION_INTERVAL_MAX-MICRO_EXPRESSION_INTERVAL_MIN);
  }

  private advanceAutonomy(dt:number):void {
    while(this.elapsed>=this.nextIdleTarget)this.chooseIdleTarget();
    while(this.elapsed>=this.nextDriftTarget)this.chooseDriftTarget();
    this.idleLook.x=approach(this.idleLook.x,this.idleGoal.x,1.35,dt);
    this.idleLook.y=approach(this.idleLook.y,this.idleGoal.y,1.35,dt);
    this.drift.x=approach(this.drift.x,this.driftGoal.x,.52,dt);
    this.drift.y=approach(this.drift.y,this.driftGoal.y,.47,dt);
    this.drift.z=approach(this.drift.z,this.driftGoal.z,.43,dt);

    if(this.nodTime>=0){
      this.nodTime+=dt;
      if(this.nodTime>this.nodDuration)this.nodTime=-1;
    }else if(this.elapsed>=this.nextNod){
      this.nodTime=0;
      this.nodDuration=.72+this.random()*.38;
      this.nodSign=this.random()<.5?-1:1;
      this.nodAnticipation=.13+this.random()*.055;
      this.nodOvershoot=.085+this.random()*.065;
      this.nextNod=this.elapsed+14+this.random()*10;
    }
    if(this.greetingTime>=0){
      this.greetingTime+=dt;
      if(this.greetingTime>1.2)this.greetingTime=-1;
    }
    this.advanceBaseRelease(dt);
    this.advanceIdleArticulated(dt);
    this.advanceGesture(dt);
    this.advanceMicroExpression(dt);
    this.advanceStance(dt);
  }

  private idleScale(idleMaximum:number,followMaximum:number):number {
    const idleScale=idleMaximum/IDLE_RADIUS_MAX;
    return idleScale+(followMaximum-idleScale)*this.inputBlend;
  }

  private idleCap(idleMaximum:number,followMaximum:number):number {
    return idleMaximum+(followMaximum-idleMaximum)*this.inputBlend;
  }

  private makeOutput():PresenceOutput {
    const blend=this.inputBlend;
    const idleWeight=1-blend;
    const nodWeight=.25+.75*idleWeight;
    const nod=this.nodTime>=0
      ?nodEnvelope(this.nodTime,this.nodDuration,this.nodAnticipation,this.nodOvershoot)
      :0;
    const greeting=smoothPulse(this.greetingTime,0,1.05);
    const greetingLean=smoothPulse(this.greetingTime,.08,.95);

    // Eye -> head -> body follow rates are intentionally different.  The
    // normalized target itself is shared, but each layer has its own lag.
    const headX=this.head.x*this.idleScale(4.8,26.4)+this.drift.x*1.05*idleWeight;
    const headY=this.head.y*this.idleScale(2.85,22)+this.drift.y*.45*idleWeight;
    const headZ=this.head.x*this.idleScale(2.8,6.05)+this.drift.z*.55*idleWeight;
    const bodyX=this.body.x*this.idleScale(2.2,6.6)+this.drift.x*.45*idleWeight;
    const bodyY=this.body.y*this.idleScale(1.25,5.5)+this.drift.y*.24*idleWeight;
    // Let the torso counter-lean gently against the head's horizontal drift;
    // this gives the large arm pose a stable base without twisting the feet.
    const bodyZ=-this.body.x*this.idleScale(2.05,2.86)+this.drift.z*.24*idleWeight;
    // The authored idle nod is readable at the stage scale while remaining
    // below the broad pointer-follow cap. Body response is deliberately
    // smaller so the character's weight stays planted.
    const nodY=-this.nodSign*4.25*nod*nodWeight;
    const nodZ=this.nodSign*1.35*nod*nodWeight;
    const greetingY=-1.35*greeting-.35*greetingLean;
    const greetingZ=this.greetingSign*.75*greetingLean;
    const bodyGreetingY=-.34*greeting-.1*greetingLean;
    const bodyGreetingZ=this.greetingSign*.20*greetingLean;

    // The legacy whole-arm channel follows the same quiet, slow sway as the
    // articulated shoulder.  Greeting and nod response remains in head/face
    // channels above, so an arm cannot become a large gesture by accumulation.
    const leftIdle=.0065*Math.sin(this.elapsed*TWO_PI*.11+this.leftArmPhase)
      +.0022*Math.sin(this.elapsed*TWO_PI*.143+this.leftArmDetailPhase);
    const rightIdle=.0062*Math.sin(this.elapsed*TWO_PI*.117+this.rightArmPhase)
      +.0023*Math.sin(this.elapsed*TWO_PI*.151+this.rightArmDetailPhase);
    const pointerArm=blend*this.pointer.y*.0015;

    const bodyAngleX=clamp(bodyX,-this.idleCap(2.4,10),this.idleCap(2.4,10));
    // The leg dead zone is measured from the actual body parameter written to
    // the model.  A small pointer lean therefore leaves both thigh channels
    // untouched until |bodyNorm| is above .32.
    const bodyNorm=clamp(bodyAngleX/10,-1,1);
    const pointerResidual=blend*.22*bodyNorm*(1-.65*Math.abs(bodyNorm));
    const pointerDrive=Math.abs(bodyNorm)>.32
      ? blend*Math.sign(bodyNorm)*(Math.abs(bodyNorm)-.32)/.68
      : 0;
    const pointerSupport=clamp(pointerDrive*.18,-.18,.18);
    const pointerFree=-Math.min(.06,Math.abs(pointerDrive)*.06);
    const pointerThighL=pointerDrive<0?pointerSupport:pointerFree;
    const pointerThighR=pointerDrive>=0?pointerSupport:pointerFree;
    const liveTorsoBase=clamp(this.idleLook.x/IDLE_RADIUS_MAX*.075,-.075,.075);
    const gestureActive=this.gesturePhase!=='idle';
    const releaseAmount=this.baseReleaseClock<0
      ?1
      :smoothStep(clamp(this.baseReleaseClock/BASE_RELEASE_DURATION,0,1));
    const releasedTorso=this.baseReleaseTorso+(liveTorsoBase-this.baseReleaseTorso)*releaseAmount;
    const releasedPelvis=this.baseReleasePelvis+(this.stance-this.baseReleasePelvis)*releaseAmount;
    const releasedThighL=this.baseReleaseThighL+(this.stance-this.baseReleaseThighL)*releaseAmount;
    const releasedThighR=this.baseReleaseThighR+(-this.stance-this.baseReleaseThighR)*releaseAmount;
    const baseTorso=gestureActive?this.gestureBaseTorso
      :(this.baseReleaseClock<0?liveTorsoBase:releasedTorso);
    const basePelvis=gestureActive?this.gestureBasePelvis
      :(this.baseReleaseClock<0?this.stance:releasedPelvis);
    const baseThighL=gestureActive?this.gestureBaseThighL
      :(this.baseReleaseClock<0?this.stance:releasedThighL);
    const baseThighR=gestureActive?this.gestureBaseThighR
      :(this.baseReleaseClock<0?-this.stance:releasedThighR);
    const gestureThighL=this.gestureSupportLeg==='L'
      ?this.gesturePosture.thighSupport:this.gesturePosture.thighFree;
    const gestureThighR=this.gestureSupportLeg==='R'
      ?this.gesturePosture.thighSupport:this.gesturePosture.thighFree;
    // All three outfits receive this same gentle envelope.  The previous
    // gesture state machine still drives head/body timing and facial cues, but
    // its large articulated arm pose is deliberately not exposed here.
    const articulated=this.sampleIdleArticulated();

    const gestureSmile=this.gestureAutonomous&&this.gesturePhase!=='idle'
      ?autonomousSmileAt(this.gestureClock):0;
    const microSmile=this.microExpressionTime>=0&&this.gesturePhase==='idle'
      ?microExpressionAt(this.microExpressionTime,this.microExpressionDuration):0;
    const autonomousSmile=Math.max(gestureSmile,microSmile);
    const gestureCueActive=this.gestureAutonomous&&this.gesturePhase!=='idle';
    const microCueActive=this.microExpressionTime>=0&&this.gesturePhase==='idle';
    const automaticCueActive=gestureCueActive||microCueActive;
    const cuePeak=gestureCueActive?AUTONOMOUS_CUE_PEAK:MICRO_EXPRESSION_PEAK;
    const cueDirection=gestureCueActive?this.gestureDirection:this.microExpressionSign;
    const autonomousCue:AutonomousCue=automaticCueActive
      ?{
        active:true,
        mouthForm:clamp(autonomousSmile,0,AUTONOMOUS_CUE_PEAK),
        // Automatic attention yields to an active pointer target through the
        // same input blend used by the ordinary idle gaze. The gesture's
        // authored direction supplies the sign for the small eye offset.
        gazeX:clamp(
          cueDirection*(gestureSmile>0?AUTONOMOUS_CUE_GAZE:.026)
            *(autonomousSmile/Math.max(cuePeak,1e-6))*(1-blend),
          -.12,.12,
        ),
      }
      :zeroAutonomousCue();

    return {
      parameters:{
        ParamEyeBallX:clamp(this.eye.x*.88,-PRESENCE_LIMITS.ParamEyeBallX,PRESENCE_LIMITS.ParamEyeBallX),
        ParamEyeBallY:clamp(this.eye.y*.85,-PRESENCE_LIMITS.ParamEyeBallY,PRESENCE_LIMITS.ParamEyeBallY),
        ParamAngleX:clamp(headX,-this.idleCap(5,30),this.idleCap(5,30)),
        ParamAngleY:clamp(headY+nodY+greetingY,-this.idleCap(5,28),this.idleCap(5,28)),
        ParamAngleZ:clamp(headZ+nodZ+greetingZ,-this.idleCap(3,9),this.idleCap(3,9)),
        ParamBodyAngleX:bodyAngleX,
        ParamBodyAngleY:clamp(bodyY+nodY*.5+bodyGreetingY,-this.idleCap(3,10),this.idleCap(3,10)),
        ParamBodyAngleZ:clamp(bodyZ+nodZ*.35+bodyGreetingZ,-this.idleCap(2.2,4),this.idleCap(2.2,4)),
        ParamBreath:clamp(.5+.25*Math.sin(this.elapsed*1.25+this.breathPhase),PRESENCE_LIMITS.ParamBreath.min,PRESENCE_LIMITS.ParamBreath.max),
        ParamTorsoSway:clamp(baseTorso+pointerResidual+this.gesturePosture.torso,-PRESENCE_LIMITS.ParamTorsoSway,PRESENCE_LIMITS.ParamTorsoSway),
        ParamPelvisSway:clamp(basePelvis+this.gesturePosture.pelvis,-PRESENCE_LIMITS.ParamPelvisSway,PRESENCE_LIMITS.ParamPelvisSway),
        ParamThighShiftL:clamp(baseThighL+gestureThighL+pointerThighL,-PRESENCE_LIMITS.ParamThighShiftL,PRESENCE_LIMITS.ParamThighShiftL),
        ParamThighShiftR:clamp(baseThighR+gestureThighR+pointerThighR,-PRESENCE_LIMITS.ParamThighShiftR,PRESENCE_LIMITS.ParamThighShiftR),
        ParamShoulderCompress:clamp(this.shoulderCompression.value,-.45,.9),
      },
      leftArmAdditive:clamp(leftIdle+pointerArm,-PRESENCE_LIMITS.armAdditive,PRESENCE_LIMITS.armAdditive),
      rightArmAdditive:clamp(rightIdle-pointerArm,-PRESENCE_LIMITS.armAdditive,PRESENCE_LIMITS.armAdditive),
      articulated,
      autonomousCue,
    };
  }

  /** Advance by a bounded amount and return fresh parameter/additive values. */
  update(dt:number,input:PresenceInput):PresenceOutput {
    const seconds=clamp(finite(dt),0,MAX_DT);
    if(input?.outfit===0||input?.outfit===1||input?.outfit===2)this.outfit=input.outfit;
    if(seconds===0)return this.makeOutput();
    this.elapsed+=seconds;
    this.advanceAutonomy(seconds);
    const nodCompression=this.nodTime>=0
      ?nodEnvelope(this.nodTime,this.nodDuration,this.nodAnticipation,this.nodOvershoot):0;
    const shoulderTarget=.68*nodCompression*(1-this.inputBlend*.75)
      +.85*smoothPulse(this.greetingTime,0,.7);
    this.shoulderCompression.update(shoulderTarget,seconds,3.3,.5);
    const pointer=input?.pointer??{x:0,y:0};
    const pointerX=clamp(finite(pointer.x),-1,1);
    const pointerY=clamp(finite(pointer.y),-1,1);
    const active=Boolean(input?.pointerActive&&input?.followEnabled);
    this.pointer={x:pointerX,y:pointerY};
    this.inputBlend=approach(this.inputBlend,active?1:0,8,seconds);
    const targetX=this.idleLook.x*(1-this.inputBlend)+pointerX*this.inputBlend;
    const targetY=this.idleLook.y*(1-this.inputBlend)+pointerY*this.inputBlend;

    // The eye remains the first responder. Head and body follow the current
    // eye/head targets with an analytic underdamped spring, preserving the
    // deliberate second/third-stage lag while adding a bounded follow-through.
    this.eye.x=approach(this.eye.x,targetX,12,seconds);
    this.eye.y=approach(this.eye.y,targetY,12,seconds);
    this.head.x=this.headSpringX.update(this.eye.x,seconds,HEAD_SPRING_FREQUENCY,HEAD_SPRING_DAMPING);
    this.head.y=this.headSpringY.update(this.eye.y,seconds,HEAD_SPRING_FREQUENCY,HEAD_SPRING_DAMPING);
    this.body.x=this.bodySpringX.update(this.head.x,seconds,BODY_SPRING_FREQUENCY,BODY_SPRING_DAMPING);
    this.body.y=this.bodySpringY.update(this.head.y,seconds,BODY_SPRING_FREQUENCY,BODY_SPRING_DAMPING);
    return this.makeOutput();
  }
}

export const createPresenceController=(seed=DEFAULT_SEED):PresenceController=>new PresenceController(seed);
