// SPDX-License-Identifier: MIT
// Test the real main.ts registration and README example in Chromium, without
// loading a model or SDK. A recorded delivery is not a visual mouth assertion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const ts = require('typescript');
const { chromium } = require('playwright');
const source = fs.readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const registrations = ast.statements.filter(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression)
  && ts.isPropertyAccessExpression(node.expression.expression)
  && node.expression.expression.name.text === 'addEventListener'
  && ts.isStringLiteral(node.expression.arguments[0])
  && node.expression.arguments[0].text === 'hikari:mouth-input');
assert.equal(registrations.length, 1, 'Expected exactly one public mouth event registration');
const listener = ts.transpileModule(registrations[0].getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const examples = [...readme.matchAll(/```(?:js|javascript)\s*\n([\s\S]*?)```/g)]
  .map(match => match[1]).filter(code => code.includes("'hikari:mouth-input'"));
assert.equal(examples.length, 1, 'Expected the documented public mouth example');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const checks = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="target"></div></body></html>');
  await page.evaluate(code => {
    window.__mouthCalls = [];
    const engine = { setMouthInput: input => window.__mouthCalls.push(input) };
    new Function('engine', code)(engine);
  }, listener);
  for (const target of ['window', 'document', 'element']) for (const bubbles of [false, true]) {
    const delivered = await page.evaluate(({ target, bubbles }) => {
      window.__mouthCalls.length = 0;
      const recipient = target === 'window' ? window : target === 'document' ? document : document.querySelector('#target');
      recipient.dispatchEvent(new CustomEvent('hikari:mouth-input', { bubbles, detail: { open: 0.2 } }));
      return window.__mouthCalls;
    }, { target, bubbles });
    assert.deepEqual(delivered, [{ open: 0.2 }], `${target}, bubbles=${bubbles}`);
    checks.push(`${target}, bubbles=${bubbles}: exactly one delivery`);
  }
  const cleared = await page.evaluate(() => {
    window.__mouthCalls.length = 0;
    window.dispatchEvent(new CustomEvent('hikari:mouth-input', { detail: null }));
    return window.__mouthCalls;
  });
  assert.deepEqual(cleared, [null]); checks.push('null clears input');
  const repeated = await page.evaluate(() => {
    window.__mouthCalls.length = 0;
    const event = new CustomEvent('hikari:mouth-input', { detail: { open: 0.4 } });
    window.dispatchEvent(event); window.dispatchEvent(event);
    return window.__mouthCalls;
  });
  assert.deepEqual(repeated, [{ open: 0.4 }, { open: 0.4 }]); checks.push('redispatching the same Event still delivers twice');
  const documented = await page.evaluate(code => {
    window.__mouthCalls.length = 0;
    new Function(code)();
    return window.__mouthCalls;
  }, examples[0]);
  assert.deepEqual(documented, [{ open: 0.2, form: 0, pucker: 0, ttlMs: 180 }, null]);
  checks.push('actual README example delivers input and clear');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', cases: checks.length, browser: browser.version(), checks,
    scope: 'Real DOM event propagation and README example; recording engine, no SDK/model rendering.' }, null, 2));
} finally {
  await browser.close();
}
