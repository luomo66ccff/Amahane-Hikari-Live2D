// SPDX-License-Identifier: MIT
// Cold / warm HTTP loading evidence. Canvas readiness is measured separately from LCP.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const [url,output]=process.argv.slice(2);
if(!url||!output)throw new Error('Usage: node scripts/measure-load.mjs URL NEW_OUTPUT_DIRECTORY');
const out=path.resolve(output);fs.mkdirSync(path.dirname(out),{recursive:true});fs.mkdirSync(out);
const report={url,scope:'Lab cold/warm page and actual canvas readiness, not field Core Web Vitals',runs:[]};
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge',args:process.env.BROWSER_HTTP1==='1'?['--disable-http2','--disable-quic']:[]});
report.browser=browser.version();report.http1=process.env.BROWSER_HTTP1==='1';
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await context.addInitScript(()=>{
  window.__loadMetrics={readyMs:null,lcpMs:null,errors:[]};
  new MutationObserver(()=>{if(window.__loadMetrics.readyMs===null&&document.querySelector('#model-canvas')?.dataset.ready==='true')window.__loadMetrics.readyMs=performance.now();}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-ready']});
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__loadMetrics.lcpMs=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
});
const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
const mbps=Number(process.env.MEASURE_MBPS||0);
if(mbps>0){await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:mbps*1e6/8,uploadThroughput:5e6/8});report.network={downloadMbps:mbps,latencyMs:40};}
let active;
page.on('pageerror',e=>active?.errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)active?.errors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
page.on('requestfailed',r=>active?.errors.push(`${r.failure()?.errorText} ${new URL(r.url()).pathname}`));
cdp.on('Network.responseReceived',e=>{if(active)active.responses.push({id:e.requestId,path:new URL(e.response.url).pathname,status:e.response.status,protocol:e.response.protocol,fromDiskCache:!!e.response.fromDiskCache,cacheControl:e.response.headers['cache-control']??e.response.headers['Cache-Control']??null});});
cdp.on('Network.loadingFinished',e=>{if(active){active.transferredBytes+=e.encodedDataLength;active.transfers.push({id:e.requestId,bytes:e.encodedDataLength});}});
try{
  for(const mode of ['cold','warm']){
    active={mode,errors:[],responses:[],transfers:[],transferredBytes:0,status:'RUNNING'};report.runs.push(active);
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
      await page.waitForFunction(()=>window.__loadMetrics.readyMs!==null,null,{timeout:75000});
      await page.waitForTimeout(800);active.status='PASS';
    }catch(e){active.status='FAIL';active.errors.push(String(e.message));}
    active.metrics=await page.evaluate(()=>({...window.__loadMetrics,fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),resources:performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,startMs:e.startTime,durationMs:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,protocol:e.nextHopProtocol}))}));
    if(active.errors.length)active.status='FAIL';
    await page.screenshot({path:path.join(out,`${mode}.png`)});
  }
}finally{
  await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report.runs.map(r=>({mode:r.mode,status:r.status,modelReadyMs:r.metrics?.readyMs,fcpMs:r.metrics?.fcpMs,transferredBytes:r.transferredBytes,errors:r.errors.length}))));
  if(report.runs.some(r=>r.status!=='PASS'))process.exitCode=1;
}
