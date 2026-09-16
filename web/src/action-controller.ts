/**
 * Pure, model-independent action intent generation for SuJiangXue.
 *
 * The controller only emits values for the verified head, body, gaze, eye,
 * mouth, brow, cheek, shoulder and active ear parameter inventory. A host decides when and how to
 * apply the two intent groups to a model.  In particular, eye-open values are
 * multiplication coefficients, so an external blink value of zero remains
 * zero after the intent is applied.
 */

export const ACTION_NAMES = Object.freeze(['curiosity', 'shy', 'smug'] as const);
export const CHEW_ACTION_NAMES = Object.freeze(['chewLeft', 'chewRight'] as const);
export type LegacyActionName = (typeof ACTION_NAMES)[number];
export type ChewActionName = (typeof CHEW_ACTION_NAMES)[number];
export type ActionName = LegacyActionName | ChewActionName;

export type ActionPhase = 'idle' | 'enter' | 'hold' | 'exit' | 'cancel';
export type ParameterBlend = 'add' | 'multiply' | 'replace';

export type ParameterIntent = Readonly<{
  id: string;
  value: number;
  blend: ParameterBlend;
}>;

/**
 * Numeric parameter values are enumerable for direct host integration.
 * Metadata is exposed through non-enumerable read-only views so consumers can
 * choose either `map.ParamAngleX` or `map.intents.ParamAngleX` without a
 * second conversion step.
 */
export type ParameterIntentMap = Readonly<Record<string, number>> & Readonly<{
  values: Readonly<Record<string, number>>;
  blends: Readonly<Record<string, ParameterBlend>>;
  intents: Readonly<Record<string, ParameterIntent>>;
}>;

export type ActionTransition = Readonly<{
  active: boolean;
  progress: number;
  fromAction: ActionName | null;
  toAction: ActionName | null;
}>;

export type ActionSnapshot = Readonly<{
  schema: 'hikari-action-controller/v1';
  active: boolean;
  action: ActionName | null;
  phase: ActionPhase;
  elapsed: number;
  duration: number;
  progress: number;
  paused: boolean;
  transition: ActionTransition;
  prePhysicsPose: ParameterIntentMap;
  postExpressionFace: ParameterIntentMap;
}>;

export type ActionStartRequest = ActionName | Readonly<{
  action?: ActionName;
  name?: ActionName;
}>;

export type ActionPauseArgument = boolean | Readonly<{ paused?: boolean }>;

export interface ActionControllerApi {
  start(request: ActionStartRequest): ActionSnapshot;
  cancel(): ActionSnapshot;
  reset(): ActionSnapshot;
  update(deltaSeconds: number, paused?: ActionPauseArgument): ActionSnapshot;
  snapshot(): ActionSnapshot;
}

const POSE_IDS = Object.freeze([
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'ParamBodyAngleX',
  'ParamBodyAngleY',
  'ParamBodyAngleZ',
  'ParamEyeBallX',
  'ParamEyeBallY',
  // Existing symmetric shoulder/neck compression; not independent shrugs.
  'ParamShoulderCompress',
  'ParamShoulderLiftL',
  'ParamShoulderLiftR',
  // Authored ear pose is separate from ParamEarL/RPhysics inertia.
  'ParamEarLAngle',
  'ParamEarRAngle',
  'ParamEarLTwitch',
  'ParamEarRTwitch',
] as const);

const FACE_IDS = Object.freeze([
  'ParamEyeLOpen',
  'ParamEyeROpen',
  'ParamEyeLSmile',
  'ParamEyeRSmile',
  'ParamMouthForm',
  'ParamMouthOpenY',
  // Native102: actual Mouth_Form right-corner Blend Shape, default 0.
  'ParamMouthCornerRaiseR',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamBrowLX',
  'ParamBrowRX',
  'ParamBrowLAngle',
  'ParamBrowRAngle',
  'ParamBrowLForm',
  'ParamBrowRForm',
  'ParamCheek',
  'ParamCheekPuff',
] as const);

const EYELID_IDS = Object.freeze(['ParamEyeLOpen', 'ParamEyeROpen'] as const);

/**
 * Cheek-chew is deliberately a small, face-only action. These channels were
 * recovered from the surviving compiled runtime and are checked against the
 * mounted Core model before the action starts.
 */
