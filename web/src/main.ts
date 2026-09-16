import type { HikariStage, HikariStageOptions, MouthInput, RuntimeMotionDiagnostics } from './runtime';
import type { ActionName, ActionSnapshot } from './action-controller';
import type {
  RuntimeCapabilitiesSnapshot,
  RuntimeDebugControlPatch,
  RuntimeDebugControlState,
  RuntimeDrawFrameTelemetry,
  RuntimeOverrideResult,
} from './runtime-capabilities';
import { setupUI } from './ui';
import type { OutfitValue } from './ui';
let engine:HikariStage|null=null;
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let following=true;
let zoom=1;
let moveMode=false;
let selectedOutfit:OutfitValue=0;
let generation=0;

// The production page deliberately keeps the renderer instance private. A
// narrowly scoped development hook lets the real-app acceptance runner read
// the live SDK model without adding UI or changing the production bundle.
// The explicit query marker is required in addition to Vite's DEV guard.
type CharmQaHandle = {
  readonly stage:HikariStage|null;
  readonly model:ReturnType<HikariStage['getModel']>|null;
  readonly canvas:HTMLCanvasElement|null;
  readonly capabilities:RuntimeCapabilitiesSnapshot|null;
  readonly controls:RuntimeDebugControlState|null;
  readonly modelFile:string|null;
  read():Record<string,number>|null;
  readParameters():Record<string,number>|null;
  setControls(patch:RuntimeDebugControlPatch):RuntimeDebugControlState;
  setParameterOverrides(values:Record<string,number>):RuntimeOverrideResult;
  clearParameterOverrides():void;
  getParameterOverrides():Record<string,number>|null;
  getFrameTelemetry():RuntimeDrawFrameTelemetry|null;
  clearFrameTelemetry():void;
  getMotionDiagnostics():RuntimeMotionDiagnostics|null;
  resetDebug():void;
  getSupportedActions():ActionName[];
  setMouthInput(input:MouthInput|null):void;
  startAction(name:ActionName):ActionSnapshot;
  cancelAction():ActionSnapshot;
  readAction():ActionSnapshot|null;
};
const qaQuery = new URLSearchParams(window.location.search);
const charmQaEnabled = import.meta.env.DEV
  && (qaQuery.get('__charmQa') === '1' || qaQuery.get('__hikariQa') === '1');
const qaModel3Path = charmQaEnabled
  ? (qaQuery.get('__hikariModel3') ?? qaQuery.get('__hikariModel') ?? qaQuery.get('model3') ?? undefined)
  : undefined;
