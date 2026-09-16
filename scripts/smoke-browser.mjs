// SPDX-License-Identifier: MIT
// Real HTTP smoke check. Does not expose or inject model-control QA globals.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const [url,output]=process.argv.slice(2);
if (!url || !output || !/^https?:\/\//.test(url)) throw new Error('Usage: node scripts/smoke-browser.mjs URL NEW_REPORT_DIRECTORY');
const out=path.resolve(output);
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.mkdirSync(out,{recursive:false}); // Never replace previous evidence.
const report={schema:'hikari-browser-smoke/v1',url,status:'RUNNING',pages:[],errors:[],scope:'Production UI, resources and screenshots; native geometry was validated separately.'};
let browser;
try {
  const disableQuic=process.env.BROWSER_DISABLE_QUIC==='1';
  report.disableQuic=disableQuic;
  const http1=process.env.BROWSER_HTTP1==='1';report.http1=http1;
  browser=await chromium.launch({headless:true,args:http1?['--disable-quic','--disable-http2']:(disableQuic?['--disable-quic']:[]),...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.BROWSER_PROXY?{proxy:{server:process.env.BROWSER_PROXY}}:{})});
  report.browserVersion=browser.version();
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const item={viewport,checks:[],screenshots:[],modelRequests:[]};report.pages.push(item);
    page.on('pageerror',e=>report.errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
    page.on('requestfailed',r=>report.errors.push(`${r.failure()?.errorText} ${r.url()}`));
    page.on('request',r=>{if(r.url().includes('/model/'))item.modelRequests.push(new URL(r.url()).pathname);});
    const check=(name,condition)=>{item.checks.push({name,pass:!!condition});assert(condition,name);};
    const shot=async name=>{const file=`${viewport.width}-${name}.png`;await page.screenshot({path:path.join(out,file)});item.screenshots.push(file);};
    const ready=()=>page.waitForFunction(()=>document.querySelector('#model-canvas')?.dataset.ready==='true'&&document.querySelector('[data-showcase]')?.dataset.state==='ready',null,{timeout:120000});
    // Use the ordinary URL on desktop and the QA-query URL on narrow screens.
    // Both load the full real production model; avoid an extra 45 MB reload per case.
    const pageUrl=viewport.width<500?url+(url.includes('?')?'&':'?')+'__hikariQa=1':url;
    item.url=pageUrl;
    const response=await page.goto(pageUrl,{waitUntil:'load',timeout:120000});check('HTTP 200',response.status()===200);await ready();
    check('No production QA global',await page.evaluate(()=>typeof window.__hikariQa==='undefined'&&typeof window.__charmQa==='undefined'));
    check('No horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await shot('ready');
    for (const action of ['curiosity','shy','smug']) {
      const button=page.locator(`[data-hikari-action="${action}"]`);check(`${action} enabled`,await button.isEnabled());await button.click();await page.waitForTimeout(400);await shot(action);
    }
    await page.locator('#pause-toggle').click();check('Pause on',await page.locator('#pause-toggle').getAttribute('aria-pressed')==='true');
    await page.locator('#pause-toggle').click();check('Pause off',await page.locator('#pause-toggle').getAttribute('aria-pressed')==='false');
    for (const button of await page.locator('button[data-expression]').all()) {
      const expression=await button.getAttribute('data-expression');await button.click();
      check(`Expression ${expression}`,await page.locator('#model-canvas').getAttribute('data-expression')===expression);
    }
    await page.locator('#settings-toggle').click();
    await page.locator('#zoom-range').fill('1.2');
    check('Zoom',await page.locator('#model-canvas').getAttribute('data-zoom')==='1.2');
    await page.locator('#follow-toggle').click();
    check('Follow off',await page.locator('#follow-toggle').getAttribute('aria-pressed')==='false');
    for (const outfit of [0,1,2,0]) {
      await page.locator(`button[data-outfit="${outfit}"]`).click();await page.waitForTimeout(250);
      check(`Outfit ${outfit}`,await page.locator('#model-canvas').getAttribute('data-outfit')===String(outfit));
      if(outfit!==0){await page.locator('#settings-close').click();await shot(`outfit-${outfit}`);await page.locator('#settings-toggle').click();}
    }
    await page.locator('#reset-button').click();await page.waitForTimeout(250);
    check('Reset neutral',await page.locator('#model-canvas').getAttribute('data-expression')==='Neutral');
    const modelUrl=new URL('model/hikari_t001/SuJiangXue_HikariSmirk_t001.model3.json',url).href;
    const modelResponse=await page.request.get(modelUrl);check('Current model HTTP 200',modelResponse.status()===200);
    const model=await modelResponse.json();check('Eight textures',model.FileReferences.Textures.length===8);
    check('Current model requested',item.modelRequests.some(p=>p.endsWith('/hikari_t001/SuJiangXue_HikariSmirk_t001.model3.json')));
    check('Production QA remains absent after interactions',await page.evaluate(()=>typeof window.__hikariQa==='undefined'&&typeof window.__charmQa==='undefined'));
    await page.close();
  }
  assert.equal(report.errors.length,0,'Browser/resource errors');report.status='PASS';
} catch(e) {report.status='FAIL';report.errors.push(String(e.stack??e));process.exitCode=1;}
finally {await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,checks:report.pages.reduce((n,p)=>n+p.checks.length,0),errors:report.errors.length,output:out}));}