export const CHEW_ACTION_PARAMETER_IDS = Object.freeze([
  'ParamCheekPuff',
  'ParamCheekPuffL',
  'ParamCheekPuffR',
  'ParamMouthPucker',
  'ParamMouthForm',
  'ParamMouthOpenY',
] as const);
const CHEW_SIDE_IDS = Object.freeze([
  'ParamCheekPuffL',
  'ParamCheekPuffR',
  'ParamMouthPucker',
] as const);
const ACTION_FACE_IDS = Object.freeze([
  ...FACE_IDS,
  ...CHEW_SIDE_IDS,
] as const);

/** The controller's complete, validated output inventory. */
export const VALIDATED_ACTION_PARAMETER_IDS = Object.freeze([
  ...POSE_IDS,
  ...FACE_IDS,
] as const);

export const ACTION_PARAMETER_GROUPS = Object.freeze({
  prePhysicsPose: POSE_IDS,
  postExpressionFace: FACE_IDS,
} as const);

const ENTER_SECONDS = 0.52;
const HOLD_SECONDS = 0.54;
const EXIT_SECONDS = 0.70;
const CROSSFADE_SECONDS = 0.18;
const CANCEL_SECONDS = 0.28;
const ACTION_SECONDS = ENTER_SECONDS + HOLD_SECONDS + EXIT_SECONDS;
// Start, peak, release, neutral. Gaze leads; the body finishes last.
export const ACTION_ENVELOPES = Object.freeze({
  gaze: Object.freeze([0,.16,1.08,1.36] as const),
  face: Object.freeze([.04,.26,1.06,1.50] as const),
  head: Object.freeze([.10,.36,1.12,1.64] as const),
  body: Object.freeze([.22,.52,1.18,1.76] as const),
  ear: Object.freeze([.24,.48,.78,1.22] as const),
});
const MAX_DELTA_SECONDS = 0.25;

type NumberRecord = Record<string, number>;
type BlendRecord = Record<string, ParameterBlend>;

type ActionProfile = Readonly<{
  pose: Readonly<NumberRecord>;
  face: Readonly<NumberRecord>;
}>;

const profile = (
  pose: NumberRecord,
  face: NumberRecord,
): ActionProfile => Object.freeze({
  pose: Object.freeze({ ...pose }),
  face: Object.freeze({ ...face }),
});

const ACTION_PROFILES: Readonly<Record<LegacyActionName, ActionProfile>> = Object.freeze({
  curiosity: profile(
    {
      ParamAngleX: 8,
      ParamAngleY: 5,
      ParamAngleZ: -4,
      ParamBodyAngleX: 2,
      ParamBodyAngleY: 1,
      ParamBodyAngleZ: -1,
      ParamEyeBallX: -0.24,
      ParamEyeBallY: 0.18,
      ParamShoulderCompress: 0,
      ParamEarLAngle: .3,
      ParamEarLTwitch: .24,
    },
    {
      ParamEyeLOpen: 0.96,
      ParamEyeROpen: 0.96,
      ParamEyeLSmile: 0.14,
      ParamEyeRSmile: 0.14,
      ParamMouthForm: 0.2,
      ParamMouthOpenY: 0.22,
      ParamBrowLY: 0.22,
      ParamBrowRY: 0.22,
      ParamBrowLX: -0.08,
      ParamBrowRX: 0.08,
      ParamBrowLAngle: -0.12,
      ParamBrowRAngle: 0.12,
      ParamBrowLForm: 0.16,
      ParamBrowRForm: 0.16,
      ParamCheek: 0.16,
      ParamCheekPuff: 0.06,
    },
  ),
  shy: profile(
    {
      ParamAngleX: -4,
      ParamAngleY: -2,
      ParamAngleZ: 7,
      ParamBodyAngleX: -1,
      ParamBodyAngleY: -0.6,
      ParamBodyAngleZ: 1.5,
      ParamEyeBallX: 0.26,
      ParamEyeBallY: -0.18,
      ParamShoulderCompress: 0.26,
      ParamShoulderLiftL: .018,
      ParamShoulderLiftR: .018,
    },
    {
      ParamEyeLOpen: 0.76,
      ParamEyeROpen: 0.76,
      ParamEyeLSmile: 0.08,
      ParamEyeRSmile: 0.08,
      ParamMouthForm: 0.08,
      ParamMouthOpenY: 0.04,
      ParamBrowLY: -0.16,
      ParamBrowRY: -0.16,
      ParamBrowLX: 0.12,
      ParamBrowRX: -0.12,
      ParamBrowLAngle: 0.1,
      ParamBrowRAngle: -0.1,
      ParamBrowLForm: -0.08,
      ParamBrowRForm: -0.08,
      ParamCheek: 0.5,
      ParamCheekPuff: 0.18,
    },
  ),
  smug: profile(
    {
      ParamAngleX: 5,
      ParamAngleY: 1,
      ParamAngleZ: -5,
      ParamBodyAngleX: 1.5,
      ParamBodyAngleY: 0.4,
      ParamBodyAngleZ: -1,
      ParamEyeBallX: -0.22,
      ParamEyeBallY: -0.05,
      ParamShoulderCompress: 0,
      ParamEarRAngle: .24,
      ParamEarRTwitch: .18,
    },
    {
      ParamEyeLOpen: 0.90,
      ParamEyeROpen: 0.76,
      ParamEyeLSmile: 0.20,
      ParamEyeRSmile: 0.38,
      ParamMouthForm: 0.5,
      ParamMouthOpenY: 0.06,
      ParamMouthCornerRaiseR: 1,
      ParamBrowLY: 0.12,
      ParamBrowRY: 0.12,
      ParamBrowLX: -0.18,
      ParamBrowRX: 0.18,
      ParamBrowLAngle: -0.16,
      ParamBrowRAngle: 0.16,
      ParamBrowLForm: 0.28,
      ParamBrowRForm: 0.28,
      ParamCheek: 0.12,
      ParamCheekPuff: 0.06,
    },
  ),
});

