// SPDX-License-Identifier: MIT
// Real browser event propagation, using the actual main.ts listener and README
// examples. No Cubism SDK, model or microphone is loaded by this fixture.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const ts=require('typescript');
const {chromium}=require('playwright');
const source=fs.readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8');
const parsed=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const listeners=parsed.statements.filter(node=>{
  if(!ts.isExpressionStatement(node)||!ts.isCallExpression(node.expression))return false;
  const call=node.expression;
  return ts.isPropertyAccessExpression(call.expression)&&call.expression.name.text==='addEventListener'
    &&ts.isStringLiteral(call.arguments[0])&&call.arguments[0].text==='hikari:mouth-input';
});
assert.equal(listeners.length,1,'Expected exactly one public mouth-input registration');
const listener=ts.transpileModule(listeners[0].getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
const examples=[...readme.matchAll(/```(?:js|javascript)\r?\n([\s\S]*?)```/g)]
  .map(match=>match[1]).filter(code=>code.includes('hikari:mouth-input'));
assert.equal(examples.length,1,'Expected a documented send-and-clear example');
const options={headless:true};
if(process.env.BROWSER_EXECUTABLE_PATH)options.executablePath=process.env.BROWSER_EXECUTABLE_PATH;
else if(process.env.BROWSER_CHANNEL)options.channel=process.env.BROWSER_CHANNEL;
const browser=await chromium.launch(options);
let cases=0;
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="target"></div></body></html>');
  await page.addScriptTag({content:`
    window.__inputs=[];
    let engine={setMouthInput:detail=>window.__inputs.push(detail)};
    window.__replaceEngine=value=>{engine=value;};
    ${listener}
  `});
  await page.evaluate(code=>{window.eval(code);},examples[0]);
  assert.deepEqual(await page.evaluate(()=>window.__inputs),[
    {open:0.2,form:0,pucker:0,ttlMs:180},null,
  ]);cases++;
  for(const target of ['window','document','element'])for(const bubbles of [false,true]){
    const result=await page.evaluate(({target,bubbles})=>{
      window.__inputs.length=0;
      const object=target==='window'?window:target==='document'?document:document.querySelector('#target');
      const detail={open:0.4,ttlMs:100};
      object.dispatchEvent(new CustomEvent('hikari:mouth-input',{detail,bubbles}));
      return window.__inputs;
    },{target,bubbles});
    assert.deepEqual(result,[{open:0.4,ttlMs:100}],`${target}, bubbles=${bubbles}: exactly once`);cases++;
  }
  await page.evaluate(()=>{
    window.__inputs.length=0;
    window.dispatchEvent(new CustomEvent('hikari:unrelated',{detail:{open:1}}));
  });
  assert.deepEqual(await page.evaluate(()=>window.__inputs),[]);cases++;
  await page.evaluate(()=>{
    window.__replaceEngine(null);
    window.dispatchEvent(new CustomEvent('hikari:mouth-input',{detail:{open:0.5}}));
    window.__replaceEngine({setMouthInput:detail=>window.__inputs.push(detail)});
    document.dispatchEvent(new CustomEvent('hikari:mouth-input',{detail:null}));
  });
  assert.deepEqual(await page.evaluate(()=>window.__inputs),[null]);cases++;
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',cases,browser:browser.version(),
    scope:'Actual main.ts listener + README example in Chromium; no SDK, model rendering or mouth-ownership acceptance.'}));
} finally {await browser.close();}
