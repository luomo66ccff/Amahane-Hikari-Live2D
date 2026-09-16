import { getFrameTiming } from './frame-timing';
import { withTimeout } from './async-utils';
import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { CubismShaderManager_WebGL } from '@framework/rendering/cubismshader_webgl';
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager';
import { CubismRenderer_WebGL } from '@framework/rendering/cubismrenderer_webgl';
import { HikariPresentation } from './presentation';
import { SecondaryMotionController, secondaryMotionChannels, addSecondaryMotion } from './secondary-motion';
import {
  RuntimeDebugController,
  RuntimeParameterRegistry,
  type RuntimeCapabilitiesSnapshot,
  type RuntimeDebugControlPatch,
  type RuntimeDebugControlState,
  type RuntimeDrawFrameTelemetry,
  type RuntimeOverrideResult,
} from './runtime-capabilities';

import { PresenceController, type AutonomousCue, type PresenceOutput } from './presence';
import { ExpressiveRebound } from './expressive-rebound';
import {
  ACTION_NAMES,
  ActionController,
  CHEW_ACTION_NAMES,
  CHEW_ACTION_PARAMETER_IDS,
  getActionRequiredParameterIds,
  type ActionName,
  type ActionSnapshot,
  type ParameterIntentMap,
} from './action-controller';

const base = import.meta.env.BASE_URL;
const shaderPath = `${base}vendor/shaders/`;
const productionModelBase = `${base}model/hikari_t002/`;
const productionModelFile = 'SuJiangXue_HikariSmirk_t001.model3.json';
const outputIds = ['ParamEarLPhysics','ParamEarRPhysics','ParamAhogeMid','ParamAhogeTip','ParamHairFront','ParamHairSideL','ParamHairBackUpper','ParamHairBackMid','ParamHairBackTip','ParamRibbonHead','ParamChainHead','ParamRibbonBody','ParamChainBody','ParamHairSideR','ParamClothSway','ParamArmSwayL','ParamArmSwayR'];
const clamp = (value:number, low:number, high:number) => Math.max(low,Math.min(high,value));
const smoothstep = (value:number):number => {
  const t=clamp(value,0,1);
  return t*t*(3-2*t);
};
const GENTLE_SHOULDER_LIMIT=.035;
const GENTLE_PHYSICAL_ARM_LIMIT=.04;
const GENTLE_PHYSICAL_ARM_GAIN=.028;
const GENTLE_SHOULDER_IDS=['ParamShoulderLiftL','ParamShoulderLiftR'] as const;
const isChewAction=(name:ActionName):boolean=>(CHEW_ACTION_NAMES as readonly string[]).includes(name);
// The public UI action contract currently exposes the three authored
// interaction actions.  Chew remains available through the explicit action
// API and its DEV QA boundary, but is not advertised as a UI capability.
const SUPPORTED_ACTION_NAMES:readonly ActionName[]=Object.freeze([...ACTION_NAMES]);
const GENTLE_NEUTRAL_ARM_IDS=[
  'ParamElbowCurlL','ParamElbowCurlR','ParamWristAngleL','ParamWristAngleR',
  'ParamHandPoseL','ParamHandPoseR','ParamHandPose',
] as const;
const GENTLE_PHYSICAL_ARM_IDS=['ParamArmSwayL','ParamArmSwayR'] as const;
export type OutfitValue = 0 | 1 | 2;
export type HikariStageOptions = {
  /** The hook must opt in explicitly; production never exposes debug controls. */
  debugEnabled?: boolean;
  /** DEV-only model3 path relative to the same compiled base path. */
  model3Path?: string;
};
export type MouthInput = Readonly<{
  open:number;
  form?:number;
  pucker?:number;
  ttlMs?:number;
}>;
type ActiveMouthInput = {
  open:number;
  form?:number;
  pucker?:number;
  expiresAt:number;
};
const MOUTH_INPUT_DEFAULT_TTL_MS=180;
const MOUTH_INPUT_MIN_TTL_MS=1;
const MOUTH_INPUT_MAX_TTL_MS=1000;
const MOUTH_INPUT_KEYS=['open','form','pucker','ttlMs'] as const;
const MOTION_DIAGNOSTIC_PARAMETER_IDS = [
  'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeLSmile', 'ParamEyeRSmile',
  'ParamMouthForm', 'ParamMouthOpenY', 'ParamBrowLY', 'ParamBrowRY',
  'ParamCheekPuff', 'ParamCheekPuffL', 'ParamCheekPuffR', 'ParamMouthPucker',
  'ParamMouthCornerRaiseR',
  'ParamEarLTwitch', 'ParamEarRTwitch',
  'ParamEyeBallX', 'ParamEyeBallY',
] as const;
type MotionDiagnosticParameterValue = number|null;
type MotionDiagnosticCue = {
  active:boolean;
  mouthForm:number;
  gazeX:number;
};
export type RuntimeMotionDiagnosticFrame = {
  sequence:number;
  timeMs:number;
  runtimeElapsed:number;
  paused:boolean;
  controls:RuntimeDebugControlState;
  rawPresenceCue:MotionDiagnosticCue|null;
  effectiveAutonomousCue:MotionDiagnosticCue;
  effectiveCueApplied:boolean;
  frameBlink:number;
  suppression:{
    suppressAutonomousUntilCueInactive:boolean;
    autoCueSuppressed:boolean;
    selectedExpression:string;
  };
  action:Pick<ActionSnapshot,'active'|'action'|'phase'|'elapsed'|'progress'|'paused'>;
  rebound:{
    updateCalled:boolean;
    enabled:boolean;
    automaticSmile:number;
    outputs:Record<string,number>;
    appliedReadback:Record<string,MotionDiagnosticParameterValue>;
  };
  pendingGreeting:boolean;
  postWriteParameters:Record<string,MotionDiagnosticParameterValue>;
  nonFiniteParameterIds:string[];
};
export type RuntimeMotionDiagnostics = {
  schema:'hikari-runtime-motion-diagnostics/v1';
  latest:RuntimeMotionDiagnosticFrame|null;
  greetingRequestCount:number;
  lastGreetingRequest:{
    timeMs:number;
    runtimeElapsed:number;
    action:ActionName|null;
    phase:ActionSnapshot['phase'];
    selectedExpression:string;
    autoCueSuppressed:boolean;
  }|null;
};
type References = {Moc:string; Physics?:string; Textures:string[]; Expressions?:{Name:string;File:string}[]};

const resolveDevModelPath = (candidate:string):{base:string;file:string} => {
  if(typeof candidate!=='string'||!candidate.trim())throw new TypeError('QA model3 path must be a non-empty string');
  let url:URL;
  const baseUrl=new URL(base,window.location.href);
  try{url=new URL(candidate,baseUrl);}
  catch{throw new Error('QA model3 path is not a valid same-origin URL');}
  if(url.origin!==window.location.origin)throw new Error('QA model3 path must stay on the current origin');
  if(url.search||url.hash)throw new Error('QA model3 path must not contain a query or fragment');
  const basePath=baseUrl.pathname.endsWith('/')?baseUrl.pathname:`${baseUrl.pathname}/`;
  if(!url.pathname.startsWith(basePath))throw new Error('QA model3 path must stay under the compiled base path');
  const relative=decodeURIComponent(url.pathname.slice(basePath.length));
  if(!relative||relative.includes('..')||relative.startsWith('/')||!relative.endsWith('.model3.json')){
    throw new Error('QA model3 path must be a relative .model3.json file under the compiled base path');
  }
  const slash=relative.lastIndexOf('/');
  return {base:`${base}${relative.slice(0,slash+1)}`,file:relative.slice(slash+1)};
};