const CHEW_PROFILES: Readonly<Record<ChewActionName, ActionProfile>> = Object.freeze({
  chewLeft: profile(
    {},
    {
      ParamCheekPuff: 0.3,
      ParamCheekPuffL: 0.2,
      ParamCheekPuffR: 0,
      ParamMouthPucker: 0.2,
      ParamMouthForm: -0.1,
      ParamMouthOpenY: 0,
    },
  ),
  chewRight: profile(
    {},
    {
      ParamCheekPuff: 0.3,
      ParamCheekPuffL: 0,
      ParamCheekPuffR: 0.2,
      ParamMouthPucker: 0.2,
      ParamMouthForm: -0.1,
      ParamMouthOpenY: 0,
    },
  ),
});

/** Require the channels authored by this action, not every other action's inventory. */
export function getActionRequiredParameterIds(name: ActionName): readonly string[] {
  const authored = name in ACTION_PROFILES
    ? ACTION_PROFILES[name as LegacyActionName]
    : CHEW_PROFILES[name as ChewActionName];
  if (!authored) throw new TypeError('Unknown action: ' + String(name));
  return Object.freeze([...new Set([...Object.keys(authored.pose), ...Object.keys(authored.face)])]);
}

const FACE_BLENDS: BlendRecord = {};
for (const id of FACE_IDS) FACE_BLENDS[id] = EYELID_IDS.includes(id as typeof EYELID_IDS[number]) ? 'multiply' : 'add';
const CHEW_FACE_BLENDS: BlendRecord = {};
for (const id of CHEW_ACTION_PARAMETER_IDS) CHEW_FACE_BLENDS[id] = 'replace';
/** Blends used while a regular expression hands its retained face to chew. */
export const CHEW_TRANSITION_FACE_BLENDS: Readonly<BlendRecord> = Object.freeze({
  ...FACE_BLENDS,
  ...CHEW_FACE_BLENDS,
});
const POSE_BLENDS: BlendRecord = {};
for (const id of POSE_IDS) POSE_BLENDS[id] = 'add';
Object.freeze(FACE_BLENDS);
Object.freeze(CHEW_FACE_BLENDS);
Object.freeze(POSE_BLENDS);

const ZERO_POSE: NumberRecord = Object.freeze(Object.fromEntries(POSE_IDS.map((id) => [id, 0])) as NumberRecord);
const NEUTRAL_FACE: NumberRecord = Object.fromEntries(ACTION_FACE_IDS.map((id) => [id, 0])) as NumberRecord;
for (const id of EYELID_IDS) NEUTRAL_FACE[id] = 1;
Object.freeze(NEUTRAL_FACE);

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, finite(value)));

const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const copyNumbers = (source: Readonly<NumberRecord>): NumberRecord => {
  const copy: NumberRecord = {};
  for (const id of Object.keys(source)) copy[id] = finite(source[id]);
  return copy;
};

const lerp = (from: number, to: number, amount: number): number => {
  const value = finite(from) + (finite(to) - finite(from)) * clamp01(amount);
  return finite(value);
};

