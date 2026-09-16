import type { CubismModel } from '@framework/model/cubismmodel';

export type RuntimeParameterDefinition = {
  id:string;
  index:number;
  minimum:number;
  defaultValue:number;
  maximum:number;
};

export type RuntimeSemanticBindingStatus = 'ID_PRESENT_BINDING_UNVERIFIED'|'MISSING';
export type RuntimeSemanticBinding = {
  key:string;
  id:string;
  status:RuntimeSemanticBindingStatus;
};

export type RuntimeCapabilitiesSnapshot = {
  schema:'hikari-runtime-capabilities/v1';
  modelFile:string;
  parameterCount:number;
  parameters:RuntimeParameterDefinition[];
  semanticBindings:RuntimeSemanticBinding[];
};

export type RuntimeDebugControlState = {
  idleEnabled:boolean;
  physicsEnabled:boolean;
  blinkEnabled:boolean;
  expressionEnabled:boolean;
  rawNativeGaze:boolean;
};

export type RuntimeDebugControlPatch = Partial<RuntimeDebugControlState> & Partial<{
  idle:boolean;
  physics:boolean;
  blink:boolean;
  expression:boolean;
}>;

export type RuntimeDrawFrameTelemetry = {
  drawCount:number;
  timestamps:number[];
  intervals:number[];
  meanInterval:number|null;
  minInterval:number|null;
  maxInterval:number|null;
};

export type RuntimeOverrideResult = {
  requested:Record<string,number>;
  applied:Record<string,number>;
  readback:Record<string,number>;
};

const semanticBindings:Array<{key:string;id:string}> = [
  {key:'headAngleX',id:'ParamAngleX'},
  {key:'headAngleY',id:'ParamAngleY'},
  {key:'headAngleZ',id:'ParamAngleZ'},
  {key:'bodyAngleX',id:'ParamBodyAngleX'},
  {key:'bodyAngleY',id:'ParamBodyAngleY'},
  {key:'bodyAngleZ',id:'ParamBodyAngleZ'},
  {key:'gazeX',id:'ParamEyeBallX'},
  {key:'gazeY',id:'ParamEyeBallY'},
  {key:'leftEyeOpen',id:'ParamEyeLOpen'},
  {key:'rightEyeOpen',id:'ParamEyeROpen'},
  {key:'leftEarPose',id:'ParamEarLAngle'},
  {key:'rightEarPose',id:'ParamEarRAngle'},
  {key:'leftEarTwitch',id:'ParamEarLTwitch'},
  {key:'rightEarTwitch',id:'ParamEarRTwitch'},
  {key:'mouthForm',id:'ParamMouthForm'},
  {key:'mouthOpenY',id:'ParamMouthOpenY'},
  {key:'mouthPucker',id:'ParamMouthPucker'},
  {key:'mouthCornerRaiseR',id:'ParamMouthCornerRaiseR'},
  {key:'symmetricCheekPuff',id:'ParamCheekPuff'},
  {key:'leftCheekPuff',id:'ParamCheekPuffL'},
  {key:'rightCheekPuff',id:'ParamCheekPuffR'},
  {key:'leftShoulderLift',id:'ParamShoulderLiftL'},
  {key:'rightShoulderLift',id:'ParamShoulderLiftR'},
  {key:'shoulderCompress',id:'ParamShoulderCompress'},
  {key:'leftElbowCurl',id:'ParamElbowCurlL'},
  {key:'rightElbowCurl',id:'ParamElbowCurlR'},
  {key:'leftWristAngle',id:'ParamWristAngleL'},
  {key:'rightWristAngle',id:'ParamWristAngleR'},
  {key:'leftHandPose',id:'ParamHandPoseL'},
  {key:'rightHandPose',id:'ParamHandPoseR'},
  {key:'handPose',id:'ParamHandPose'},
  {key:'leftArmSway',id:'ParamArmSwayL'},
  {key:'rightArmSway',id:'ParamArmSwayR'},
  {key:'outfit',id:'ParamOutfit'},
];

const clamp=(value:number,minimum:number,maximum:number)=>Math.max(minimum,Math.min(maximum,value));
const isObject=(value:unknown):value is Record<string,unknown> =>
  typeof value==='object'&&value!==null&&!Array.isArray(value);

/** The actual parameter metadata exposed by the loaded Cubism model. */
export class RuntimeParameterRegistry {
  readonly modelFile:string;
  readonly definitions:RuntimeParameterDefinition[];
  private readonly byId:Map<string,RuntimeParameterDefinition>;
  private readonly semanticBindings:RuntimeSemanticBinding[];

  constructor(modelFile:string,definitions:RuntimeParameterDefinition[]){
    this.modelFile=modelFile;
    this.definitions=definitions;
    this.byId=new Map<string,RuntimeParameterDefinition>();
    for(const definition of definitions){
      if(this.byId.has(definition.id))throw new Error(`duplicate Core parameter ID: ${definition.id}`);
      this.byId.set(definition.id,definition);
    }
    this.semanticBindings=semanticBindings.map(({key,id})=>({
      key,id,status:this.byId.has(id)?'ID_PRESENT_BINDING_UNVERIFIED':'MISSING',
    }));
  }