if (charmQaEnabled) {
  const charmQa:CharmQaHandle = {
    get stage():HikariStage|null { return engine; },
    get model():ReturnType<HikariStage['getModel']>|null { return engine?.getModel() ?? null; },
    get canvas():HTMLCanvasElement|null { return document.querySelector<HTMLCanvasElement>('#model-canvas'); },
    get capabilities():RuntimeCapabilitiesSnapshot|null { return engine?.getRuntimeCapabilities() ?? null; },
    get controls():RuntimeDebugControlState|null { return engine?.getDebugControls() ?? null; },
    get modelFile():string|null { return engine?.getLoadedModelFile() ?? null; },
    read():Record<string,number>|null {
      const model=this.model;
      if (!model) return null;
      return Object.fromEntries(Array.from({length:model.getParameterCount()},(_,index)=>[
        model.getParameterId(index).getString(),model.getParameterValueByIndex(index),
      ]));
    },
    readParameters():Record<string,number>|null { return engine?.readDebugParameters() ?? null; },
    setControls(patch:RuntimeDebugControlPatch):RuntimeDebugControlState {
      if(!engine)throw new Error('debug controls require a mounted model');
      return engine.setDebugControls(patch);
    },
    setParameterOverrides(values:Record<string,number>):RuntimeOverrideResult {
      if(!engine)throw new Error('parameter overrides require a mounted model');
      return engine.setDebugParameterOverrides(values);
    },
    clearParameterOverrides():void {
      if(!engine)throw new Error('parameter overrides require a mounted model');
      engine.clearDebugParameterOverrides();
    },
    getParameterOverrides():Record<string,number>|null { return engine?.getDebugParameterOverrides() ?? null; },
    getFrameTelemetry():RuntimeDrawFrameTelemetry|null { return engine?.getDebugFrameTelemetry() ?? null; },
    clearFrameTelemetry():void { engine?.clearDebugFrameTelemetry(); },
    getMotionDiagnostics():RuntimeMotionDiagnostics|null { return engine?.getDebugMotionDiagnostics() ?? null; },
    resetDebug():void { engine?.reset(); },
    getSupportedActions():ActionName[] { return engine?.getSupportedActions() ?? []; },
    setMouthInput(input:MouthInput|null):void {
      if(!engine)throw new Error('mouth input requires a mounted model');
      engine.setMouthInput(input);
    },
    startAction(name:ActionName):ActionSnapshot {
      if(!engine)throw new Error('actions require a mounted model');
      return engine.startDebugAction(name);
    },
    cancelAction():ActionSnapshot {
      if(!engine)throw new Error('actions require a mounted model');
      return engine.cancelDebugAction();
    },
    readAction():ActionSnapshot|null {return engine?.readDebugAction()??null;},
  };
  Object.defineProperty(window,'__hikariQa',{configurable:true,enumerable:false,value:charmQa});
}
const ui=setupUI({
  expression:name=>engine?.setExpression(name),
  action:name=>engine?.startAction(name),
  greet:()=>engine?.greet(),
  pause:value=>{paused=value;engine?.setPaused(value);},
  zoom:value=>{zoom=value;engine?.setZoom(value);},
  follow:value=>{following=value;engine?.setFollow(value);},
  move:value=>{moveMode=value;engine?.setMoveMode(value);},
  outfit:value=>{selectedOutfit=value;engine?.setOutfit(value);},
  center:()=>engine?.setPosition(0,0),
  reset:()=>{zoom=1;moveMode=false;selectedOutfit=0;engine?.reset();},
  retry:()=>void start(),
});
document.addEventListener('hikari:mouth-input',(event:Event)=>{
  const detail=(event as CustomEvent<MouthInput|null>).detail;
  engine?.setMouthInput(detail);
});
const publishSupportedActions=():void=>{
  document.dispatchEvent(new CustomEvent<{actions:ActionName[]}>('hikari:actions-supported',{
    detail:{actions:engine?.getSupportedActions()??[]},
  }));
};
async function start():Promise<void>{
  const ticket=++generation;
  ui.setLoading('正在打开舞台…');
  try{
    engine?.destroy();engine=null;
    const old=document.querySelector<HTMLCanvasElement>('#model-canvas');
    const canvas=old.cloneNode(false) as HTMLCanvasElement;
    delete canvas.dataset.ready;
    old.replaceWith(canvas);
    if(typeof Live2DCubismCore==='undefined'){
      await new Promise<void>((resolve,reject)=>{
        const script=document.createElement('script');
        const timer=setTimeout(()=>{script.remove();reject(new Error('舞台组件加载超时，请重新加载。'));},20000);
        script.src=import.meta.env.BASE_URL+'vendor/live2dcubismcore.min.js';
        script.onload=()=>{clearTimeout(timer);resolve();};
        script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('舞台组件加载失败，请检查网络后重试。'));};
        document.head.append(script);
      });
    }
    const {HikariStage:Stage}=await import('./runtime');
    if(ticket!==generation)return;
    Stage.initialize();
    const stageOptions:HikariStageOptions={debugEnabled:charmQaEnabled,model3Path:qaModel3Path};
    engine=new Stage(canvas,detail=>{if(ticket===generation)ui.setLoading(detail);},message=>{
      if(ticket!==generation)return;
      ++generation;
      engine?.destroy();engine=null;
      ui.setError(message);
    },stageOptions);
    engine.setPaused(paused);engine.setFollow(following);engine.setZoom(zoom);engine.setMoveMode(moveMode);
    // Keep the outfit choice across retries and apply it before mount's first
    // model update, so the initial bounds are measured for the chosen outfit.
    engine.setOutfit(selectedOutfit);
    await engine.mount();
    if(ticket===generation){
      ui.setReady();
      publishSupportedActions();
    }
  }catch(error){
    if(ticket!==generation)return;
    engine?.destroy();engine=null;
    ui.setError(error instanceof Error&&/[\u4e00-\u9fff]/.test(error.message)?error.message:'暂时未能加载模型，请检查网络后重试。');
  }
}
window.addEventListener('pagehide',()=>engine?.destroy());
document.addEventListener('hikari:zoom',event=>{zoom=(event as CustomEvent<{zoom:number}>).detail.zoom;});
window.addEventListener('pageshow',event=>{if(event.persisted)void start();});
void start();
