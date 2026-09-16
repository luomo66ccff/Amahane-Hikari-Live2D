// SPDX-License-Identifier: MIT
// SDK-free boundary tests. Real runtime methods run against model/GL stubs;
// this is not a rendered-model, native-physics or full-build acceptance test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const ts=require('typescript');
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const compile=source=>{
  const result=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }});
  assert.equal((result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  return result.outputText;
};
const load=(path,globals={})=>{
  const sandbox={exports:{},setTimeout,clearTimeout,...globals};
  vm.runInNewContext(compile(read(path)),sandbox,{filename:path});
  return sandbox.exports;
};
const timing=load('../web/src/frame-time.ts');
const {frameDeltaSeconds,forEachPhysicsStep,MAX_FRAME_DELTA_SECONDS,MAX_PHYSICS_STEP_SECONDS}=timing;
let cases=0;
const close=(actual,expected,label='')=>assert(Math.abs(actual-expected)<1e-9,`${label}: ${actual} != ${expected}`);

// Strict type-check the new, SDK-independent production modules.
const program=ts.createProgram(['frame-time.ts','decode-image.ts'].map(name=>
  fileURLToPath(new URL('../web/src/'+name,import.meta.url))),{
  strict:true,noEmit:true,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
});
const diagnostics=ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{
  getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=>'\n',
}));
cases++;
for(const [now,previous,expected] of [
  [1000,null,0],[1000,1000,0],[999,1000,0],[NaN,0,0],[Infinity,0,0],
  [100,NaN,0],[100,Infinity,0],[60000,0,MAX_FRAME_DELTA_SECONDS],[1000/15,0,1/15],
]){close(frameDeltaSeconds(now,previous),expected,'frame delta');cases++;}
for(const dt of [0,-1,NaN,Infinity,1/120,1/60,1/30,1/15,0.1,500]){
  const steps=[];forEachPhysicsStep(dt,step=>steps.push(step));
  assert(steps.every(step=>step>0&&step<=MAX_PHYSICS_STEP_SECONDS+1e-12));
  assert(steps.length<=Math.ceil(MAX_FRAME_DELTA_SECONDS/MAX_PHYSICS_STEP_SECONDS));
  close(steps.reduce((a,b)=>a+b,0),Number.isFinite(dt)&&dt>0?Math.min(dt,MAX_FRAME_DELTA_SECONDS):0);
  cases++;
}

// Extract the actual runtime methods with TypeScript's parser. Never maintain
// a second copy of tick() in the tests: the old 1/30 clamp must fail this suite.
const runtime=read('../web/src/runtime.ts');
compile(runtime);
const parsed=ts.createSourceFile('runtime.ts',runtime,ts.ScriptTarget.Latest,true);
const stageClass=parsed.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='HikariStage');
assert(stageClass);
const member=name=>{
  const node=stageClass.members.find(n=>n.name?.getText(parsed)===name);
  assert(node,'Missing runtime member: '+name);return node;
};
const names=['lastTime','elapsed','activeMouthInput','tick','setPaused','onVisibility','setMouthInput','expireMouthInput'];
const mouthConstants=parsed.statements.filter(n=>ts.isVariableStatement(n)&&
  n.declarationList.declarations.some(d=>d.name.getText(parsed).startsWith('MOUTH_INPUT_')));
let nowMs=0;
const context=vm.createContext({
  ...timing,document:{hidden:false},performance:{now:()=>nowMs},
  requestAnimationFrame:()=>1,outputIds:['stubPhysics'],
});
vm.runInContext(compile(mouthConstants.map(n=>n.getText(parsed)).join('\n')+
  '\nglobalThis.RuntimeHarness=class {\n'+names.map(n=>member(n).getText(parsed)).join('\n')+'\n};'),context);
