// SPDX-License-Identifier: MIT
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './verify-package.mjs';
import { copyUnchanged, inside, walk } from './files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = ['web/vendor/Core/live2dcubismcore.d.ts','web/vendor/Framework/src/live2dcubismframework.ts','web/public/vendor/live2dcubismcore.min.js','web/public/vendor/shaders/vertshadersrc.vert'];
for (const relative of required) {
  try { await fs.access(path.join(root,relative)); }
  catch { throw new Error('Live2D SDK is not set up. Run npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5" from web/. See README.md.'); }
}
const source = path.join(root,'model/runtime');
const destination = path.join(root,'web/public/model/v2');
for (const relative of await walk(source)) await copyUnchanged(inside(source,relative),inside(destination,relative));
console.log('Model resources are ready.');