const interpolate = (
  from: Readonly<NumberRecord>,
  to: Readonly<NumberRecord>,
  amount: number,
): NumberRecord => {
  const result: NumberRecord = {};
  for (const id of Object.keys(to)) result[id] = lerp(from[id] ?? 0, to[id], amount);
  return result;
};

const makeIntentMap = (
  values: Readonly<NumberRecord>,
  blends: Readonly<BlendRecord>,
): ParameterIntentMap => {
  const numeric: NumberRecord = {};
  const intents: Record<string, ParameterIntent> = {};
  for (const id of Object.keys(values)) {
    const value = finite(values[id]);
    const blend = blends[id] ?? 'add';
    numeric[id] = value;
    intents[id] = Object.freeze({ id, value, blend });
  }
  const readonlyValues = Object.freeze({ ...numeric });
  const readonlyBlends = Object.freeze({ ...blends });
  const readonlyIntents = Object.freeze(intents);
  Object.defineProperties(numeric, {
    values: { value: readonlyValues, enumerable: false, writable: false, configurable: false },
    blends: { value: readonlyBlends, enumerable: false, writable: false, configurable: false },
    intents: { value: readonlyIntents, enumerable: false, writable: false, configurable: false },
  });
  return Object.freeze(numeric) as ParameterIntentMap;
};

const envelopeAt = (time: number, envelope: readonly number[]): number => {
  const [start,peak,release,end]=envelope;
  if(time<=start||time>=end)return 0;
  if(time<peak)return smoothstep((time-start)/(peak-start));
  if(time<=release)return 1;
  return smoothstep((end-time)/(end-release));
};

export const CHEW_PULSE = Object.freeze({
  startSeconds: 0.18,
  endSeconds: 1.38,
});

const chewPulseAt = (elapsed: number): number => {
  const time = finite(elapsed);
  if (time <= CHEW_PULSE.startSeconds || time >= CHEW_PULSE.endSeconds) return 0;
  const progress = clamp01(
    (time - CHEW_PULSE.startSeconds) / (CHEW_PULSE.endSeconds - CHEW_PULSE.startSeconds),
  );
  const sine = Math.sin(Math.PI * progress);
  return finite(sine * sine);
};

const isChewAction = (action: ActionName): action is ChewActionName =>
  (CHEW_ACTION_NAMES as readonly string[]).includes(action);

const targetValues = (action: ActionName, elapsed: number): { pose: NumberRecord; face: NumberRecord } => {
  if (isChewAction(action)) {
    const current = CHEW_PROFILES[action];
    const face = copyNumbers(NEUTRAL_FACE);
    const pulse = chewPulseAt(elapsed);
    for (const id of CHEW_ACTION_PARAMETER_IDS) {
      const neutral = NEUTRAL_FACE[id] ?? 0;
      face[id] = lerp(neutral, current.face[id] ?? neutral, pulse);
    }
    return { pose: copyNumbers(ZERO_POSE), face };
  }
  const current = ACTION_PROFILES[action];
  const pose = copyNumbers(ZERO_POSE);
  for(const id of POSE_IDS){
    const group=id.startsWith('ParamEyeBall')?'gaze':id.startsWith('ParamEar')?'ear':id.startsWith('ParamBody')||id.startsWith('ParamShoulder')?'body':'head';
    pose[id]=lerp(0,current.pose[id]??0,envelopeAt(elapsed,ACTION_ENVELOPES[group]));
  }
  const face = copyNumbers(NEUTRAL_FACE);
  for (const id of FACE_IDS) {
    const neutral = NEUTRAL_FACE[id];
    face[id] = lerp(neutral, current.face[id], envelopeAt(elapsed,ACTION_ENVELOPES.face));
  }
  return { pose, face };
};

const phaseFor = (elapsed: number): ActionPhase => {
  if (elapsed < ENTER_SECONDS) return 'enter';
  if (elapsed < ENTER_SECONDS + HOLD_SECONDS) return 'hold';
  if (elapsed < ACTION_SECONDS) return 'exit';
  return 'idle';
};

const amountFor = (action: ActionName, elapsed: number): number => {
  if (isChewAction(action)) return chewPulseAt(elapsed);
  return Math.max(...Object.values(ACTION_ENVELOPES).map(envelope=>envelopeAt(elapsed,envelope)));
};