const fixture=()=>{
  context.document.hidden=false;nowMs=0;
  const calls={action:[],physics:[],expression:[],secondary:[],draws:0,blur:0};
  let actionElapsed=0;
  const stage=Object.assign(new context.RuntimeHarness(),{
    destroyed:false,ready:true,paused:false,debugEnabled:false,canvas:{dataset:{}},
    defaults:[],lastBase:[],frozenParameters:[],indices:new Map(),
    debugController:{getControls:()=>({idleEnabled:false,physicsEnabled:true,blinkEnabled:false,expressionEnabled:true})},
    _model:{setParameterValueByIndex(){},getParameterValueByIndex:()=>0},
    actionController:{update(dt,paused){calls.action.push(dt);if(!paused)actionElapsed+=dt;return {active:false,transition:{active:false}};}},
    _expressionManager:{updateMotion(model,dt){calls.expression.push(dt);}},
    _physics:{evaluate(model,dt){calls.physics.push(dt);}},
    applySecondaryMotion(dt){calls.secondary.push(dt);},
    applyOutfit(){},enforceGentleArmBounds(){},applyMouthInput(){},applyDebugOverrides(){},
    presentation:{update(){}},draw(){calls.draws++;},onBlur(){calls.blur++;},
  });
  const tick=time=>{nowMs=time;stage.tick(time);};
  return {stage,calls,tick,actionElapsed:()=>actionElapsed};
};
for(const fps of [15,30,60,120]){
  const f=fixture();f.tick(0);
  close(f.stage.elapsed,0,'first frame must not invent time');
  for(let i=1;i<=fps;i++)f.tick(i*1000/fps);
  close(f.stage.elapsed,1,`${fps} FPS runtime`);
  close(f.actionElapsed(),1,`${fps} FPS action input`);
  for(const name of ['physics','expression','secondary'])close(f.calls[name].reduce((a,b)=>a+b,0),1,`${fps} FPS ${name}`);
  assert(f.calls.physics.every(dt=>dt<=MAX_PHYSICS_STEP_SECONDS+1e-12));
  assert.equal(f.calls.draws,fps+1,'substeps must not multiply draws');
  assert.equal(f.calls.secondary.length,fps+1,'ambient additives applied once per frame');
  cases++;
}
{
  const f=fixture();f.tick(0);f.tick(1000/15);
  const elapsed=f.stage.elapsed;const physicsCalls=f.calls.physics.length;
  f.stage.setPaused(true);f.tick(10000);f.tick(20000);
  close(f.stage.elapsed,elapsed);close(f.actionElapsed(),elapsed);
  assert.equal(f.calls.physics.length,physicsCalls);
  f.stage.setPaused(false);f.tick(30000);close(f.stage.elapsed,elapsed);
  f.tick(30000+1000/15);close(f.stage.elapsed,elapsed+1/15);cases++;
}
{
  const f=fixture();f.tick(0);f.tick(1000/30);
  const elapsed=f.stage.elapsed;
  context.document.hidden=true;f.stage.onVisibility();f.tick(60000);
  close(f.stage.elapsed,elapsed);assert.equal(f.calls.blur,1);
  context.document.hidden=false;f.stage.onVisibility();f.tick(120000);
  close(f.stage.elapsed,elapsed);f.tick(120000+1000/30);close(f.stage.elapsed,elapsed+1/30);cases++;
}
{
  const f=fixture();f.tick(0);f.tick(60000);close(f.stage.elapsed,MAX_FRAME_DELTA_SECONDS);
  const draws=f.calls.draws;f.stage.destroyed=true;f.tick(60001);assert.equal(f.calls.draws,draws);cases++;
}
{
  const f=fixture();nowMs=100;
  f.stage.setMouthInput({open:0.2});assert.equal(f.stage.activeMouthInput.expiresAt,280);
  const saved=f.stage.activeMouthInput;
  for(const input of [undefined,[],{}, {open:NaN},{open:Infinity},{open:-1},{open:2},
    {open:0,form:2},{open:0,pucker:-1},{open:0,ttlMs:0},{open:0,ttlMs:1001},{open:0,extra:1}]){
    assert.throws(()=>f.stage.setMouthInput(input));assert.equal(f.stage.activeMouthInput,saved);cases++;
  }
  f.stage.setPaused(true);f.tick(281);assert.equal(f.stage.activeMouthInput,null,'TTL still expires while paused');
  f.stage.setMouthInput({open:1,form:-1,pucker:1,ttlMs:1});
  f.stage.setMouthInput(null);assert.equal(f.stage.activeMouthInput,null);cases++;
}

