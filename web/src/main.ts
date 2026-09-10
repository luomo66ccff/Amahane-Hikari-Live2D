import type { HikariStage } from './runtime';
import { setupUI } from './ui';
let engine:HikariStage|null=null;
let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let following=true;
let zoom=1;
let moveMode=false;
let generation=0;
const ui=setupUI({
  expression:name=>engine?.setExpression(name),
  pause:value=>{paused=value;engine?.setPaused(value);},
  zoom:value=>{zoom=value;engine?.setZoom(value);},
  follow:value=>{following=value;engine?.setFollow(value);},
  move:value=>{moveMode=value;engine?.setMoveMode(value);},
  center:()=>engine?.setPosition(0,0),
  reset:()=>{zoom=1;moveMode=false;engine?.reset();},
  retry:()=>void start(),
});
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
    engine=new Stage(canvas,detail=>{if(ticket===generation)ui.setLoading(detail);},message=>{
      if(ticket!==generation)return;
      ++generation;
      engine?.destroy();engine=null;
      ui.setError(message);
    });
    engine.setPaused(paused);engine.setFollow(following);engine.setZoom(zoom);engine.setMoveMode(moveMode);
    await engine.mount();
    if(ticket===generation)ui.setReady();
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