const extractActionName = (request: ActionStartRequest): ActionName => {
  const candidate = typeof request === 'string'
    ? request
    : request && typeof request === 'object'
      ? request.action ?? request.name
      : undefined;
  if (!(ACTION_NAMES as readonly string[]).includes(candidate as string)
    && !(CHEW_ACTION_NAMES as readonly string[]).includes(candidate as string)) {
    throw new TypeError('action must be one of curiosity, shy, smug, chewLeft, or chewRight');
  }
  return candidate as ActionName;
};

const safeDelta = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_DELTA_SECONDS);
};

const pausedValue = (value: ActionPauseArgument | undefined): boolean => {
  if (typeof value === 'boolean') return value;
  return !!(value && typeof value === 'object' && value.paused === true);
};

export class ActionController implements ActionControllerApi {
  private action: ActionName | null = null;
  private phase: ActionPhase = 'idle';
  private elapsed = 0;
  private cancelElapsed = 0;
  private transitionElapsed = 0;
  private transitionDuration = 0;
  private transitionFromAction: ActionName | null = null;
  private transitionFromPose: NumberRecord = copyNumbers(ZERO_POSE);
  private transitionFromFace: NumberRecord = copyNumbers(NEUTRAL_FACE);
  private cancelling = false;
  private paused = false;
  private currentPose: NumberRecord = copyNumbers(ZERO_POSE);
  private currentFace: NumberRecord = copyNumbers(NEUTRAL_FACE);
  /** Keep the legacy face channels visible for the inbound chew crossfade. */
  private legacyFaceTransition = false;

  start(request: ActionStartRequest): ActionSnapshot {
    const action = extractActionName(request);
    const previousAction = this.action;
    const previousTransitionAction = this.transitionFromAction;
    const legacyFaceTransition = isChewAction(action) && (
      this.legacyFaceTransition
      || (!this.cancelling && previousAction !== null && !isChewAction(previousAction))
      || (this.cancelling && previousTransitionAction !== null && !isChewAction(previousTransitionAction))
    );
    this.transitionFromAction = this.cancelling ? this.transitionFromAction : this.action;
    this.transitionFromPose = copyNumbers(this.currentPose);
    this.transitionFromFace = copyNumbers(this.currentFace);
    this.transitionElapsed = 0;
    this.transitionDuration = CROSSFADE_SECONDS;
    this.action = action;
    this.phase = 'enter';
    this.elapsed = 0;
    this.cancelElapsed = 0;
    this.cancelling = false;
    this.legacyFaceTransition = legacyFaceTransition;
    return this.snapshot();
  }

  cancel(): ActionSnapshot {
    if (!this.action && !this.cancelling) return this.snapshot();
    this.transitionFromAction = this.action ?? this.transitionFromAction;
    this.transitionFromPose = copyNumbers(this.currentPose);
    this.transitionFromFace = copyNumbers(this.currentFace);
    this.transitionElapsed = 0;
    this.transitionDuration = CANCEL_SECONDS;
    this.cancelElapsed = 0;
    this.cancelling = true;
    this.phase = 'cancel';
    return this.snapshot();
  }

  reset(): ActionSnapshot {
    this.action = null;
    this.phase = 'idle';
    this.elapsed = 0;
    this.cancelElapsed = 0;
    this.transitionElapsed = 0;
    this.transitionDuration = 0;
    this.transitionFromAction = null;
    this.transitionFromPose = copyNumbers(ZERO_POSE);
    this.transitionFromFace = copyNumbers(NEUTRAL_FACE);
    this.cancelling = false;
    this.legacyFaceTransition = false;
    this.paused = false;
    this.currentPose = copyNumbers(ZERO_POSE);
    this.currentFace = copyNumbers(NEUTRAL_FACE);
    return this.snapshot();
  }

