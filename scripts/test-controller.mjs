// SPDX-License-Identifier: MIT
// Portable regression of action timing, actual native102 ranges and transitions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const ts=require('typescript');

const source = fs.readFileSync(new URL('../web/src/action-controller.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const module = await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
const {ActionController} = module;
const definitions = JSON.parse(fs.readFileSync(new URL('../model/parameter-definitions.json',import.meta.url),'utf8')).parameters;
const ids = new Map(definitions.map(d=>[d.id,d]));
const finite = s => {
  for (const map of [s.prePhysicsPose,s.postExpressionFace]) for (const [id,value] of Object.entries(map)) {
    assert(ids.has(id),'Unknown native ID: '+id);
    assert(Number.isFinite(value));
    assert(value>=ids.get(id).min-1e-6 && value<=ids.get(id).max+1e-6,id+' exceeds native range');
  }
};
const neutral = s => {
  assert(!s.active);
  for (const [id,value] of Object.entries(s.prePhysicsPose)) assert.equal(value,0,id);
  for (const [id,value] of Object.entries(s.postExpressionFace)) assert.equal(value,/^ParamEye[LR]Open$/.test(id)?1:0,id);
};
let cases=0;
for (const fps of [15,30,60,120]) for (const name of ['curiosity','shy','smug','chewLeft','chewRight']) {
  const c=new ActionController(); c.start(name);
  const seen={gaze:null,head:null,ear:null}; let left=0,right=0,shoulder=0,corner=0;
  for (let i=0;i<fps*2;i++) {
    const s=c.update(1/fps); finite(s); const p=s.prePhysicsPose;
    for (const [key,value] of [['gaze',p.ParamEyeBallX],['head',p.ParamAngleX],['ear',Math.abs(p.ParamEarLAngle)+Math.abs(p.ParamEarRAngle)]]) {
      if (Math.abs(value)>.01 && seen[key]===null) seen[key]=(i+1)/fps;
    }
    left=Math.max(left,Math.abs(p.ParamEarLAngle)); right=Math.max(right,Math.abs(p.ParamEarRAngle));
    shoulder=Math.max(shoulder,Math.abs(p.ParamShoulderLiftL),Math.abs(p.ParamShoulderLiftR));
    corner=Math.max(corner,s.postExpressionFace.ParamMouthCornerRaiseR??0);
    if (name.startsWith('chew')) assert.equal(s.postExpressionFace.ParamMouthOpenY,0);
  }
  neutral(c.snapshot());
  if (name==='curiosity') {assert(left>.29 && right===0);assert(seen.gaze<seen.head && seen.head<seen.ear);}
  if (name==='smug') {assert(right>.23 && left===0);assert(corner>.99);} else assert.equal(corner,0);
  if (name==='shy') assert(shoulder>=.017 && shoulder<=.01800001);
  cases++;
}
assert(module.getActionRequiredParameterIds('smug').includes('ParamMouthCornerRaiseR'));
for (const name of ['curiosity','shy','chewLeft','chewRight']) assert(!module.getActionRequiredParameterIds(name).includes('ParamMouthCornerRaiseR'));
const c=new ActionController(); c.start('curiosity');for(let i=0;i<35;i++)c.update(.01);
const frozen=c.snapshot();c.update(500,true);
assert.equal(c.snapshot().paused,true);
assert.deepEqual({...c.snapshot(),paused:false},{...frozen,paused:false});
c.update(500,false);assert(c.snapshot().elapsed<.7);
for (const name of ['shy','chewLeft','smug','chewRight','curiosity']) {
  c.start(name);for(let i=0;i<24;i++)finite(c.update(1/120));c.cancel();for(let i=0;i<40;i++)finite(c.update(1/120));neutral(c.snapshot());
}
c.start('smug');c.update(.25);neutral(c.reset());cases++;
console.log(JSON.stringify({status:'PASS',cases,scope:'Controller intents and timing only; rendered model and mouth ownership require browser QA.'}));
