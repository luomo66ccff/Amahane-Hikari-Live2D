// SPDX-License-Identifier: MIT
// Real browser fault injection against a local preview; no model QA globals.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const [url,output]=process.argv.slice(2);
if(!url||!output||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Usage: node scripts/test-loading.mjs LOCAL_PREVIEW_URL NEW_REPORT_DIRECTORY');
const out=path.resolve(output);fs.mkdirSync(path.dirname(out),{recursive:true});fs.mkdirSync(out);
const report={status:'RUNNING',url,cases:[]};
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
try{
  for(const fault of ['http-error','invalid-image']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const item={fault,injected:false,unhandledErrors:[],maxTextureRequests:0,recovered:false};report.cases.push(item);
    let failing=true;const pending=new Set();
    page.on('pageerror',e=>item.unhandledErrors.push(String(e)));
    page.on('request',request=>{
      if(request.url().endsWith('.webp')){pending.add(request);item.maxTextureRequests=Math.max(item.maxTextureRequests,pending.size);}
    });
    for(const event of ['requestfinished','requestfailed'])page.on(event,request=>pending.delete(request));
    await page.route('**/texture_01.webp',async route=>{
      if(failing){item.injected=true;await route.fulfill(fault==='http-error'?{status:503,body:'temporary test failure'}:{status:200,contentType:'image/webp',body:'invalid image for decode recovery test'});}
      else await route.continue();
    });
    await page.goto(url,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelector('[data-showcase]')?.dataset.state==='error',null,{timeout:30000});
    assert(item.injected,'Fault must reach the real texture request');
    assert(await page.locator('#retry-button').isVisible(),'Retry is visible');
    await page.waitForTimeout(200);
    failing=false;
    await page.locator('#retry-button').click();
    await page.waitForFunction(()=>document.querySelector('#model-canvas')?.dataset.ready==='true'&&document.querySelector('[data-showcase]')?.dataset.state==='ready',null,{timeout:30000});
    await page.waitForTimeout(500);
    assert.equal(item.unhandledErrors.length,0,'No unhandled error survives retry');
    assert(item.maxTextureRequests<=3,'At most three texture downloads');
    assert.equal(await page.locator('#model-canvas').getAttribute('data-expression'),'Neutral');
    item.recovered=true;
    await page.screenshot({path:path.join(out,fault+'-recovered.png')});
    await page.close();
  }
  const cachedPage=await browser.newPage();
  const cacheCase={fault:'texture-network-blocked-on-revisit',recovered:false,textureNetworkRequests:0};report.cases.push(cacheCase);
  const ready=()=>cachedPage.waitForFunction(()=>document.querySelector('#model-canvas')?.dataset.ready==='true',null,{timeout:30000});
  await cachedPage.goto(url);await ready();
  await cachedPage.route('**/*.webp',async route=>{cacheCase.textureNetworkRequests++;await route.abort();});
  await cachedPage.reload();await ready();
  assert.equal(cacheCase.textureNetworkRequests,0,'Warm visit must use the versioned texture cache');
  cacheCase.recovered=true;await cachedPage.close();
  const noStorage=await browser.newPage();
  const storageCase={fault:'storage-quota-exceeded',recovered:false};report.cases.push(storageCase);
  await noStorage.addInitScript(()=>Object.defineProperty(window,'caches',{value:{open:async()=>({match:async()=>undefined,put:async()=>{throw new DOMException('test quota','QuotaExceededError');}})}}));
  await noStorage.goto(url);
  await noStorage.waitForFunction(()=>document.querySelector('#model-canvas')?.dataset.ready==='true',null,{timeout:30000});
  storageCase.recovered=true;await noStorage.close();
  report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
