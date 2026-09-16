// SPDX-License-Identifier: MIT
// Generate lossless web-only textures. Canonical Cubism exports stay unchanged.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {copyUnchanged,inside,sha256,walk} from './files.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const sharp=require('sharp');
const root=fileURLToPath(new URL('../',import.meta.url));
export const WEB_MODEL_VERSION='hikari_t002';
export const WEB_MODEL_FILE='SuJiangXue_HikariSmirk_t001.model3.json';
const encoding={lossless:true,exact:true,effort:6};

export async function prepareWebModel(){
  const source=path.join(root,'model/runtime');
  const target=path.join(root,'web/public/model',WEB_MODEL_VERSION);
  const settings=JSON.parse(await fs.readFile(path.join(source,WEB_MODEL_FILE),'utf8'));
  const originals=[...settings.FileReferences.Textures];
  const textureRows=[];
  const manifestPath=path.join(target,'web-texture-manifest.json');
  let previous;
  try{previous=JSON.parse(await fs.readFile(manifestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(let index=0;index<originals.length;index++){
    const input=originals[index];const output=input.replace(/\.png$/i,'.webp');
    if(output===input)throw new Error('Expected PNG source texture');
    const bytes=await fs.readFile(inside(source,input));const sourceHash=sha256(bytes);
    const record=previous?.textures.find(row=>row.source===input);
    let encoded,info;
    if(record&&record.sourceSha256===sourceHash&&record.rgbaExact&&JSON.stringify(previous.encoding)===JSON.stringify(encoding)&&previous.sharp===sharp.versions.sharp){
      encoded=await fs.readFile(inside(target,output));
      if(sha256(encoded)!==record.webpSha256)throw new Error('Generated texture changed: '+output);
      info={width:record.width,height:record.height};
    }else{
      encoded=await sharp(bytes).keepIccProfile().webp(encoding).toBuffer();
      const original=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(original.info.width!==decoded.info.width||original.info.height!==decoded.info.height||!original.data.equals(decoded.data))throw new Error('Lossless RGBA verification failed: '+input);
      info=original.info;
      const dest=inside(target,output);await fs.mkdir(path.dirname(dest),{recursive:true});
      try{const existing=await fs.readFile(dest);if(!existing.equals(encoded))throw new Error('Immutable web model changed; increment WEB_MODEL_VERSION');}
      catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(dest,encoded,{flag:'wx'});}
    }
    textureRows.push({source:input,output,sourceBytes:bytes.length,webpBytes:encoded.length,sourceSha256:sourceHash,webpSha256:sha256(encoded),width:info.width,height:info.height,rgbaExact:true});
    settings.FileReferences.Textures[index]=output;
  }
  for(const relative of await walk(source)){
    if(relative===WEB_MODEL_FILE||originals.includes(relative))continue;
    await copyUnchanged(inside(source,relative),inside(target,relative));
  }
  const modelBytes=Buffer.from(JSON.stringify(settings,null,2)+'\n');
  const modelPath=path.join(target,WEB_MODEL_FILE);
  try{if(!(await fs.readFile(modelPath)).equals(modelBytes))throw new Error('Immutable model descriptor changed; increment WEB_MODEL_VERSION');}
  catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(modelPath,modelBytes,{flag:'wx'});}
  const manifest={schema:'hikari-web-textures/v1',version:WEB_MODEL_VERSION,sharp:sharp.versions.sharp,encoding,textures:textureRows,
    sourceBytes:textureRows.reduce((n,r)=>n+r.sourceBytes,0),webpBytes:textureRows.reduce((n,r)=>n+r.webpBytes,0)};
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({status:'PASS_LOSSLESS_WEB_TEXTURES',textures:textureRows.length,sourceBytes:manifest.sourceBytes,webpBytes:manifest.webpBytes,rgbaExact:true}));
  return manifest;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await prepareWebModel();