  static fromModel(model:CubismModel,modelFile:string):RuntimeParameterRegistry {
    const definitions:RuntimeParameterDefinition[]=[];
    for(let index=0;index<model.getParameterCount();index++){
      const id=model.getParameterId(index).getString();
      const minimum=model.getParameterMinimumValue(index);
      const defaultValue=model.getParameterDefaultValue(index);
      const maximum=model.getParameterMaximumValue(index);
      if(!id||!Number.isFinite(minimum)||!Number.isFinite(defaultValue)||!Number.isFinite(maximum)||
        minimum>maximum||defaultValue<minimum||defaultValue>maximum){
        throw new Error(`Core parameter metadata is invalid for index ${index}`);
      }
      definitions.push({id,index,minimum,defaultValue,maximum});
    }
    return new RuntimeParameterRegistry(modelFile,definitions);
  }

  getDefinitions():RuntimeParameterDefinition[] {
    return this.definitions.map(definition=>({...definition}));
  }

  getDefinition(id:string):RuntimeParameterDefinition|undefined {
    const definition=this.byId.get(id);
    return definition?{...definition}:undefined;
  }

  has(id:string):boolean {
    return this.byId.has(id);
  }

  clampValue(id:string,value:number):number {
    const definition=this.byId.get(id);
    if(!definition)throw new Error(`unknown Core parameter ID: ${id}`);
    if(typeof value!=='number'||!Number.isFinite(value)){
      throw new TypeError(`parameter ${id} value must be finite`);
    }
    return clamp(value,definition.minimum,definition.maximum);
  }

  read(model:CubismModel):Record<string,number> {
    const values:Record<string,number>={};
    for(const definition of this.definitions){
      values[definition.id]=model.getParameterValueByIndex(definition.index);
    }
    return values;
  }

  snapshot():RuntimeCapabilitiesSnapshot {
    return {
      schema:'hikari-runtime-capabilities/v1',
      modelFile:this.modelFile,
      parameterCount:this.definitions.length,
      parameters:this.getDefinitions(),
      semanticBindings:this.semanticBindings.map(binding=>({...binding})),
    };
  }
}

/** DEV-only switches and final parameter overrides used by the QA handle. */
export class RuntimeDebugController {
  readonly registry:RuntimeParameterRegistry;
  private controls:RuntimeDebugControlState={
    idleEnabled:true,
    physicsEnabled:true,
    blinkEnabled:true,
    expressionEnabled:true,
    rawNativeGaze:false,
  };
  private overrides=new Map<string,number>();

  constructor(registry:RuntimeParameterRegistry){
    this.registry=registry;
  }

  getControls():RuntimeDebugControlState {
    return {...this.controls};
  }

  setControls(patch:RuntimeDebugControlPatch):RuntimeDebugControlState {
    if(!isObject(patch))throw new TypeError('debug controls must be an object');
    const input=patch as Record<string,unknown>;
    const allowed=new Set([
      'idleEnabled','physicsEnabled','blinkEnabled','expressionEnabled','rawNativeGaze',
      'idle','physics','blink','expression',
    ]);
    for(const key of Object.keys(patch)){
      if(!allowed.has(key))throw new Error(`unknown debug control: ${key}`);
      if(typeof input[key]!=='boolean')throw new TypeError(`debug control ${key} must be boolean`);
    }
    const next={...this.controls};
    const aliases:{[key:string]:keyof RuntimeDebugControlState}={
      idle:'idleEnabled',
      physics:'physicsEnabled',
      blink:'blinkEnabled',
      expression:'expressionEnabled',
    };
    for(const key of Object.keys(patch)){
      const target=aliases[key]??key as keyof RuntimeDebugControlState;
      next[target]=input[key] as boolean;
    }
    this.controls=next;
    return this.getControls();
  }

  setParameterOverrides(values:Record<string,number>):RuntimeOverrideResult {
    if(!isObject(values))throw new TypeError('parameter overrides must be an object');
    const requested:Record<string,number>={};
    const applied:Record<string,number>={};
    const next=new Map(this.overrides);
    for(const id of Object.keys(values)){
      if(!this.registry.has(id))throw new Error(`unknown Core parameter ID: ${id}`);
      const value=values[id];
      if(typeof value!=='number'||!Number.isFinite(value)){
        throw new TypeError(`parameter ${id} value must be finite`);
      }
      requested[id]=value;
      applied[id]=this.registry.clampValue(id,value);
      next.set(id,applied[id]);
    }
    this.overrides=next;
    return {requested,applied,readback:{}};
  }

  clearParameterOverrides():void {
    this.overrides.clear();
  }

  getParameterOverrides():Record<string,number> {
    return Object.fromEntries(this.overrides.entries());
  }

  applyFinalOverrides(model:CubismModel):Record<string,number> {
    for(const [id,value] of this.overrides){
      const definition=this.registry.getDefinition(id);
      if(definition)model.setParameterValueByIndex(definition.index,value);
    }
    const readback:Record<string,number>={};
    for(const id of this.overrides.keys()){
      const definition=this.registry.getDefinition(id);
      if(definition)readback[id]=model.getParameterValueByIndex(definition.index);
    }
    return readback;
  }

  reset():RuntimeDebugControlState {
    this.controls={
      idleEnabled:true,
      physicsEnabled:true,
      blinkEnabled:true,
      expressionEnabled:true,
      rawNativeGaze:false,
    };
    this.overrides.clear();
    return this.getControls();
  }
}