  update(deltaSeconds: number, paused?: ActionPauseArgument): ActionSnapshot {
    this.paused = pausedValue(paused);
    const delta = safeDelta(deltaSeconds);
    if (this.paused || delta === 0) return this.snapshot();

    if (this.cancelling) {
      this.cancelElapsed += delta;
      this.transitionElapsed = Math.min(this.transitionDuration, this.transitionElapsed + delta);
      if (this.cancelElapsed >= CANCEL_SECONDS) {
        this.action = null;
        this.phase = 'idle';
        this.cancelling = false;
        this.currentPose = copyNumbers(ZERO_POSE);
        this.currentFace = copyNumbers(NEUTRAL_FACE);
        this.transitionElapsed = 0;
        this.transitionDuration = 0;
        this.transitionFromAction = null;
        this.legacyFaceTransition = false;
      } else {
        this.refreshCurrentValues();
      }
      return this.snapshot();
    }

    if (!this.action) return this.snapshot();
    this.elapsed += delta;
    this.transitionElapsed = Math.min(this.transitionDuration, this.transitionElapsed + delta);
    if (this.elapsed >= ACTION_SECONDS) {
      this.action = null;
      this.phase = 'idle';
      this.currentPose = copyNumbers(ZERO_POSE);
      this.currentFace = copyNumbers(NEUTRAL_FACE);
      this.transitionElapsed = 0;
      this.transitionDuration = 0;
      this.transitionFromAction = null;
      this.legacyFaceTransition = false;
    } else {
      this.phase = phaseFor(this.elapsed);
      this.refreshCurrentValues();
      if (this.action !== null && isChewAction(this.action)
        && this.transitionElapsed >= this.transitionDuration) {
        this.legacyFaceTransition = false;
      }
    }
    return this.snapshot();
  }

  snapshot(): ActionSnapshot {
    const transitionActive = this.transitionDuration > 0
      && this.transitionElapsed < this.transitionDuration;
    const transitionProgress = transitionActive
      ? clamp01(this.transitionElapsed / this.transitionDuration)
      : 0;
    const progress = this.cancelling
      ? 1 - smoothstep(this.cancelElapsed / CANCEL_SECONDS)
      : this.action ? amountFor(this.action, this.elapsed) : 0;
    const transition: ActionTransition = Object.freeze({
      active: transitionActive,
      progress: finite(transitionProgress),
      fromAction: transitionActive ? this.transitionFromAction : null,
      toAction: transitionActive && !this.cancelling ? this.action : null,
    });
    return Object.freeze({
      schema: 'hikari-action-controller/v1' as const,
      active: this.action !== null || this.cancelling,
      action: this.action,
      phase: this.phase,
      elapsed: finite(this.cancelling ? this.cancelElapsed : this.elapsed),
      duration: this.cancelling ? CANCEL_SECONDS : this.action ? ACTION_SECONDS : 0,
      progress: finite(progress),
      paused: this.paused,
      transition,
      prePhysicsPose: makeIntentMap(this.currentPose, POSE_BLENDS),
      postExpressionFace: makeIntentMap(this.visibleFaceValues(), this.visibleFaceBlends()),
    });
  }

  private visibleFaceValues(): NumberRecord {
    const ids = this.shouldRetainLegacyFace()
      ? ACTION_FACE_IDS
      : this.action !== null && isChewAction(this.action)
        ? CHEW_ACTION_PARAMETER_IDS
        : FACE_IDS;
    const values: NumberRecord = {};
    for (const id of ids) values[id] = finite(this.currentFace[id]);
    return values;
  }

  private visibleFaceBlends(): Readonly<BlendRecord> {
    if (this.shouldRetainLegacyFace()) return CHEW_TRANSITION_FACE_BLENDS;
    if (this.action !== null && isChewAction(this.action)) return CHEW_FACE_BLENDS;
    return FACE_BLENDS;
  }

  private shouldRetainLegacyFace(): boolean {
    return this.action !== null && isChewAction(this.action) && this.legacyFaceTransition;
  }

  private refreshCurrentValues(): void {
    if (this.cancelling) {
      const amount = smoothstep(this.cancelElapsed / CANCEL_SECONDS);
      this.currentPose = interpolate(this.transitionFromPose, ZERO_POSE, amount);
      this.currentFace = interpolate(this.transitionFromFace, NEUTRAL_FACE, amount);
      return;
    }
    if (!this.action) {
      this.currentPose = copyNumbers(ZERO_POSE);
      this.currentFace = copyNumbers(NEUTRAL_FACE);
      return;
    }
    const target = targetValues(this.action, this.elapsed);
    const transitionAmount = smoothstep(this.transitionElapsed / this.transitionDuration);
    this.currentPose = interpolate(this.transitionFromPose, target.pose, transitionAmount);
    this.currentFace = interpolate(this.transitionFromFace, target.face, transitionAmount);
  }
}

export const createActionController = (): ActionController => new ActionController();

export const ACTION_TIMING = Object.freeze({
  enterSeconds: ENTER_SECONDS,
  holdSeconds: HOLD_SECONDS,
  exitSeconds: EXIT_SECONDS,
  actionSeconds: ACTION_SECONDS,
  crossfadeSeconds: CROSSFADE_SECONDS,
  cancelSeconds: CANCEL_SECONDS,
});