/** Single-model renderer; the loaded model supplies its expressions and physics. */
export class HikariStage extends CubismUserModel {
  private gl:WebGL2RenderingContext;
  private readonly debugEnabled:boolean;
  private readonly modelBase:string;
  private readonly modelFile:string;
  private abort = new AbortController();
  private expressions = new Map<string,ACubismMotion>();
  private textures:WebGLTexture[] = [];
  private textureCache:Promise<Cache|null>|undefined;
  private indices = new Map<string,number>();
  private defaults:number[] = [];
  private frozenPhysics:number[] = [];
  private frame = 0;
  private lastTime:number|null = null;
  private elapsed = 0;
  private secondaryMotion = new SecondaryMotionController();
  private nextBlink = 3.5;
  private selectedAt = 0;
  private selected = 'Neutral';
  // Automatic face cues are permitted only for the initial/internal Neutral
  // state. Any public expression selection takes priority until reset().
  private autoCueSuppressed = false;
  private lastAutonomousCue:AutonomousCue = {active:false,mouthForm:0,gazeX:0};
  // A paused frame must be a visual snapshot of the last active frame. The
  // older lastBase array intentionally contains only pre-expression values,
  // so it cannot preserve a selected expression, blink, or an active face cue.
  private frozenParameters:number[] = [];
  private pointer = {x:0,y:0};
  private look = {x:0,y:0};
  private presence = new PresenceController();
  private expressiveRebound = new ExpressiveRebound();
  private actionController = new ActionController();
  private suppressAutonomousUntilCueInactive = false;
  private cursor:{x:number;y:number}|null=null;
  private presentation:HikariPresentation|null=null;
  private paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private follow = true;
  private zoom = 1;
  private pan = {x:0,y:0};
  private moveMode = false;
  private contacts = new Map<number,{x:number;y:number}>();
  private gesture:{x:number;y:number;panX:number;panY:number;distance:number;zoom:number}|null = null;
  private press:{id:number;x:number;y:number;moved:boolean}|null = null;
  private ready = false;
  private destroyed = false;
  // The production UI mirrors its initial Neutral selection through the
  // public expression callback after mount. The renderer fixture has no
  // showcase root, so a later fixture/user Neutral remains a real choice.
  private initialNeutralSyncPending = false;
  private bounds = {left:0,right:1,bottom:0,top:1};
  private resizeObserver:ResizeObserver;
  private lastBase:number[] = [];
  private outfit:OutfitValue = 0;
  private outfitIndex:number|undefined;
  private capabilities:RuntimeParameterRegistry|null=null;
  private debugController:RuntimeDebugController|null=null;
  private debugOverrideBase=new Map<string,number>();
  private debugActionReplaceBase=new Map<string,number>();
  private debugActionReplaceCancelBase=new Map<string,number>();
  private debugActionReplaceCancelActive=false;
  private debugActionReplaceActive=false;
  private debugActionBridgeBase=new Map<string,number>();
  private debugActionBridgeActive=false;
  private debugDrawTimestamps:number[]=[];
  private debugMotionSequence=0;
  private debugMotionLatest:RuntimeMotionDiagnosticFrame|null=null;
  private debugGreetingRequestCount=0;
  private debugLastGreetingRequest:RuntimeMotionDiagnostics['lastGreetingRequest']=null;
  private pendingGreeting=false;
  private activeMouthInput:ActiveMouthInput|null=null;
  constructor(private canvas:HTMLCanvasElement, private progress:(text:string)=>void, private failure:(text:string)=>void, options:HikariStageOptions={}) {
    super();
    this.debugEnabled=import.meta.env.DEV&&options.debugEnabled===true;
    const selectedModel=this.debugEnabled&&options.model3Path?resolveDevModelPath(options.model3Path):{base:productionModelBase,file:productionModelFile};
    this.modelBase=selectedModel.base;
    this.modelFile=selectedModel.file;
    this.initialNeutralSyncPending=canvas.closest('[data-showcase]')!==null;
    this.gl = canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if (!this.gl || this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)<8192) {
      throw new Error('当前设备暂时无法显示此模型。请尝试使用支持 WebGL 2 的浏览器或电脑打开。');
    }
    this.resizeObserver = new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('pointermove',this.onPointer);
    document.documentElement.addEventListener('pointerleave',this.onLeave);
    canvas.addEventListener('pointerdown',this.onPointerDown);
    document.addEventListener('pointerup',this.onPointerUp);
    document.addEventListener('pointercancel',this.onPointerCancel);
    canvas.addEventListener('lostpointercapture',this.onPointerCancel);
    canvas.addEventListener('wheel',this.onWheel,{passive:false});
    canvas.addEventListener('keydown',this.onKey);
    window.addEventListener('blur',this.onBlur);
    canvas.addEventListener('webglcontextlost',this.onContextLost);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.setMoveMode(false);
    this.setPosition(0,0);
  }
  static initialize():void {
    if (!CubismFramework.isStarted()) {
      const option = new Option();
      option.loggingLevel = LogLevel.LogLevel_Error;
      CubismFramework.startUp(option);
      CubismFramework.initialize();
    }
  }
  private getTextureCache():Promise<Cache|null> {
    // Only this immutable production route is eligible; DEV overrides bypass it.
    return this.textureCache??=this.modelBase===productionModelBase&&'caches' in globalThis
      ?Promise.resolve().then(()=>caches.open('hikari-textures-hikari_t002')).catch(():Cache|null=>null):Promise.resolve(null);
  }
  private async fetchFile(path:string):Promise<ArrayBuffer> {
    this.abort.signal.throwIfAborted();
    const url=this.modelBase+path;
    const cache=path.endsWith('.webp')?await this.getTextureCache():null;
    if(cache){
      try{
        const stored=await cache.match(url);
        if(stored){
          const bytes=await stored.arrayBuffer();
          this.abort.signal.throwIfAborted();
          return bytes;
        }
      }catch{this.abort.signal.throwIfAborted();}
    }
    const response = await fetch(url,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)])});
    if(!response.ok) throw new Error('模型资源加载失败，请检查网络后重新加载。');
    const bytes=await response.arrayBuffer();
    this.abort.signal.throwIfAborted();
    // Large entries can miss the HTTP cache even with a long max-age. Cache
    // Storage retains this 13 MB version explicitly; quota/disabled storage
    // falls back to the successful network result. Bad decodes are evicted.
    if(cache)await cache.put(url,new Response(bytes,{headers:{'Content-Type':'image/webp'}})).catch(()=>{});
    this.abort.signal.throwIfAborted();
    return bytes;
  }
  private async fetchTextures(paths:string[]):Promise<ArrayBuffer[]> {
    const buffers:ArrayBuffer[]=new Array(paths.length);
    let next=0,completed=0;
    // Bound downloads while retaining compressed bytes only. Decode and upload
    // one image at a time below, so eight large RGBA bitmaps never coexist.
    await Promise.all(Array.from({length:Math.min(3,paths.length)},async()=>{
      while(next<paths.length){
        const index=next++;
        buffers[index]=await this.fetchFile(paths[index]);
        this.progress(`正在读取高清材质 ${++completed} / ${paths.length}…`);
      }
    }));
    return buffers;
  }
  async mount():Promise<void> {
    this.progress('正在读取模型…');
    const file = await this.fetchFile(this.modelFile);
    const refs = (JSON.parse(new TextDecoder().decode(file)) as {FileReferences:References}).FileReferences;
    const expressions=refs.Expressions??[];
    const physicsReference=typeof refs.Physics==='string'?refs.Physics.trim():'';
    // SDK 5-r.5 does not reject unsuccessful shader fetches itself.
    const shaderFiles=['vertshadersrc.vert','vertshadersrcmasked.vert','vertshadersrcsetupmask.vert','fragshadersrcsetupmask.frag','fragshadersrcpremultipliedalpha.frag','fragshadersrcmaskpremultipliedalpha.frag','fragshadersrcmaskinvertedpremultipliedalpha.frag','vertshadersrccopy.vert','fragshadersrccopy.frag','fragshadersrccolorblend.frag','fragshadersrcalphablend.frag','vertshadersrcblend.vert','fragshadersrcpremultipliedalphablend.frag'];
    this.progress('正在加载模型与高清材质…');
    // All promises have a rejection handler immediately; a failed mount is
    // destroyed by main.ts, aborting the remaining requests before a retry.
    const [textureBytes,moc,physics,expressionBytes]=await Promise.all([
      this.fetchTextures(refs.Textures),
      this.fetchFile(refs.Moc),
      physicsReference?this.fetchFile(physicsReference):Promise.resolve(null),
      Promise.all(expressions.map(expression=>this.fetchFile(expression.File))),
      Promise.all(shaderFiles.map(async name=>{
        const response=await fetch(shaderPath+name,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)])});
        if(!response.ok||!(await response.text()).trim())throw new Error('舞台资源加载失败，请重新加载。');
      })),
    ]);
    this.abort.signal.throwIfAborted();
    this.loadModel(moc,true);
    if (!this._model) throw new Error('模型未能打开，请重新加载。');
    for(let i=0;i<this._model.getParameterCount();i++) {
      this.indices.set(this._model.getParameterId(i).getString(),i);
      this.defaults.push(this._model.getParameterDefaultValue(i));
    }
    for(const id of outputIds){
      const index=this.indices.get(id);
      if(index===undefined||this._model.getParameterMinimumValue(index)!==-1||this._model.getParameterMaximumValue(index)!==1){
        throw new Error('模型的动态参数不完整，请重新加载模型资源。');
      }
    }
    if(this.debugEnabled){
      this.capabilities=RuntimeParameterRegistry.fromModel(this._model,this.modelBase+this.modelFile);
      this.debugController=new RuntimeDebugController(this.capabilities);
    }
    this.outfitIndex=this.indices.get('ParamOutfit');
    if(this.outfitIndex===undefined) throw new Error('换装模型缺少 ParamOutfit 参数，请重新加载。');
    const outfitMinimum=this._model.getParameterMinimumValue(this.outfitIndex);
    const outfitDefault=this._model.getParameterDefaultValue(this.outfitIndex);
    const outfitMaximum=this._model.getParameterMaximumValue(this.outfitIndex);
    if(outfitMinimum!==0||outfitDefault!==0||outfitMaximum!==2) {
      throw new Error('换装模型的 ParamOutfit 范围无效，请重新加载。');
    }
    this.applyOutfit();
    expressions.forEach((expression,index)=>{
      const bytes=expressionBytes[index];
      this.expressions.set(expression.Name,this.loadExpression(bytes,bytes.byteLength,expression.Name));
    });
    if(physics)this.loadPhysics(physics,physics.byteLength);
    this.resize();
    this.createRenderer(this.canvas.width,this.canvas.height,1);
    const renderer = this.getRenderer();
    renderer.startUp(this.gl);
    renderer.setIsPremultipliedAlpha(true);
    for(let i=0;i<refs.Textures.length;i++) {
      this.progress(`正在绘制高清材质 ${i+1} / ${refs.Textures.length}…`);
      const type=refs.Textures[i].endsWith('.webp')?'image/webp':'image/png';
      const url=URL.createObjectURL(new Blob([textureBytes[i]],{type}));
      textureBytes[i]=new ArrayBuffer(0);
      const img=new Image();
      let decoded=false;
      try {
        img.src=url;
        await withTimeout(()=>img.decode(),20000,'高清材质加载超时，请重新加载。',this.abort.signal);
        decoded=true;
        if(this.destroyed) return;
        const gl=this.gl;
        const texture=gl.createTexture();
        if(!texture)throw new Error('无法分配模型材质，请关闭其他标签页后重试。');
        // Track ownership before upload so destroy() also releases failed uploads.
        this.textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D,null);
        renderer.bindTexture(i,texture);
      } catch(error) {
        if(!decoded){
          const cache=await this.getTextureCache();
          await cache?.delete(this.modelBase+refs.Textures[i]).catch(()=>false);
        }
        throw error;
      } finally { URL.revokeObjectURL(url); img.src=''; }
    }
    this.progress('正在准备舞台…');
    renderer.loadShaders(shaderPath);
    const started=performance.now();
    while(!CubismShaderManager_WebGL.getInstance().getShader(this.gl)._isShaderLoaded) {
      if(this.destroyed) return;
      if(performance.now()-started>20000) throw new Error('画面初始化超时，请重新加载。');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const shader=CubismShaderManager_WebGL.getInstance().getShader(this.gl);
    // 5-r.5 reserves three unused Normal/Over slots at the array tail.
    if(!shader._shaderSets.slice(0,-3).every(set=>set?.shaderProgram&&this.gl.getProgramParameter(set.shaderProgram,this.gl.LINK_STATUS))) {
      throw new Error('浏览器未能初始化画面，请尝试更新浏览器。');
    }
    // ParamOutfit must be applied before the first update and before measuring
    // the drawable bounds, so the initial frame is already the chosen outfit.
    this.applyOutfit();
    this._model.update();
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for(let i=0;i<this._model.getDrawableCount();i++) {
      if(this._model.getDrawableOpacity(i)<=0) continue;
      const vertices=this._model.getDrawableVertices(i);
      for(let j=0;j<vertices.length;j+=2) {
        left=Math.min(left,vertices[j]); right=Math.max(right,vertices[j]);
        bottom=Math.min(bottom,vertices[j+1]); top=Math.max(top,vertices[j+1]);
      }
    }
    this.bounds={left,right,bottom,top};
    this.presentation=new HikariPresentation(this._model,this.bounds);
    this.presentation.setRawNativeGaze(this.debugController?.getControls().rawNativeGaze??false);
    this.lastBase=[...this.defaults];
    if(this.outfitIndex!==undefined)this.lastBase[this.outfitIndex]=this.outfit;
    this.frozenParameters=[...this.lastBase];
    this.ready=true;
    this.applyExpression('Neutral');
    this.frame=requestAnimationFrame(this.tick);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    if(this.gl.getError()!==this.gl.NO_ERROR) throw new Error('画面未能正确显示，请重新加载。');
    this.canvas.dataset.ready='true';
  }
  private applyExpression(name:string):void {
    const expression=this.expressions.get(name);
    if(!expression) return;
    this._expressionManager.startMotion(expression,false);
    this.selected=name;
    this.selectedAt=this.elapsed;
    this.canvas.dataset.expression=name;
  }
  setExpression(name:string):void {
    this.debugActionBridgeActive?this.captureActionBridgeBase():this.captureActionReplacementCancelBase();
    this.actionController.cancel();
    // Mark the choice before checking the expression map: an explicit choice
    // owns the face even when a stale/unknown name cannot be loaded.
    // main.ts mirrors its initial Neutral selection through this public
    // method after mount. Keep that one bootstrap sync internal; a later
    // user-selected Neutral still suppresses an automatic cue.
    const initialNeutralSync=this.initialNeutralSyncPending&&name==='Neutral'
      &&this.selected==='Neutral'&&!this.autoCueSuppressed;
    if(initialNeutralSync)this.initialNeutralSyncPending=false;
    else this.autoCueSuppressed=true;
    this.lastAutonomousCue={active:false,mouthForm:0,gazeX:0};
    this.expressiveRebound.reset();
    this.applyExpression(name);
  }

  /** Return the actual Core inventory only to an explicitly enabled DEV hook. */
  getRuntimeCapabilities():RuntimeCapabilitiesSnapshot|null {
    if(!this.debugEnabled||!this.capabilities)return null;
    return this.capabilities.snapshot();
  }

  getLoadedModelFile():string { return this.modelBase+this.modelFile; }

  getDebugControls():RuntimeDebugControlState|null {
    return this.debugController?.getControls()??null;
  }

  readDebugParameters():Record<string,number>|null {
    if(!this.debugController||!this._model)return null;
    return this.debugController.registry.read(this._model);
  }

  getDebugParameterOverrides():Record<string,number>|null {
    return this.debugController?.getParameterOverrides()??null;
  }

  /** Read the timestamps recorded immediately before each real drawModel call. */
  getDebugFrameTelemetry():RuntimeDrawFrameTelemetry|null {
    if(!this.debugEnabled)return null;
    const timestamps=this.debugDrawTimestamps.slice();
    const intervals=timestamps.slice(1).map((value,index)=>value-timestamps[index]);
    const sum=intervals.reduce((total,value)=>total+value,0);
    return {
      drawCount:timestamps.length,
      timestamps,
      intervals,
      meanInterval:intervals.length?sum/intervals.length:null,
      minInterval:intervals.length?Math.min(...intervals):null,
      maxInterval:intervals.length?Math.max(...intervals):null,
    };
  }

  clearDebugFrameTelemetry():void {
    if(this.debugEnabled)this.debugDrawTimestamps=[];
  }

  /**
   * Read only the DEV motion boundary.  This intentionally reports the raw
   * Presence cue and the values produced by the rebound layer separately from
   * the final model readback, so a QA caller cannot mistake a final override
   * for a blink or rebound contribution.
   */
  getDebugMotionDiagnostics():RuntimeMotionDiagnostics|null {
    if(!this.debugEnabled)return null;
    const latest=this.debugMotionLatest;
    return {
      schema:'hikari-runtime-motion-diagnostics/v1',
      latest:latest?{
        ...latest,
        controls:{...latest.controls},
        rawPresenceCue:latest.rawPresenceCue?{...latest.rawPresenceCue}:null,
        effectiveAutonomousCue:{...latest.effectiveAutonomousCue},
        suppression:{...latest.suppression},
        action:{...latest.action},
        rebound:{
          ...latest.rebound,
          outputs:{...latest.rebound.outputs},
          appliedReadback:{...latest.rebound.appliedReadback},
        },
        postWriteParameters:{...latest.postWriteParameters},
        nonFiniteParameterIds:[...latest.nonFiniteParameterIds],
      }:null,
      greetingRequestCount:this.debugGreetingRequestCount,
      lastGreetingRequest:this.debugLastGreetingRequest?{...this.debugLastGreetingRequest}:null,
    };
  }

  private readDebugMotionParameters(ids:readonly string[]):{
    values:Record<string,MotionDiagnosticParameterValue>;
    nonFiniteIds:string[];
  } {
    const values:Record<string,MotionDiagnosticParameterValue>={};
    const nonFiniteIds:string[]=[];
    if(!this._model)return {values,nonFiniteIds};
    for(const id of ids){
      const index=this.indices.get(id);
      if(index===undefined)continue;
      const value=this._model.getParameterValueByIndex(index);
      if(Number.isFinite(value))values[id]=value;
      else {values[id]=null;nonFiniteIds.push(id);}
    }
    return {values,nonFiniteIds};
  }

  private captureActionReplacementCancelBase():void {
    if(!this.debugActionReplaceActive||!this._model)return;
    const values=this.readChewParameterValues();
    if(values.length===CHEW_ACTION_PARAMETER_IDS.length){
      this.debugActionReplaceCancelBase=new Map(values);
      this.debugActionReplaceCancelActive=true;
    }else{
      this.debugActionReplaceCancelBase.clear();
      this.debugActionReplaceCancelActive=false;
    }
  }

  private readChewParameterValues():Array<[string,number]> {
    if(!this._model)return [];
    const values:Array<[string,number]>=[];
    for(const id of CHEW_ACTION_PARAMETER_IDS){
      const index=this.indices.get(id);
      if(index===undefined)continue;
      const value=this._model.getParameterValueByIndex(index);
      if(Number.isFinite(value))values.push([id,value]);
    }
    return values;
  }

  private captureActionBridgeBase():void {
    const values=this.readChewParameterValues();
    if(values.length===CHEW_ACTION_PARAMETER_IDS.length){
      this.debugActionBridgeBase=new Map(values);
      this.debugActionBridgeActive=true;
    }else{
      this.clearActionBridge();
    }
  }

  getSupportedActions():ActionName[] {
    if(!this._model)return [];
    return SUPPORTED_ACTION_NAMES.filter(name=>{
      try {
        return getActionRequiredParameterIds(name).every(id=>this.indices.has(id));
      } catch {
        return false;
      }
    });
  }

  startAction(name:ActionName):ActionSnapshot {
    if(!this.ready||!this._model)throw new Error('actions require a mounted model');
    const requiredIds=getActionRequiredParameterIds(name);
    for(const id of requiredIds){
      if(!this.indices.has(id))throw new Error('Action parameter missing from actual model: '+id);
    }
    const previous=this.actionController.snapshot();
    const transitioningFromChew=!isChewAction(name)&&previous.active&&previous.action!==null&&isChewAction(previous.action);
    const preservingChewBridge=!isChewAction(name)&&this.debugActionBridgeActive;
    const preserveExistingBridge=transitioningFromChew||preservingChewBridge;
    const chewBase=preserveExistingBridge?this.readChewParameterValues():[];
    if(preserveExistingBridge&&chewBase.length!==CHEW_ACTION_PARAMETER_IDS.length){
      throw new Error('Chew transition cannot read all actual model channels');
    }
    const replacementBase=isChewAction(name)?this.readChewParameterValues():[];
    if(isChewAction(name)&&replacementBase.length!==CHEW_ACTION_PARAMETER_IDS.length){
      throw new Error('Action parameter is non-finite in actual model');
    }
    this.pendingGreeting=false;
    this.actionController.start(name);
    if(isChewAction(name)){
      this.clearAllActionReplacement();
      this.debugActionReplaceBase=new Map(replacementBase);
      this.debugActionReplaceActive=true;
    }else if(chewBase.length){
      this.clearActionReplacement();
      this.debugActionBridgeBase=new Map(chewBase);
      this.debugActionBridgeActive=true;
    }else{
      this.clearAllActionReplacement();
    }
    this.suppressAutonomousUntilCueInactive=true;
    this.expressiveRebound.reset();
    this.lastAutonomousCue={active:false,mouthForm:0,gazeX:0};
    return this.actionController.update(0,this.paused);
  }

  /** DEV-only compatibility wrapper around the public action boundary. */
  startDebugAction(name:ActionName):ActionSnapshot {
    this.requireDebugController();
    return this.startAction(name);
  }

  cancelAction():ActionSnapshot {
    if(!this.ready||!this._model)throw new Error('actions require a mounted model');
    this.debugActionBridgeActive?this.captureActionBridgeBase():this.captureActionReplacementCancelBase();
    this.actionController.cancel();
    const action=this.actionController.update(0,this.paused);
    if(!action.active)this.clearAllActionReplacement();
    return action;
  }

  /** DEV-only compatibility wrapper around the public action boundary. */
  cancelDebugAction():ActionSnapshot {
    this.requireDebugController();
    return this.cancelAction();
  }

  readAction():ActionSnapshot { return this.actionController.snapshot(); }

  /** DEV-only compatibility wrapper around the public action boundary. */
  readDebugAction():ActionSnapshot {
    this.requireDebugController();
    return this.readAction();
  }

  setMouthInput(input:MouthInput|null):void {
    if(input===null){
      this.activeMouthInput=null;
      return;
    }
    if(typeof input!=='object'||Array.isArray(input)){
      throw new TypeError('mouth input must be an object or null');
    }
    const candidate=input as Record<string,unknown>;
    for(const key of Object.keys(candidate)){
      if(!(MOUTH_INPUT_KEYS as readonly string[]).includes(key)){
        throw new TypeError('unknown mouth input field: '+key);
      }
    }
    if(!Object.prototype.hasOwnProperty.call(candidate,'open')){
      throw new TypeError('mouth input open is required');
    }
    const readNormalized=(key:string,minimum:number,maximum:number):number=>{
      const value=candidate[key];
      if(typeof value!=='number'||!Number.isFinite(value)||value<minimum||value>maximum){
        throw new RangeError(`mouth input ${key} must be finite and within [${minimum},${maximum}]`);
      }
      return value;
    };
    const open=readNormalized('open',0,1);
    const form=Object.prototype.hasOwnProperty.call(candidate,'form')
      ?readNormalized('form',-1,1):undefined;
    const pucker=Object.prototype.hasOwnProperty.call(candidate,'pucker')
      ?readNormalized('pucker',0,1):undefined;
    const ttlMs=Object.prototype.hasOwnProperty.call(candidate,'ttlMs')
      ?readNormalized('ttlMs',MOUTH_INPUT_MIN_TTL_MS,MOUTH_INPUT_MAX_TTL_MS)
      :MOUTH_INPUT_DEFAULT_TTL_MS;
    this.activeMouthInput={
      open,
      ...(form===undefined?{}:{form}),
      ...(pucker===undefined?{}:{pucker}),
      expiresAt:performance.now()+ttlMs,
    };
  }

  private requireDebugController():RuntimeDebugController {
    if(!this.debugEnabled)throw new Error('debug controls are DEV-only');
    if(!this.debugController||!this._model)throw new Error('debug controls require a mounted model');
    return this.debugController;
  }

  setDebugControls(patch:RuntimeDebugControlPatch):RuntimeDebugControlState {
    const controller=this.requireDebugController();
    const before=controller.getControls();
    const state=controller.setControls(patch);
    if(!state.idleEnabled){
      this.presence.reset();
      this.lastAutonomousCue={active:false,mouthForm:0,gazeX:0};
      this.expressiveRebound.reset();
    }
    if(!state.physicsEnabled&&before.physicsEnabled){
      this.secondaryMotion.reset();
      this._physics?.stabilization(this._model);
    }
    if(!state.blinkEnabled&&before.blinkEnabled)this.nextBlink=this.elapsed+3.5;
    if(state.blinkEnabled&&!before.blinkEnabled)this.nextBlink=this.elapsed+3.5;
    if(!state.expressionEnabled&&before.expressionEnabled)this._expressionManager?.stopAllMotions();
    this.presentation?.setRawNativeGaze(state.rawNativeGaze);
    if(this.paused)this.renderDebugFrame();
    return state;
  }

  setDebugParameterOverrides(values:Record<string,number>):RuntimeOverrideResult {
    const controller=this.requireDebugController();
    const result=controller.setParameterOverrides(values);
    if(this._model){
      for(const id of Object.keys(result.applied)){
        if(this.debugOverrideBase.has(id))continue;
        const definition=controller.registry.getDefinition(id);
        if(definition)this.debugOverrideBase.set(id,this._model.getParameterValueByIndex(definition.index));
      }
    }
    const readback=this.applyDebugOverrides();
    if(this.paused)this.renderDebugFrame();
    return {...result,readback};
  }

  clearDebugParameterOverrides():void {
    const controller=this.requireDebugController();
    const baseValues=new Map(this.debugOverrideBase);
    controller.clearParameterOverrides();
    if(this.paused&&this._model){
      for(const [id,value] of baseValues){
        const definition=controller.registry.getDefinition(id);
        if(definition)this._model.setParameterValueByIndex(definition.index,value);
      }
      this.applyOutfit();
      this.enforceGentleArmBounds();
      this.renderDebugFrame();
    }
    this.debugOverrideBase.clear();
  }

  setPaused(paused:boolean):void {
    if(this.paused!==paused)this.lastTime=null;
    if(paused&&!this.paused&&this._model&&this.defaults.length){
      this.frozenParameters=Array.from({length:this.defaults.length},(_,index)=>this._model.getParameterValueByIndex(index));
    }
    this.paused=paused;
    this.actionController.update(0,paused);
    this.canvas.dataset.paused=String(paused);
  }
  greet():void {
    if(this.ready&&!this.paused){
      if(this.debugEnabled){
        const action=this.actionController.snapshot();
        this.debugGreetingRequestCount+=1;
        this.debugLastGreetingRequest={
          timeMs:performance.now(),
          runtimeElapsed:this.elapsed,
          action:action.action,
          phase:action.phase,
          selectedExpression:this.selected,
          autoCueSuppressed:this.autoCueSuppressed,
        };
      }
      this.debugActionBridgeActive?this.captureActionBridgeBase():this.captureActionReplacementCancelBase();
      const action=this.actionController.cancel();
      if(action.active){
        // A greeting requested while an action is cancelling must survive the
        // cancellation.  Presence/Rebound are triggered only after the
        // controller reports the real idle boundary below.
        this.pendingGreeting=true;
        return;
      }
      this.presence.triggerGreeting();this.expressiveRebound.trigger();
    }
  }
  setOutfit(value:OutfitValue):void {
    if(!Number.isInteger(value)||value<0||value>2)throw new RangeError('服装编号必须为 0、1 或 2。');
    this.outfit=value;
    this.canvas.dataset.outfit=String(value);
    if(this.outfitIndex!==undefined&&this.lastBase.length)this.lastBase[this.outfitIndex]=value;
    this.applyOutfit();
  }
  setFollow(enabled:boolean):void { this.follow=enabled; if(!enabled){this.pointer={x:0,y:0};this.cursor=null;} }
  setZoom(value:number):void { this.zoom=clamp(value,.85,1.6); this.canvas.dataset.zoom=String(this.zoom); }
  setMoveMode(enabled:boolean):void {
    this.cancelGesture();this.moveMode=enabled;
    this.canvas.dataset.moveMode=String(enabled);
    this.canvas.style.touchAction=enabled?'none':'pan-y';
  }
  setPosition(x:number,y:number):void {
    this.pan={x:clamp(x,-.35,.35),y:clamp(y,-.12,.35)};
    this.canvas.dataset.panX=this.pan.x.toFixed(4);this.canvas.dataset.panY=this.pan.y.toFixed(4);
  }
  reset():void {
    this.debugMotionSequence=0;
    this.debugMotionLatest=null;
    this.debugGreetingRequestCount=0;
    this.debugLastGreetingRequest=null;
    this.pendingGreeting=false;
    this.activeMouthInput=null;
    this.clearAllActionReplacement();
    this.debugController?.reset();
    this.debugOverrideBase.clear();
    this.presentation?.setRawNativeGaze(false);
    this.autoCueSuppressed=false;
    this.lastAutonomousCue={active:false,mouthForm:0,gazeX:0};
    this.setZoom(1);this.setPosition(0,0);this.setMoveMode(false);
    this.pointer={x:0,y:0};this.look={x:0,y:0};this.cursor=null;
    this.presence.reset();
    this.expressiveRebound.reset();
    this.actionController.reset();
    this.actionController.update(0,this.paused);
    this.suppressAutonomousUntilCueInactive=false;
    this.elapsed=0;this.lastTime=null;this.nextBlink=3.5;this.selectedAt=0;
    this.lastBase=[...this.defaults];this.frozenParameters=[...this.defaults];this.frozenPhysics=[];
    this.secondaryMotion.reset();
    if(this._model){
      for(let i=0;i<this.defaults.length;i++)this._model.setParameterValueByIndex(i,this.defaults[i]);
      // Reset the solver's particles and both interpolation snapshots too;
      // otherwise old hair inertia returns immediately after resuming.
      this._physics?.stabilization(this._model);
      this._expressionManager?.stopAllMotions();
    }
    this.setOutfit(0);
    this.frozenParameters=Array.from({length:this.defaults.length},(_,index)=>this._model?.getParameterValueByIndex(index)??this.defaults[index]);
    this.applyExpression('Neutral');
    if(this.ready&&this.paused){
      this.applyOutfit();
      this.enforceGentleArmBounds();
      this.applyDebugOverrides();
      this.renderDebugFrame();
    }
  }
  private projection():{sx:number;sy:number;tx:number;ty:number} {
    const b=this.bounds;
    const pixels=Math.min(this.canvas.width*.86/(b.right-b.left),this.canvas.height*.91/(b.top-b.bottom))*this.zoom;
    const sx=2*pixels/this.canvas.width,sy=2*pixels/this.canvas.height;
    const centerX=(b.left+b.right)/2,centerY=(b.bottom+b.top)/2+(this.zoom-1)*(b.top-b.bottom)*.28;
    const neutralTop=(b.top-centerY)*sy;
    const presentedTop=this.presentation?.bounds.top??b.top;
    // Preserve the requested pan while keeping a backward-leaning head in
    // view at high zoom; normal-size bends retain their visible depth shift.
    const headroom=Math.max(0,(presentedTop-centerY)*sy-Math.max(.96,neutralTop));
    return {sx,sy,tx:-centerX*sx+this.pan.x*2,ty:-centerY*sy-this.pan.y*2-headroom};
  }
  /** Transform the pointer with the same projection used to draw the model. */
  private focusAt(clientX:number,clientY:number):void {
    if(!this.follow||this.paused||!this.ready)return;
    this.cursor={x:clientX,y:clientY};
    this.updatePointerTarget(clientX,clientY);
  }
  private updatePointerTarget(clientX:number,clientY:number):void {
    const rect=this.canvas.getBoundingClientRect(),p=this.projection(),b=this.bounds;
    const origin=this.presentation?.gazeOrigin??{x:(b.left+b.right)/2,y:b.bottom+(b.top-b.bottom)*.8};
    const faceX=(origin.x*p.sx+p.tx+1)*rect.width/2+rect.left;
    const faceY=(1-(origin.y*p.sy+p.ty))*rect.height/2+rect.top;
    // Respond near the face, including looking up when the face is near the top.
    this.pointer={x:clamp((clientX-faceX)/(rect.width*.22),-1,1),y:clamp((faceY-clientY)/(rect.height*.22),-1,1)};
  }
  /** Visible mesh triangles provide hit regions without editing the model file. */
  hitArea(clientX:number,clientY:number):'head'|'body'|null {
    if(!this.ready)return null;
    const rect=this.canvas.getBoundingClientRect();
    if(clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom)return null;
    const p=this.projection();
    const x=((clientX-rect.left)/rect.width*2-1-p.tx)/p.sx;
    const y=(1-(clientY-rect.top)/rect.height*2-p.ty)/p.sy;
    const b=this.presentation?.bounds??this.bounds;
    if(x<b.left||x>b.right||y<b.bottom||y>b.top)return null;
    for(let i=this._model.getDrawableCount()-1;i>=0;i--){
      if(this._model.getDrawableOpacity(i)<.05)continue;
      const vertices=this._model.getDrawableVertices(i),indices=this._model.getDrawableVertexIndices(i);
      for(let j=0;j<indices.length;j+=3){
        const a=indices[j]*2,c=indices[j+1]*2,d=indices[j+2]*2;
        const ax=vertices[a],ay=vertices[a+1],bx=vertices[c],by=vertices[c+1],cx=vertices[d],cy=vertices[d+1];
        const cross=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
        if(Math.abs(cross)<1e-10)continue;
        const u=((x-ax)*(cy-ay)-(y-ay)*(cx-ax))/cross;
        const v=((bx-ax)*(y-ay)-(by-ay)*(x-ax))/cross;
        if(u>=0&&v>=0&&u+v<=1)return y>(this.presentation?.headBoundaryY??(b.bottom+(b.top-b.bottom)*.69))?'head':'body';
      }
    }
    return null;
  }
  private onPointer=(event:PointerEvent):void=>{
    if(this.press?.id===event.pointerId&&Math.hypot(event.clientX-this.press.x,event.clientY-this.press.y)>7)this.press.moved=true;
    if(this.contacts.has(event.pointerId)){
      this.contacts.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const points=[...this.contacts.values()],first=points[0],second=points[1];
      const x=second?(first.x+second.x)/2:first.x,y=second?(first.y+second.y)/2:first.y;
      const rect=this.canvas.getBoundingClientRect(),g=this.gesture;
      if(g){
        this.setPosition(g.panX+(x-g.x)/rect.width,g.panY+(y-g.y)/rect.height);
        if(second&&g.distance>0)this.changeZoom(g.zoom*Math.hypot(first.x-second.x,first.y-second.y)/g.distance);
      }
      return;
    }
    if(event.pointerType!=='touch'||event.target===this.canvas)this.focusAt(event.clientX,event.clientY);
  };
  private onLeave=():void=>{this.pointer={x:0,y:0};this.cursor=null;};
  private onPointerDown=(event:PointerEvent):void=>{
    if(!this.ready||event.button!==0)return;
    this.focusAt(event.clientX,event.clientY);
    if(this.moveMode){
      event.preventDefault();this.canvas.focus({preventScroll:true});
      this.contacts.set(event.pointerId,{x:event.clientX,y:event.clientY});
      this.canvas.setPointerCapture(event.pointerId);this.beginGesture();
      this.canvas.dataset.dragging='true';
    }else if(this.hitArea(event.clientX,event.clientY))this.press={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  };
  private beginGesture():void {
    const points=[...this.contacts.values()],a=points[0],b=points[1];
    this.gesture=a?{x:b?(a.x+b.x)/2:a.x,y:b?(a.y+b.y)/2:a.y,panX:this.pan.x,panY:this.pan.y,distance:b?Math.hypot(a.x-b.x,a.y-b.y):0,zoom:this.zoom}:null;
  }
  private onPointerUp=(event:PointerEvent):void=>{
    if(this.contacts.delete(event.pointerId)){
      if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
      this.beginGesture();this.canvas.dataset.dragging=String(this.contacts.size>0);
    }else if(this.press?.id===event.pointerId&&!this.press.moved){
      const area=this.hitArea(event.clientX,event.clientY);
      if(area)this.canvas.dispatchEvent(new CustomEvent('hikari:tap',{bubbles:true,detail:{area}}));
    }
    this.press=null;
    if(event.pointerType==='touch')this.onLeave();
    else if(this.contacts.size===0)this.focusAt(event.clientX,event.clientY);
  };
  private onPointerCancel=(event:PointerEvent):void=>{
    this.contacts.delete(event.pointerId);this.beginGesture();
    this.canvas.dataset.dragging=String(this.contacts.size>0);this.press=null;this.onLeave();
  };
  private cancelGesture():void {
    const ids=[...this.contacts.keys()];this.contacts.clear();this.gesture=null;this.press=null;
    for(const id of ids)if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    this.canvas.dataset.dragging='false';
  }
  private changeZoom(value:number):void {
    this.setZoom(value);this.canvas.dispatchEvent(new CustomEvent('hikari:zoom',{bubbles:true,detail:{zoom:this.zoom}}));
  }
  private onWheel=(event:WheelEvent):void=>{
    if(!this.ready||!this.moveMode||event.ctrlKey)return;
    event.preventDefault();this.changeZoom(this.zoom*Math.exp(-event.deltaY*.0015));
  };
  private onKey=(event:KeyboardEvent):void=>{
    if(!this.ready||!this.moveMode||event.altKey||event.ctrlKey||event.metaKey)return;
    const delta=event.shiftKey?.08:.025;
    if(event.key==='ArrowLeft')this.setPosition(this.pan.x-delta,this.pan.y);
    else if(event.key==='ArrowRight')this.setPosition(this.pan.x+delta,this.pan.y);
    else if(event.key==='ArrowUp')this.setPosition(this.pan.x,this.pan.y-delta);
    else if(event.key==='ArrowDown')this.setPosition(this.pan.x,this.pan.y+delta);
    else if(event.key==='Home')this.setPosition(0,0);
    else return;
    event.preventDefault();
  };
  private onBlur=():void=>{this.cancelGesture();this.onLeave();};
  private onVisibility=():void=>{this.lastTime=null;if(document.hidden)this.onBlur();};
  private onContextLost=(event:Event):void=>{
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.ready=false;
    this.failure('图形连接已中断，点击重新加载即可回到舞台。');
  };
  private resize():void {
    const rect=this.canvas.getBoundingClientRect();
    const ratio=Math.min(devicePixelRatio||1,2,2560/Math.max(rect.width,rect.height,1));
    const w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio));
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;
      if(this.getRenderer())this.setRenderTargetSize(w,h);
    }
  }
  private setParameter(id:string,value:number):void {
    const index=this.indices.get(id);
    if(index!==undefined) this._model.setParameterValueByIndex(index,value);
  }
  /** The debug override layer is the last model write before presentation. */
  private applyDebugOverrides():Record<string,number>{
    if(!this.debugController||!this._model)return {};
    return this.debugController.applyFinalOverrides(this._model);
  }
  private renderDebugFrame():void {
    if(!this.ready||!this.presentation||!this._model)return;
    this.presentation.update();
    this.draw();
  }
  private applyOutfit():void {
    if(this.outfitIndex===undefined||!this._model)return;
    this._model.setParameterValueByIndex(this.outfitIndex,this.outfit);
  }
  /**
   * Apply the final arm envelope after physics, expressions, and outfit
   * writes.  This is intentionally a write-back guard at the model boundary:
   * no later layer in the frame may leave a large elbow/wrist/hand pose or an
   * out-of-range whole-arm physical value behind.
   */
  private enforceGentleArmBounds():void {
    if(!this._model)return;
    for(const id of GENTLE_SHOULDER_IDS){
      const index=this.indices.get(id);
      if(index===undefined)continue;
      const value=this._model.getParameterValueByIndex(index);
      this.setParameter(id,Number.isFinite(value)
        ?clamp(value,-GENTLE_SHOULDER_LIMIT,GENTLE_SHOULDER_LIMIT)
        :0);
    }
    for(const id of GENTLE_NEUTRAL_ARM_IDS){
      if(this.indices.has(id))this.setParameter(id,0);
    }
    for(const id of GENTLE_PHYSICAL_ARM_IDS){
      const index=this.indices.get(id);
      if(index===undefined)continue;
      const value=this._model.getParameterValueByIndex(index);
      this.setParameter(id,Number.isFinite(value)
        ?clamp(value,-GENTLE_PHYSICAL_ARM_LIMIT,GENTLE_PHYSICAL_ARM_LIMIT)
        :0);
    }
  }
  private applySecondaryMotion(dt:number,presence:PresenceOutput|null,actionActive=false):void {
    const input:Record<string,number>=presence?{...presence.parameters,...presence.articulated}:{};
    if(actionActive){
      for(const id of ['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ'] as const){
        const index=this.indices.get(id);
        if(index!==undefined)input[id]=this._model.getParameterValueByIndex(index);
      }
    }
    const sample=this.secondaryMotion.update(dt,input);
    for(const channel of secondaryMotionChannels){
      const index=this.indices.get(channel.id);
      if(index===undefined)continue;
      const physical=this._model.getParameterValueByIndex(index);
      this.setParameter(channel.id,addSecondaryMotion(physical,sample.additives[channel.id]));
    }
  }
  private effectiveAutonomousCue(presence:PresenceOutput|null):AutonomousCue {
    if(!presence||!presence.autonomousCue?.active||this.autoCueSuppressed||this.suppressAutonomousUntilCueInactive||this.selected!=='Neutral'){
      return {active:false,mouthForm:0,gazeX:0};
    }
    return {
      active:true,
      mouthForm:clamp(presence.autonomousCue.mouthForm,-1,1),
      gazeX:clamp(presence.autonomousCue.gazeX,-.12,.12),
    };
  }
  private applyAutonomousCue(cue:AutonomousCue):void {
    // An inactive cue leaves expression motion untouched. This is important
    // for explicit Smile/Shy/Angry selections and for the neutral tail after
    // an automatic gesture has finished.
    if(!cue.active||!this._model)return;
    const mouthIndex=this.indices.get('ParamMouthForm');
    if(mouthIndex!==undefined){
      const low=this._model.getParameterMinimumValue(mouthIndex);
      const high=this._model.getParameterMaximumValue(mouthIndex);
      this.setParameter('ParamMouthForm',clamp(cue.mouthForm,low,high));
    }
    const gazeIndex=this.indices.get('ParamEyeBallX');
    if(gazeIndex!==undefined){
      const low=this._model.getParameterMinimumValue(gazeIndex);
      const high=this._model.getParameterMaximumValue(gazeIndex);
      const current=this._model.getParameterValueByIndex(gazeIndex);
      // Treat the cue as a short, eased gaze target. An additive offset was
      // too easy for the ordinary idle gaze to hide (especially on the second
      // gesture after several seconds of drift), so the authored direction is
      // now observable while the weight still fades to and from the live gaze.
      const maximum=.085;
      const weight=clamp(Math.abs(cue.gazeX)/maximum,0,1);
      const target=cue.gazeX<0?-maximum:maximum;
      this.setParameter('ParamEyeBallX',clamp(current+(target-current)*weight,low,high));
    }
  }
  private clearActionReplacement():void {
    this.debugActionReplaceBase.clear();
    this.debugActionReplaceCancelBase.clear();
    this.debugActionReplaceCancelActive=false;
    this.debugActionReplaceActive=false;
  }
  private clearActionBridge():void {
    this.debugActionBridgeBase.clear();
    this.debugActionBridgeActive=false;
  }
  private clearAllActionReplacement():void {
    this.clearActionReplacement();
    this.clearActionBridge();
  }
  private actionReplacementWeight(action:ActionSnapshot):number {
    if(action.transition.active)return smoothstep(clamp(action.transition.progress,0,1));
    if(action.phase==='exit'&&action.elapsed>=1.38){
      const duration=Math.max(action.duration-1.38,1e-6);
      return 1-smoothstep((action.elapsed-1.38)/duration);
    }
    return 1;
  }
  private applyActionIntents(layer:ParameterIntentMap, action?:ActionSnapshot):void {
    const bridging=!!action&&this.debugActionBridgeActive&&action.transition.active;
    const bridgeProgress=bridging?smoothstep(action!.transition.progress):1;
    const appliedChewIds=new Set<string>();
    for(const intent of Object.values(layer.intents)){
      const index=this.indices.get(intent.id);if(index===undefined)continue;
      const value=this._model.getParameterValueByIndex(index);
      const minimum=this._model.getParameterMinimumValue(index);
      const maximum=this._model.getParameterMaximumValue(index);
      let next:number;
      if(intent.blend==='replace'){
        const target=clamp(intent.value,minimum,maximum);
        if(action?.phase==='cancel'&&this.debugActionReplaceCancelActive){
          const progress=smoothstep(action.elapsed/Math.max(action.duration,1e-6));
          const cancelBase=this.debugActionReplaceCancelBase.get(intent.id)??value;
          next=(cancelBase+(target-cancelBase)*progress)*(1-progress)+value*progress;
        }else if(action&&this.debugActionReplaceActive){
          const weight=this.actionReplacementWeight(action);
          const replaceBase=this.debugActionReplaceBase.get(intent.id)??value;
          const source=action.phase==='exit'&&action.elapsed>=1.38?value:replaceBase;
          next=source*(1-weight)+target*weight;
        }else{
          next=target;
        }
      }else{
        const blended=intent.blend==='multiply'?value*intent.value:value+intent.value;
        next=bridging&&CHEW_ACTION_PARAMETER_IDS.includes(intent.id as typeof CHEW_ACTION_PARAMETER_IDS[number])
          ?(this.debugActionBridgeBase.get(intent.id)??value)*(1-bridgeProgress)+blended*bridgeProgress
          :blended;
        if(bridging&&CHEW_ACTION_PARAMETER_IDS.includes(intent.id as typeof CHEW_ACTION_PARAMETER_IDS[number])){
          appliedChewIds.add(intent.id);
        }
      }
      if(!Number.isFinite(next))throw new Error('Non-finite action result: '+intent.id);
      this.setParameter(intent.id,clamp(next,minimum,maximum));
    }
    if(bridging){
      for(const id of CHEW_ACTION_PARAMETER_IDS){
        if(appliedChewIds.has(id))continue;
        const index=this.indices.get(id);if(index===undefined)continue;
        const value=this._model.getParameterValueByIndex(index);
        const minimum=this._model.getParameterMinimumValue(index);
        const maximum=this._model.getParameterMaximumValue(index);
        const next=(this.debugActionBridgeBase.get(id)??value)*(1-bridgeProgress)+value*bridgeProgress;
        if(!Number.isFinite(next))throw new Error('Non-finite action bridge result: '+id);
        this.setParameter(id,clamp(next,minimum,maximum));
      }
    }
  }
  private expireMouthInput(now=performance.now()):void {
    if(this.activeMouthInput&&now>=this.activeMouthInput.expiresAt)this.activeMouthInput=null;
  }
  private applyMouthInput(action:ActionSnapshot):void {
    const input=this.activeMouthInput;
    if(!input||!this._model)return;
    let inputWeight=1;
    if(action.active&&action.action!==null&&isChewAction(action.action)){
      // Keep the actual chew pulse closed. Return to fresh speech through the
      // same authored exit/cancel fade, not on the first frame after it ends.
      inputWeight=action.phase==='cancel'
        ?smoothstep(action.elapsed/Math.max(action.duration,1e-6))
        :action.phase==='exit'?1-this.actionReplacementWeight(action):0;
    }else if(action.transition.active&&(this.debugActionBridgeActive||
      (action.transition.fromAction!==null&&isChewAction(action.transition.fromAction)))){
      inputWeight=smoothstep(action.transition.progress);
    }
    if(inputWeight===0)return;
    const channels:Array<[string,number|undefined]>=[
      ['ParamMouthOpenY',input.open],
      ['ParamMouthForm',input.form],
      ['ParamMouthPucker',input.pucker],
    ];
    for(const [id,value] of channels){
      if(value===undefined)continue;
      const index=this.indices.get(id);
      if(index===undefined)continue;
      const minimum=this._model.getParameterMinimumValue(index);
      const maximum=this._model.getParameterMaximumValue(index);
      const target=clamp(value,minimum,maximum);
      const base=this._model.getParameterValueByIndex(index);
      this.setParameter(id,base+(target-base)*inputWeight);
    }
  }
  private tick=(time:number):void=>{
    if(this.destroyed||!this.ready) return;
    this.expireMouthInput();
    this.frame=requestAnimationFrame(this.tick);
    if(document.hidden){this.lastTime=null;return;}
    const timing=getFrameTiming(time,this.lastTime,this.paused);
    this.lastTime=Number.isFinite(time)&&time>=0?time:null;
    // Advance the complete parameter pipeline in bounded steps. Clamping the
    // frame delta itself to 1/30 made a 15 FPS session run at half speed.
    for(let i=0;i<timing.stepCount;i++){
      const sampleTime=time-(timing.stepCount-1-i)*timing.stepSeconds*1000;
      this.advanceSimulation(timing.stepSeconds,sampleTime,i===timing.stepCount-1);
    }
    // Geometry upload and rendering remain once per browser frame.
    this.presentation.update();
    this.draw();
  };
  private advanceSimulation(dt:number,time:number,recordDiagnostics:boolean):void {
    const captureDiagnostics=this.debugEnabled&&recordDiagnostics;
    if(!this.paused)this.elapsed+=dt;
    const debug=this.debugController?.getControls();
    const idleEnabled=debug?.idleEnabled??true;
    const physicsEnabled=debug?.physicsEnabled??true;
    const blinkEnabled=debug?.blinkEnabled??true;
    const expressionEnabled=debug?.expressionEnabled??true;
    const model=this._model;
    const action=this.actionController.update(dt,this.paused);
    if(!action.active&&this.debugActionReplaceActive)this.clearActionReplacement();
    if(this.debugActionBridgeActive&&(!action.active||!action.transition.active))this.clearActionBridge();
    if(!this.paused&&!action.active&&this.pendingGreeting){
      this.pendingGreeting=false;
      this.suppressAutonomousUntilCueInactive=false;
      this.presence.triggerGreeting();
      this.expressiveRebound.trigger();
    }
    let frameBlink=1;
    let presence:PresenceOutput|null=null;
    let rawPresenceCue:AutonomousCue|null=null;
    let effectiveCueApplied=false;
    let effectiveCue:AutonomousCue|null=null;
    let reboundUpdateCalled=false;
    let reboundEnabled=false;
    let reboundAutomaticSmile=0;
    let reboundOutputs:Record<string,number>|null=null;
    let reboundAppliedReadback:Record<string,MotionDiagnosticParameterValue>|null=null;
    let reboundNonFiniteIds:string[]|null=null;
    const hasFrozenParameters=this.frozenParameters.length===this.defaults.length;
    for(let i=0;i<this.defaults.length;i++){
      const value=this.paused&&hasFrozenParameters?this.frozenParameters[i]:this.paused?this.lastBase[i]:this.defaults[i];
      model.setParameterValueByIndex(i,value);
    }
    if(!this.paused&&idleEnabled){
      if(this.follow&&this.cursor&&this.contacts.size===0)this.updatePointerTarget(this.cursor.x,this.cursor.y);
      // One owner for the base pose: attention settles first in the eyes,
      // then in the head and body. Idle targets dwell between small changes.
      presence=this.presence.update(dt,{pointer:this.pointer,pointerActive:this.cursor!==null&&this.contacts.size===0,followEnabled:this.follow,outfit:this.outfit});
      if(captureDiagnostics)rawPresenceCue=presence.autonomousCue?{...presence.autonomousCue}:null;
      for(const [id,value] of Object.entries(presence.parameters))this.setParameter(id,value);
      for(const [id,value] of Object.entries(presence.articulated))this.setParameter(id,value);
      this.look={x:presence.parameters.ParamEyeBallX/.88,y:presence.parameters.ParamEyeBallY/.85};
      if(blinkEnabled){
      const blinkTime=this.elapsed-this.nextBlink;
      let eye=1;
      if(blinkTime>=0&&this.elapsed-this.selectedAt>2){
        if(blinkTime<.09) eye=1-blinkTime/.09;
        else if(blinkTime<.135) eye=0;
        else if(blinkTime<.285) eye=(blinkTime-.135)/.15;
        else this.nextBlink=this.elapsed+2.8+Math.random()*2.7;
      }
      this.setParameter('ParamEyeLOpen',eye);this.setParameter('ParamEyeROpen',eye);
      frameBlink=eye;
      }
      for(let i=0;i<this.defaults.length;i++) this.lastBase[i]=model.getParameterValueByIndex(i);
    }
    if(!this.paused&&expressionEnabled)this._expressionManager.updateMotion(model,dt);
    if(!this.paused&&action.active)this.applyActionIntents(action.prePhysicsPose);
    if(!this.paused&&physicsEnabled){
      this._physics?.evaluate(model,dt);
      // Apply once after physics and before freezing. Each frame starts from
      // defaults, so the ambient offsets never accumulate in model values.
      this.applySecondaryMotion(dt,presence,action.active);
      // Native arm physics has weight 100. Add the authored pose response
      // once to that frame's physical result, never to a previous final value.
      if(presence){
        for(const [id,offset] of [['ParamArmSwayL',presence.leftArmAdditive],['ParamArmSwayR',presence.rightArmAdditive]] as const){
          const index=this.indices.get(id);if(index===undefined)continue;
          const physical=model.getParameterValueByIndex(index);
          this.setParameter(id,clamp(physical*GENTLE_PHYSICAL_ARM_GAIN+offset,-GENTLE_PHYSICAL_ARM_LIMIT,GENTLE_PHYSICAL_ARM_LIMIT));
        }
      }
    }
    if(!this.paused&&idleEnabled&&!action.active){
      if(this.suppressAutonomousUntilCueInactive&&presence?.autonomousCue?.active===false){
        this.suppressAutonomousUntilCueInactive=false;
      }
      this.lastAutonomousCue=this.effectiveAutonomousCue(presence);
      if(captureDiagnostics)effectiveCue={...this.lastAutonomousCue};
      effectiveCueApplied=true;
      this.applyAutonomousCue(this.lastAutonomousCue);
      // Keep a greeting requested during cancellation queued until the
      // suppressed autonomous cue ends; update(false) would discard it.
      reboundEnabled=!this.autoCueSuppressed&&this.selected==='Neutral';
      reboundAutomaticSmile=this.lastAutonomousCue.mouthForm;
      let face:Record<string,number>={};
      if(!this.suppressAutonomousUntilCueInactive){
        reboundUpdateCalled=true;
        face=this.expressiveRebound.update(dt,this.lastAutonomousCue.mouthForm,reboundEnabled);
      }
      for(const [id,value] of Object.entries(face)){
        // A greeting may follow the UI's explicit Smile selection. Preserve
        // stronger expression values while its positive response eases in/out.
        const index=this.indices.get(id);
        const base=index===undefined?value:model.getParameterValueByIndex(index);
        this.setParameter(id,reboundEnabled?value:Math.max(base,value));
      }
      if(captureDiagnostics){
        reboundOutputs={...face};
        if(Object.keys(face).length){
          const readback=this.readDebugMotionParameters(Object.keys(face));
          reboundAppliedReadback=readback.values;
          reboundNonFiniteIds=readback.nonFiniteIds;
        }
      }
    }
    if(!this.paused&&action.active){
      // An expression may have written eyelids after the blink layer. Keep
      // complete blink closure before applying the action coefficient.
      for(const id of ['ParamEyeLOpen','ParamEyeROpen']){
        const index=this.indices.get(id);if(index===undefined)continue;
        this.setParameter(id,Math.min(this._model.getParameterValueByIndex(index),frameBlink));
      }
      this.applyActionIntents(action.postExpressionFace,action);
    }
    // Outfit selection wins over expression, physics, breeze and paused
    // parameter snapshots at the end of every frame.
    this.applyOutfit();
    this.enforceGentleArmBounds();
    if(!this.paused)this.applyMouthInput(action);
    this.applyDebugOverrides();
    if(captureDiagnostics){
      const postWrite=this.readDebugMotionParameters(MOTION_DIAGNOSTIC_PARAMETER_IDS);
      this.debugMotionSequence+=1;
      this.debugMotionLatest={
        sequence:this.debugMotionSequence,
        timeMs:time,
        runtimeElapsed:this.elapsed,
        paused:this.paused,
        controls:debug??{
          idleEnabled:true,
          physicsEnabled:true,
          blinkEnabled:true,
          expressionEnabled:true,
          rawNativeGaze:false,
        },
        rawPresenceCue,
        effectiveAutonomousCue:effectiveCue??{active:false,mouthForm:0,gazeX:0},
        effectiveCueApplied,
        frameBlink,
        suppression:{
          suppressAutonomousUntilCueInactive:this.suppressAutonomousUntilCueInactive,
          autoCueSuppressed:this.autoCueSuppressed,
          selectedExpression:this.selected,
        },
        action:{
          active:action.active,
          action:action.action,
          phase:action.phase,
          elapsed:action.elapsed,
          progress:action.progress,
          paused:action.paused,
        },
        rebound:{
          updateCalled:reboundUpdateCalled,
          enabled:reboundEnabled,
          automaticSmile:reboundAutomaticSmile,
          outputs:reboundOutputs??{},
          appliedReadback:reboundAppliedReadback??{},
        },
        pendingGreeting:this.pendingGreeting,
        postWriteParameters:postWrite.values,
        nonFiniteParameterIds:[...new Set([...(reboundNonFiniteIds??[]),...postWrite.nonFiniteIds])],
      };
    }
    if(!this.paused){
      this.frozenPhysics=outputIds.map(id=>model.getParameterValueByIndex(this.indices.get(id)));
      this.frozenParameters=Array.from({length:this.defaults.length},(_,index)=>model.getParameterValueByIndex(index));
    }
  }
  private draw():void {
    const gl=this.gl;
    // Context loss can precede the queued webglcontextlost event. In that
    // interval WebGL state queries return null, so skip the renderer entirely.
    if(gl.isContextLost())return;
    const offscreen=CubismWebGLOffscreenManager.getInstance();
    offscreen.beginFrameProcess(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    const p=this.projection();
    const matrix=new CubismMatrix44();
    const values=matrix.getArray();values[0]=p.sx;values[5]=p.sy;values[12]=p.tx;values[13]=p.ty;
    const renderer=this.getRenderer();
    renderer.setMvpMatrix(matrix);
    renderer.setRenderState(null,[0,0,this.canvas.width,this.canvas.height]);
    if(this.debugEnabled){
      this.debugDrawTimestamps.push(performance.now());
      // Keep a bounded trace if a long-lived DEV session is left running.
      if(this.debugDrawTimestamps.length>6000)this.debugDrawTimestamps.splice(0,1000);
    }
    renderer.drawModel(shaderPath);
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
  }
  destroy():void {
    if(this.destroyed)return;
    this.destroyed=true;
    this.activeMouthInput=null;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.cancelGesture();
    document.removeEventListener('pointermove',this.onPointer);
    document.documentElement.removeEventListener('pointerleave',this.onLeave);
    this.canvas.removeEventListener('pointerdown',this.onPointerDown);
    document.removeEventListener('pointerup',this.onPointerUp);
    document.removeEventListener('pointercancel',this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture',this.onPointerCancel);
    this.canvas.removeEventListener('wheel',this.onWheel);
    this.canvas.removeEventListener('keydown',this.onKey);
    window.removeEventListener('blur',this.onBlur);
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    document.removeEventListener('visibilitychange',this.onVisibility);
    for(const texture of this.textures)this.gl?.deleteTexture(texture);
    this.expressions.forEach(expression=>ACubismMotion.delete(expression));
    this.expressions.clear();
    this.presentation?.destroy();this.presentation=null;
    this.release();
    if(this.gl){
      CubismWebGLOffscreenManager.getInstance().removeContext(this.gl);
      CubismRenderer_WebGL.doStaticRelease();
    }
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
