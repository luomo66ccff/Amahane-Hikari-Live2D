// SPDX-License-Identifier: MIT
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyUnchanged, inside, walk } from './files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = process.argv[2];
if (!argument || process.argv.length !== 3) throw new Error('Usage: npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5". Download from https://www.live2d.com/en/sdk/download/web/');
const sdk = path.resolve(argument);
const info = await fs.readFile(path.join(sdk,'cubism-info.yml'),'utf8');
if (!/^version:\s*5-r\.5\s*$/m.test(info)) throw new Error('This viewer was verified with Cubism SDK for Web 5-r.5. Supply that version.');
const files = [
  ['Core/live2dcubismcore.min.js','web/public/vendor/live2dcubismcore.min.js'],
  ['Core/live2dcubismcore.d.ts','web/vendor/Core/live2dcubismcore.d.ts'],
  ['Core/LICENSE.md','web/public/licenses/Live2D-Core-LICENSE.md'],
  ['Framework/LICENSE.md','web/public/licenses/Live2D-Framework-LICENSE.md'],
];
for (const [source,destination] of [['Framework/src','web/vendor/Framework/src'],['Framework/Shaders/WebGL','web/public/vendor/shaders']]) {
  for (const relative of await walk(path.join(sdk,source))) files.push([source+'/'+relative,destination+'/'+relative]);
}
for (const [source] of files) {
  const stat = await fs.lstat(inside(sdk,source));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected SDK file: ${source}`);
}
for (const [source,destination] of files) await copyUnchanged(inside(sdk,source),inside(root,destination));
console.log(`Prepared ${files.length} local SDK files under ignored web paths. SDK remains under Live2D's terms.`);
