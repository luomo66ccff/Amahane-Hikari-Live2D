// SPDX-License-Identifier: MIT
// Preserve PR #2's resource regressions against PR #3's actual implementation.
// The texture loop is extracted from runtime.ts; WebGL is explicitly stubbed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { getEventListeners } from 'node:events';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const ts = require('typescript');
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => {
  const result = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
};
const checks = [];
const test = async (name, run) => { await run(); checks.push(name); };
const timers = new Map();
let nextTimer = 0;
const helper = { exports: {},
  setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
};
vm.runInNewContext(compile(read('../web/src/async-utils.ts')), helper);
const { withTimeout } = helper.exports;
const decode = (image, signal, ms = 20000) => withTimeout(() => image.decode(), ms, 'decode timeout', signal);
const clean = signal => {
  assert.equal(timers.size, 0, 'pending timeout leaked');
  if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0, 'abort listener leaked');
};
const fireTimeout = () => {
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
};
await test('decode success cleanup', async () => {
  const c = new AbortController();
  await decode({ decode: () => Promise.resolve() }, c.signal); clean(c.signal);
});
await test('decode rejection cleanup', async () => {
  const c = new AbortController();
  await assert.rejects(decode({ decode: () => Promise.reject(new Error('decode failed')) }, c.signal), /decode failed/);
  clean(c.signal);
});
await test('synchronous decode throw cleanup', async () => {
  const c = new AbortController();
  await assert.rejects(decode({ decode() { throw new Error('sync failure'); } }, c.signal), /sync failure/);
  clean(c.signal);
});
await test('pre-aborted input does not start decode', async () => {
  const c = new AbortController(); let called = false; c.abort();
  await assert.rejects(decode({ decode() { called = true; return Promise.resolve(); } }, c.signal), { name: 'AbortError' });
  assert.equal(called, false); clean(c.signal);
});
await test('abort pending decode cleanup', async () => {
  const c = new AbortController();
  const pending = decode({ decode: () => new Promise(() => {}) }, c.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  c.abort(); await rejected; clean(c.signal);
});
await test('timeout cleanup', async () => {
  const c = new AbortController();
  const pending = decode({ decode: () => new Promise(() => {}) }, c.signal);
  const rejected = assert.rejects(pending, /decode timeout/);
  fireTimeout(); await rejected; clean(c.signal);
});
await test('abort during synchronous operation startup', async () => {
  const c = new AbortController();
  await assert.rejects(decode({ decode() { c.abort(); return Promise.resolve(); } }, c.signal), { name: 'AbortError' });
  clean(c.signal);
});
await test('late decode rejection after timeout is consumed', async () => {
  const c = new AbortController(); let rejectDecode;
  const pending = decode({ decode: () => new Promise((_, reject) => { rejectDecode = reject; }) }, c.signal);
  const rejected = assert.rejects(pending, /decode timeout/);
  fireTimeout(); await rejected;
  rejectDecode(new Error('late failure')); await Promise.resolve(); clean(c.signal);
});
await test('invalid timeout never starts an operation', async () => {
  const c = new AbortController();
  for (const ms of [0, -1, NaN, Infinity]) {
    let started = false;
    await assert.rejects(decode({ decode() { started = true; return Promise.resolve(); } }, c.signal, ms), /timeoutMs/);
    assert.equal(started, false); clean(c.signal);
  }
});
await test('operation without an AbortSignal', async () => {
  assert.equal(await withTimeout(() => Promise.resolve(42), 10, 'timeout'), 42); clean();
});

const source = read('../web/src/runtime.ts');
const parsed = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
const stageClass = parsed.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'HikariStage');
assert(stageClass, 'Missing actual HikariStage class');
const mount = stageClass.members.find(n => n.name?.getText(parsed) === 'mount');
assert(mount?.body, 'Missing actual mount body');
const loop = mount.body.statements.find(n => ts.isForStatement(n) && n.condition?.getText(parsed).includes('refs.Textures.length'));
assert(loop, 'Missing actual texture loop');
const loopCode = compile('globalThis.run = async function() {' + loop.getText(parsed) + '};');
for (const mode of ['ok', 'allocation-failed', 'upload-failed', 'destroyed', 'decode-failed', 'decode-timeout', 'aborted']) {
  await test('actual texture loop: ' + mode, async () => {
    const revoked = []; const images = []; const texture = {}; const abort = new AbortController();
    let binds = 0;
    let markDecodeStarted;
    const decodeStarted = new Promise(resolve => { markDecodeStarted = resolve; });
    const gl = {
      createTexture: () => mode === 'allocation-failed' ? null : texture,
      bindTexture() {}, pixelStorei() {}, texParameteri() {},
      texImage2D() { if (mode === 'upload-failed') throw new Error('upload failed'); },
    };
    const sandbox = vm.createContext({
      refs: { Textures: ['test.png'] }, textureBytes: [new ArrayBuffer(1)], Blob, withTimeout,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) },
      Image: class {
        src = '';
        constructor() { images.push(this); }
        decode() {
          markDecodeStarted();
          if (mode === 'decode-failed') return Promise.reject(new Error('decode failed'));
          if (mode === 'decode-timeout') return new Promise(() => {});
          if (mode === 'aborted') abort.abort();
          return Promise.resolve();
        }
      },
      renderer: { bindTexture() { binds++; } },
    });
    vm.runInContext(loopCode, sandbox);
    const stage = { textures: [], gl, abort, destroyed: mode === 'destroyed', progress() {}, getTextureCache: async () => null,
      fetchFile: async () => new ArrayBuffer(1) };
    const pending = sandbox.run.call(stage);
    const expected = {
      'allocation-failed': /无法分配模型材质/,
      'upload-failed': /upload failed/,
      'decode-failed': /decode failed/,
      'decode-timeout': /高清材质加载超时/,
      'aborted': { name: 'AbortError' },
    }[mode];
    const completion = expected ? assert.rejects(pending, expected) : pending;
    if (mode === 'decode-timeout') {
      // Cross-VM Promise assimilation can take several microtasks. Wait for
      // the actual operation boundary rather than guessing a microtask count.
      await Promise.race([decodeStarted, completion.then(() => {
        throw new Error('Texture loop finished without starting decode');
      })]);
      fireTimeout();
    }
    await completion;
    assert.equal(stage.textures.length, mode === 'ok' || mode === 'upload-failed' ? 1 : 0);
    assert.equal(binds, mode === 'ok' ? 1 : 0);
    assert.deepEqual(revoked, ['blob:test']);
    assert.equal(images[0].src, ''); clean(abort.signal);
  });
}
console.log(JSON.stringify({ status: 'PASS', cases: checks.length, checks,
  scope: 'Actual async helper and extracted texture loop with GL doubles; no model rendering or GPU allocation test.' }, null, 2));
