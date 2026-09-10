// SPDX-License-Identifier: MIT
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, sha256, walk } from './files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'ASSET_MANIFEST.json'), 'utf8'));
const paths = manifest.files.map(file => file.path);
if (new Set(paths).size !== paths.length) throw new Error('Duplicate asset path');
const actual = [...(await walk(path.join(root,'model'))).map(p=>'model/'+p), ...(await walk(path.join(root,'previews'))).map(p=>'previews/'+p)].sort();
if (JSON.stringify(actual) !== JSON.stringify([...paths].sort())) throw new Error('Asset inventory differs from manifest');
for (const item of manifest.files) {
  const bytes = await fs.readFile(inside(root, item.path));
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`Asset differs: ${item.path}`);
  if (bytes.length >= 100 * 1024 * 1024) throw new Error(`Asset exceeds regular Git size limit: ${item.path}`);
}
const runtime = path.join(root,'model/runtime');
const settings = JSON.parse(await fs.readFile(path.join(runtime,'SuJiangXue_HairFlow_t002.model3.json'),'utf8'));
const refs = settings.FileReferences;
const references = [refs.Moc, refs.Physics, refs.DisplayInfo, ...refs.Textures, ...refs.Expressions.map(item=>item.File)].filter(Boolean);
for (const reference of references) {
  if (!(await fs.stat(inside(runtime, reference))).isFile()) throw new Error(`Missing runtime reference: ${reference}`);
}
if (refs.Expressions.length !== 12 || refs.Textures.length !== 2) throw new Error('Unexpected expressions or texture count');
const physics = JSON.parse(await fs.readFile(inside(runtime, refs.Physics),'utf8'));
if (physics.PhysicsSettings.length !== 14 || physics.PhysicsSettings.reduce((sum,group)=>sum+group.Output.length,0) !== 17) throw new Error('Unexpected physics inventory');
const runtimeCount = actual.filter(p=>p.startsWith('model/runtime/')).length;
if (runtimeCount !== 18) throw new Error('Unexpected runtime file count');
console.log(JSON.stringify({status:'PASS',assets:paths.length,runtime_files:runtimeCount,expressions:12,physics_groups:14,physics_outputs:17}));
