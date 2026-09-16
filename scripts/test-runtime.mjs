// SPDX-License-Identifier: MIT
// SDK-free contracts: execute the real runtime with explicit SDK/controller
// doubles. This proves wiring/timing/ownership, not Cubism rendering quality.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const ts = require('typescript');
const sourceUrl = name => new URL(`../web/src/${name}`, import.meta.url);
const transpile = (source, module = ts.ModuleKind.ESNext) => {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.length ?? 0, 0, 'TypeScript transpilation diagnostics');
  return result.outputText;
};
const loadHelper = async name => import('data:text/javascript;base64,' + Buffer.from(
  transpile(fs.readFileSync(sourceUrl(name), 'utf8')),
).toString('base64'));
const timing = await loadHelper('frame-timing.ts');
const asyncUtils = await loadHelper('async-utils.ts');
const runtimeSource = fs.readFileSync(sourceUrl('runtime.ts'), 'utf8');
// Vite normally replaces these two environment constants during bundling.
const runtimeJs = transpile(runtimeSource.replaceAll('import.meta.env', '__viteEnv'), ts.ModuleKind.CommonJS);
const checks = [];
const test = async (name, fn) => { await fn(); checks.push(name); };
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function makeStage() {
  const calls = { action: [], physics: [], expression: [], secondary: [], draws: 0, presentation: 0 };
  let now = 1000;
  let actionElapsed = 0;
  const document = { hidden: false, addEventListener() {}, removeEventListener() {},
    documentElement: { addEventListener() {}, removeEventListener() {} } };
  class ActionDouble {
    update(dt, paused = false) {
      if (!paused) actionElapsed += dt;
      calls.action.push({ dt, paused });
      return { active: true, action: 'curiosity', phase: 'hold', elapsed: actionElapsed,
        duration: 1.76, progress: 0, paused, transition: { active: false },
        prePhysicsPose: { intents: {} }, postExpressionFace: { intents: {} } };
    }
    reset() { actionElapsed = 0; }
  }
  class ControllerDouble { reset() {} }
  const modules = {
    '@framework/model/cubismusermodel': { CubismUserModel: class {} },
    '@framework/live2dcubismframework': {},
    '@framework/math/cubismmatrix44': {},
    '@framework/motion/acubismmotion': {},
    '@framework/rendering/cubismshader_webgl': {},
    '@framework/rendering/cubismoffscreenmanager': {},
    '@framework/rendering/cubismrenderer_webgl': {},
    './presentation': {},
    './runtime-capabilities': {},
    './presence': { PresenceController: ControllerDouble },
    './expressive-rebound': { ExpressiveRebound: ControllerDouble },
    './secondary-motion': {
      SecondaryMotionController: class extends ControllerDouble {
        update(dt) { calls.secondary.push(dt); return { additives: {} }; }
      },
      secondaryMotionChannels: [],
    },
    './action-controller': {
      ACTION_NAMES: ['curiosity', 'shy', 'smug'],
      CHEW_ACTION_NAMES: ['chewLeft', 'chewRight'],
      CHEW_ACTION_PARAMETER_IDS: [],
      ActionController: ActionDouble,
    },
    './frame-timing': timing,
    './async-utils': asyncUtils,
  };
  const context = {
    exports: {}, __viteEnv: { DEV: false, BASE_URL: '/' },
    require(id) { assert(Object.hasOwn(modules, id), `Unmocked dependency: ${id}`); return modules[id]; },
    document, window: { addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    AbortController, AbortSignal, URL, performance: { now: () => now },
  };
  vm.runInNewContext(runtimeJs, context, { filename: 'runtime.test.cjs' });
  const canvas = { closest: () => null, style: {}, dataset: {},
    getContext: () => ({ MAX_TEXTURE_SIZE: 3379, getParameter: () => 8192 }),
    addEventListener() {}, removeEventListener() {} };
  const stage = new context.exports.HikariStage(canvas, () => {}, () => {});
  const values = new Map();
  stage._model = {
    getParameterValueByIndex: index => values.get(index) ?? 0,
    setParameterValueByIndex: (index, value) => values.set(index, value),
    getParameterMinimumValue: index => index === 1 ? -1 : 0,
    getParameterMaximumValue: () => 1,
  };
  stage._physics = { evaluate: (_model, dt) => calls.physics.push(dt), stabilization() {} };
  stage._expressionManager = { updateMotion: (_model, dt) => calls.expression.push(dt), stopAllMotions() {} };
  stage.debugController = {
    getControls: () => ({ idleEnabled: false, physicsEnabled: true, blinkEnabled: false, expressionEnabled: true }),
    applyFinalOverrides: () => ({}), reset() {},
  };
  stage.presentation = { update: () => { calls.presentation++; }, setRawNativeGaze() {} };
  stage.draw = () => { calls.draws++; };
  stage.ready = true;
  return { stage, calls, document, values, setNow: value => { now = value; }, getActionElapsed: () => actionElapsed };
}

await test('strict type checking of SDK-independent helpers', () => {
  const program = ts.createProgram(['frame-timing.ts', 'async-utils.ts'].map(name => fileURLToPath(sourceUrl(name))), {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
});
for (const fps of [10, 15, 30, 60, 120]) {
  await test(`real runtime pipeline preserves wall time at ${fps} FPS`, () => {
    const f = makeStage();
    f.stage.tick(0);
    near(f.stage.elapsed, 0);
    for (let i = 1; i <= fps * 2; i++) f.stage.tick(i * 1000 / fps);
    near(f.stage.elapsed, 2);
    near(f.getActionElapsed(), 2);
    for (const samples of [f.calls.physics, f.calls.expression, f.calls.secondary]) {
      near(samples.reduce((sum, dt) => sum + dt, 0), 2);
      assert(samples.every(dt => dt >= 0 && dt <= timing.MAX_SIMULATION_STEP_SECONDS + 1e-12));
    }
    assert.equal(f.calls.draws, fps * 2 + 1);
    assert.equal(f.calls.presentation, f.calls.draws, 'present once, not once per substep');
  });
}
await test('long stalls have bounded catch-up work', () => {
  const f = makeStage(); f.stage.tick(0); f.stage.tick(60_000);
  near(f.stage.elapsed, timing.MAX_FRAME_SECONDS);
  assert(f.calls.physics.length <= 9, 'at most eight substeps plus initial sample');
  assert.equal(f.calls.draws, 2);
});
await test('pause, resume, visibility and reset do not advance hidden time', () => {
  const f = makeStage(); f.stage.tick(0); f.stage.tick(100);
  const elapsed = f.stage.elapsed;
  const physicsCalls = f.calls.physics.length;
  f.stage.setPaused(true); f.stage.tick(1000); f.stage.tick(2000);
  near(f.stage.elapsed, elapsed); near(f.getActionElapsed(), elapsed);
  assert.equal(f.calls.physics.length, physicsCalls);
  f.stage.setPaused(false); f.stage.tick(3000);
  near(f.stage.elapsed, elapsed);
  f.stage.tick(3100); near(f.stage.elapsed, elapsed + 0.1);
  f.document.hidden = true; f.stage.onVisibility(); f.stage.tick(20_000);
  const draws = f.calls.draws;
  f.document.hidden = false; f.stage.onVisibility(); f.stage.tick(30_000);
  near(f.stage.elapsed, elapsed + 0.1); assert.equal(f.calls.draws, draws + 1);
  f.stage.reset(); f.stage.tick(40_000); near(f.stage.elapsed, 0);
});
await test('invalid and reversed timestamps never advance negative/non-finite time', () => {
  for (const [now, previous] of [[NaN, 0], [Infinity, 0], [100, NaN], [100, Infinity], [-1, 0], [0, -1], [99, 100]]) {
    const result = timing.getFrameTiming(now, previous);
    assert.equal(result.elapsedSeconds, 0);
    assert.equal(result.stepCount, 1);
  }
  const f = makeStage(); f.stage.tick(0); f.stage.tick(NaN); f.stage.tick(100); f.stage.tick(200);
  near(f.stage.elapsed, 0.1);
});
await test('not-ready and destroyed stages do not render', () => {
  const f = makeStage(); f.stage.ready = false; f.stage.tick(0);
  f.stage.ready = true; f.stage.destroyed = true; f.stage.tick(100);
  assert.equal(f.calls.draws, 0); assert.equal(f.calls.action.length, 0);
});
await test('actual mouth boundary validates input and preserves previous valid input on rejection', () => {
  const f = makeStage(); f.stage.setMouthInput({ open: 0.2 });
  assert.equal(f.stage.activeMouthInput.expiresAt, 1180);
  const previous = f.stage.activeMouthInput;
  for (const input of [undefined, [], 1, {}, { open: NaN }, { open: Infinity }, { open: -0.1 }, { open: 1.1 },
    { open: 0, extra: 1 }, { open: 0, form: 2 }, { open: 0, pucker: -1 }, { open: 0, ttlMs: 0 },
    { open: 0, ttlMs: 1001 }, { open: 0, ttlMs: NaN }]) {
    assert.throws(() => f.stage.setMouthInput(input));
    assert.equal(f.stage.activeMouthInput, previous);
  }
  f.stage.setMouthInput({ open: 1, form: -1, pucker: 1, ttlMs: 1000 });
  assert.equal(f.stage.activeMouthInput.expiresAt, 2000);
  f.stage.setMouthInput(null); assert.equal(f.stage.activeMouthInput, null);
});
await test('mouth TTL expires by wall clock even while paused', () => {
  const f = makeStage(); f.stage.setMouthInput({ open: 1, ttlMs: 180 }); f.stage.setPaused(true);
  f.setNow(1179); f.stage.tick(0); assert.notEqual(f.stage.activeMouthInput, null);
  f.setNow(1180); f.stage.tick(100); assert.equal(f.stage.activeMouthInput, null);
});
await test('chew holds a closed mouth then fades back to fresh speech', () => {
  const f = makeStage(); f.stage.indices.set('ParamMouthOpenY', 0);
  f.stage.setMouthInput({ open: 1 });
  const chew = { active: true, action: 'chewLeft', phase: 'hold', elapsed: 1, duration: 1.76, transition: { active: false } };
  f.stage.applyMouthInput(chew); assert.equal(f.values.get(0) ?? 0, 0);
  f.stage.applyMouthInput({ ...chew, phase: 'exit', elapsed: 1.6 });
  assert(f.values.get(0) > 0 && f.values.get(0) < 1);
  f.stage.applyMouthInput({ ...chew, active: false }); assert.equal(f.values.get(0), 1);
});
await test('timeout helper clears timers and abort listeners on every path', async () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers = new Set();
  const controller = new AbortController();
  const signal = controller.signal;
  const listeners = new Set();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, fn, options) => { if (type === 'abort') listeners.add(fn); add(type, fn, options); };
  signal.removeEventListener = (type, fn, options) => { if (type === 'abort') listeners.delete(fn); remove(type, fn, options); };
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = originalSet(() => { timers.delete(timer); fn(...args); }, ms);
    timers.add(timer); return timer;
  };
  globalThis.clearTimeout = timer => { timers.delete(timer); originalClear(timer); };
  const clean = () => { assert.equal(timers.size, 0); assert.equal(listeners.size, 0); };
  try {
    assert.equal(await asyncUtils.withTimeout(() => Promise.resolve(42), 100, 'timeout', signal), 42); clean();
    await assert.rejects(asyncUtils.withTimeout(() => Promise.reject(new Error('decode')), 100, 'timeout', signal), /decode/); clean();
    await assert.rejects(asyncUtils.withTimeout(() => { throw new Error('sync'); }, 100, 'timeout', signal), /sync/); clean();
    await assert.rejects(asyncUtils.withTimeout(() => new Promise(() => {}), 5, 'timeout', signal), /timeout/); clean();
    let lateReject;
    const pending = asyncUtils.withTimeout(() => new Promise((_, reject) => { lateReject = reject; }), 100, 'timeout', signal);
    controller.abort(new Error('cancelled'));
    await assert.rejects(pending, /cancelled/); clean();
    lateReject(new Error('late decode failure')); await Promise.resolve(); clean();
    let started = false;
    await assert.rejects(asyncUtils.withTimeout(() => { started = true; return Promise.resolve(); }, 100, 'timeout', signal), /cancelled/);
    assert.equal(started, false); clean();
    for (const ms of [0, -1, NaN, Infinity]) await assert.rejects(asyncUtils.withTimeout(() => Promise.resolve(), ms, 'timeout'), /timeoutMs/);
    clean();
  } finally {
    for (const timer of timers) originalClear(timer);
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});
console.log(JSON.stringify({ status: 'PASS', cases: checks.length, checks,
  scope: 'Real runtime with SDK/controller doubles; no native model loading or visual assertion.' }, null, 2));
