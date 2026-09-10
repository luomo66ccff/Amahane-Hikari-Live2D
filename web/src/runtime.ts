import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { CubismShaderManager_WebGL } from '@framework/rendering/cubismshader_webgl';
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager';
import { CubismRenderer_WebGL } from '@framework/rendering/cubismrenderer_webgl';
import { HikariPresentation } from './presentation';
import { hairBreezeChannels, hairBreezeAt, addHairBreeze } from './hair-breeze';

const base = import.meta.env.BASE_URL;
const shaderPath = `${base}vendor/shaders/`;
const modelBase = `${base}model/v2/`;
const outputIds = ['ParamEarLPhysics','ParamEarRPhysics','ParamAhogeMid','ParamAhogeTip','ParamHairFront','ParamHairSideL','ParamHairBackUpper','ParamHairBackMid','ParamHairBackTip','ParamRibbonHead','ParamChainHead','ParamRibbonBody','ParamChainBody','ParamHairSideR','ParamClothSway','ParamArmSwayL','ParamArmSwayR'];
const clamp = (value:number, low:number, high:number) => Math.max(low,Math.min(high,value));
type References = {Moc:string; Physics:string; Textures:string[]; Expressions:{Name:string;File:string}[]};

/** Single-model renderer; source model and expressions remain byte-identical. */
export class HikariStage extends CubismUserModel {
  private gl:WebGL2RenderingContext;
  private abort = new AbortController();
  private expressions = new Map<string,ACubismMotion>();
  private textures:WebGLTexture[] = [];
  private indices = new Map<string,number>();
  private defaults:number[] = [];
  private frozenPhysics:number[] = [];
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private breezeElapsed = 0;
  private nextBlink = 3.5;
  private selectedAt = 0;
  private selected = 'Neutral';
  private pointer = {x:0,y:0};
  private look = {x:0,y:0};
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
  private bounds = {left:0,right:1,bottom:0,top:1};
  private resizeObserver:ResizeObserver;
  private lastBase:number[] = [];
  constructor(private canvas:HTMLCanvasElement, private progress:(text:string)=>void, private failure:(text:string)=>void) {
    super();
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
  private async fetchFile(path:string):Promise<ArrayBuffer> {
    const response = await fetch(modelBase+path,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)])});
    if(!response.ok) throw new Error('模型资源加载失败，请检查网络后重新加载。');
    const bytes=await response.arrayBuffer();
    this.abort.signal.throwIfAborted();
    return bytes;
  }
  async mount():Promise<void> {
    this.progress('正在读取模型…');
    const file = await this.fetchFile('SuJiangXue_HairFlow_t002.model3.json');
    const refs = (JSON.parse(new TextDecoder().decode(file)) as {FileReferences:References}).FileReferences;
    const moc = await this.fetchFile(refs.Moc);
    this.loadModel(moc,true);
    if (!this._model) throw new Error('模型未能打开，请重新加载。');
    for(let i=0;i<this._model.getParameterCount();i++) {
      this.indices.set(this._model.getParameterId(i).getString(),i);
      this.defaults.push(this._model.getParameterDefaultValue(i));
    }
    let completed=0;
    await Promise.all(refs.Expressions.map(async expression=>{
      const bytes = await this.fetchFile(expression.File);
      this.expressions.set(expression.Name,this.loadExpression(bytes,bytes.byteLength,expression.Name));
      this.progress(`正在读取表情 ${++completed} / ${refs.Expressions.length}…`);
    }));
    const physics = await this.fetchFile(refs.Physics);
    this.loadPhysics(physics,physics.byteLength);
    this.resize();
    this.createRenderer(this.canvas.width,this.canvas.height,1);
    const renderer = this.getRenderer();
    renderer.startUp(this.gl);
    renderer.setIsPremultipliedAlpha(true);
    // SDK 5-r.5 does not reject unsuccessful shader fetches itself.
    const shaderFiles=['vertshadersrc.vert','vertshadersrcmasked.vert','vertshadersrcsetupmask.vert','fragshadersrcsetupmask.frag','fragshadersrcpremultipliedalpha.frag','fragshadersrcmaskpremultipliedalpha.frag','fragshadersrcmaskinvertedpremultipliedalpha.frag','vertshadersrccopy.vert','fragshadersrccopy.frag','fragshadersrccolorblend.frag','fragshadersrcalphablend.frag','vertshadersrcblend.vert','fragshadersrcpremultipliedalphablend.frag'];
    await Promise.all(shaderFiles.map(async name=>{
      const response=await fetch(shaderPath+name,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)])});
      if(!response.ok||!(await response.text()).trim()) throw new Error('舞台资源加载失败，请重新加载。');
    }));
    for(let i=0;i<refs.Textures.length;i++) {
      this.progress(`正在加载高清材质 ${i+1} / ${refs.Textures.length}，首次打开可能需要一点时间…`);
      const bytes = await this.fetchFile(refs.Textures[i]);
      const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      const img=new Image();
      try {
        img.src=url;
        await Promise.race([img.decode(),new Promise<void>((_,reject)=>setTimeout(()=>reject(new Error('高清材质加载超时，请重新加载。')),20000))]);
        if(this.destroyed) return;
        const gl=this.gl;
        const texture=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D,null);
        this.textures.push(texture);
        renderer.bindTexture(i,texture);
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
    this.lastBase=[...this.defaults];
    this.ready=true;
    this.setExpression('Neutral');
    this.frame=requestAnimationFrame(this.tick);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    if(this.gl.getError()!==this.gl.NO_ERROR) throw new Error('画面未能正确显示，请重新加载。');
    this.canvas.dataset.ready='true';
  }
  setExpression(name:string):void {
    const expression=this.expressions.get(name);
    if(!expression) return;
    this._expressionManager.startMotion(expression,false);
    this.selected=name;
    this.selectedAt=this.elapsed;
    this.canvas.dataset.expression=name;
  }
  setPaused(paused:boolean):void {
    this.paused=paused;
    this.canvas.dataset.paused=String(paused);
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
    this.setZoom(1);this.setPosition(0,0);this.setMoveMode(false);
    this.pointer={x:0,y:0};this.look={x:0,y:0};this.cursor=null;
    this.lastBase=[...this.defaults];this.frozenPhysics=[];
    this.breezeElapsed=0;
    if(this._model){
      for(let i=0;i<this.defaults.length;i++)this._model.setParameterValueByIndex(i,this.defaults[i]);
      // Reset the solver's particles and both interpolation snapshots too;
      // otherwise old hair inertia returns immediately after resuming.
      this._physics?.stabilization(this._model);
    }
    this.setExpression('Neutral');
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
  private onVisibility=():void=>{this.lastTime=0;if(document.hidden)this.onBlur();};
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
  private applyHairBreeze():void {
    for(const channel of hairBreezeChannels){
      const index=this.indices.get(channel.id);
      if(index===undefined)continue;
      const physical=this._model.getParameterValueByIndex(index);
      const breeze=channel.amplitude*hairBreezeAt(this.breezeElapsed,channel.delay);
      this.setParameter(channel.id,addHairBreeze(physical,breeze));
    }
  }
  private tick=(time:number):void=>{
    if(this.destroyed||!this.ready) return;
    this.frame=requestAnimationFrame(this.tick);
    if(document.hidden){this.lastTime=0;return;}
    const dt=this.lastTime?Math.min((time-this.lastTime)/1000,1/30):1/60;
    this.lastTime=time;
    if(!this.paused){this.elapsed+=dt;this.breezeElapsed+=dt;}
    const model=this._model;
    for(let i=0;i<this.defaults.length;i++) model.setParameterValueByIndex(i,this.paused?this.lastBase[i]:this.defaults[i]);
    if(!this.paused){
      if(this.follow&&this.cursor&&this.contacts.size===0)this.updatePointerTarget(this.cursor.x,this.cursor.y);
      const smoothing=1-Math.exp(-dt*9);
      // Bound sudden full-screen turns so the head ornaments do not slam
      // into their physics limits; nearby tracking still settles quickly.
      const maxStep=dt*4;
      this.look.x+=clamp((this.pointer.x-this.look.x)*smoothing,-maxStep,maxStep);
      this.look.y+=clamp((this.pointer.y-this.look.y)*smoothing,-maxStep,maxStep);
      const x=this.look.x,y=this.look.y,t=this.elapsed;
      const idleX=1-Math.abs(x),idleY=1-Math.abs(y);
      const idleWeight=1-Math.max(Math.abs(x),Math.abs(y))*.5;
      // Leave room for Shy's +0.12 eye offset before the model's +1 limit.
      this.setParameter('ParamEyeBallX',x*.88);
      this.setParameter('ParamEyeBallY',y*.85);
      // This rig's X/Y turns are subtle. Couple them with a bounded Z lean;
      // keep the stronger Z deformation well below the model's full extremes.
      this.setParameter('ParamAngleX',x*28+Math.sin(t*.65)*2*idleX);
      this.setParameter('ParamAngleY',y*25+Math.sin(t*.8)*1.5*idleY);
      this.setParameter('ParamAngleZ',x*6.5+Math.sin(t*.7)*2.5*idleWeight);
      this.setParameter('ParamBodyAngleX',x*8.5+Math.sin(t*.55)*idleX);
      this.setParameter('ParamBodyAngleY',y*9+Math.sin(t*.8)*.5*idleY);
      this.setParameter('ParamBodyAngleZ',x*2.2+Math.sin(t*.55)*1.5*idleWeight);
      this.setParameter('ParamBreath',.5+Math.sin(t*1.5)*.4);
      const blinkTime=this.elapsed-this.nextBlink;
      let eye=1;
      if(blinkTime>=0&&this.elapsed-this.selectedAt>2){
        if(blinkTime<.09) eye=1-blinkTime/.09;
        else if(blinkTime<.135) eye=0;
        else if(blinkTime<.285) eye=(blinkTime-.135)/.15;
        else this.nextBlink=this.elapsed+2.8+Math.random()*2.7;
      }
      this.setParameter('ParamEyeLOpen',eye);this.setParameter('ParamEyeROpen',eye);
      for(let i=0;i<this.defaults.length;i++) this.lastBase[i]=model.getParameterValueByIndex(i);
    } else {this.setParameter('ParamEyeLOpen',1);this.setParameter('ParamEyeROpen',1);}
    this._expressionManager.updateMotion(model,dt);
    if(!this.paused){
      this._physics?.evaluate(model,dt);
      // Apply once after physics and before freezing. Each frame starts from
      // defaults, so the ambient offsets never accumulate in model values.
      this.applyHairBreeze();
      this.frozenPhysics=outputIds.map(id=>model.getParameterValueByIndex(this.indices.get(id)));
    } else if(this.frozenPhysics.length){
      outputIds.forEach((id,i)=>this.setParameter(id,this.frozenPhysics[i]));
    }
    this.presentation.update();
    this.draw();
  };
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
    renderer.drawModel(shaderPath);
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
  }
  destroy():void {
    if(this.destroyed)return;
    this.destroyed=true;
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