// Fake timers make decode cleanup deterministic; AbortSignal itself is real.
const timers=new Map();let nextTimer=0;
const {decodeImage}=load('../web/src/decode-image.ts',{
  setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},
  clearTimeout(id){timers.delete(id);},
});
const clean=signal=>{assert.equal(timers.size,0);assert.equal(getEventListeners(signal,'abort').length,0);};
{
  const c=new AbortController();await decodeImage({decode:()=>Promise.resolve()},c.signal);clean(c.signal);cases++;
}
{
  const c=new AbortController();await assert.rejects(decodeImage({decode:()=>Promise.reject(new Error('decode failed'))},c.signal),/decode failed/);clean(c.signal);cases++;
}
{
  const c=new AbortController();await assert.rejects(decodeImage({decode(){throw new Error('sync failure');}},c.signal),/sync failure/);clean(c.signal);cases++;
}
{
  const c=new AbortController();let called=false;c.abort();
  await assert.rejects(decodeImage({decode(){called=true;return Promise.resolve();}},c.signal),{name:'AbortError'});
  assert.equal(called,false);clean(c.signal);cases++;
}
{
  const c=new AbortController();const pending=decodeImage({decode:()=>new Promise(()=>{})},c.signal);
  const rejected=assert.rejects(pending,{name:'AbortError'});c.abort();await rejected;clean(c.signal);cases++;
}
{
  const c=new AbortController();const pending=decodeImage({decode:()=>new Promise(()=>{})},c.signal);
  assert.equal(timers.size,1);const rejected=assert.rejects(pending,/高清材质加载超时/);
  [...timers.values()][0]();await rejected;clean(c.signal);cases++;
}
{
  const c=new AbortController();await assert.rejects(decodeImage({decode(){c.abort();return Promise.resolve();}},c.signal),{name:'AbortError'});clean(c.signal);cases++;
}

// Execute the real texture loop with GL stubs to test ownership on failures.
const textureLoop=member('mount').body.statements.find(n=>ts.isForStatement(n)&&n.condition?.getText(parsed).includes('refs.Textures.length'));
assert(textureLoop);
for(const mode of ['ok','allocation-failed','upload-failed','destroyed']){
  const revoked=[];const images=[];const texture={};let binds=0;
  const gl={createTexture:()=>mode==='allocation-failed'?null:texture,
    bindTexture(){},pixelStorei(){},texImage2D(){if(mode==='upload-failed')throw new Error('upload failed');},texParameteri(){}};
  const sandbox=vm.createContext({
    refs:{Textures:['test.png']},Blob,
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)},
    Image:class{src='';constructor(){images.push(this);}},decodeImage:async()=>{},
    renderer:{bindTexture(){binds++;}},
  });
  vm.runInContext(compile('globalThis.run=async function(){'+textureLoop.getText(parsed)+'};'),sandbox);
  const stage={textures:[],gl,abort:new AbortController(),destroyed:mode==='destroyed',progress(){},fetchFile:async()=>new ArrayBuffer(1)};
  const promise=sandbox.run.call(stage);
  if(mode==='allocation-failed')await assert.rejects(promise,/显存不足/);
  else if(mode==='upload-failed')await assert.rejects(promise,/upload failed/);
  else await promise;
  assert.equal(stage.textures.length,mode==='ok'||mode==='upload-failed'?1:0);
  assert.equal(binds,mode==='ok'?1:0);assert.deepEqual(revoked,['blob:test']);assert.equal(images[0].src,'');cases++;
}
console.log(JSON.stringify({status:'PASS',cases,typescript:ts.version,
  scope:'SDK-free: actual tick/event-input/texture-loop methods with stubs, strict helper types and decode cleanup. No native rendering or full build.'}));
