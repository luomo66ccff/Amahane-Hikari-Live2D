// SPDX-License-Identifier: MIT
// Responsive page, accessible navigation and honest static fallback checks.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright');
const [url, destination] = process.argv.slice(2);
if (!url || !destination || !/^https?:\/\//.test(url)) throw new Error('Usage: node scripts/check-project-page.mjs URL NEW_REPORT_DIRECTORY');
const out = path.resolve(destination);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(out, { recursive: false });
const report = { status: 'RUNNING', url, checks: [], screenshots: [], errors: [] };
const check = (name, condition) => { report.checks.push({ name, pass: !!condition }); assert(condition, name); };
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const ready = page => page.waitForFunction(() => document.querySelector('[data-showcase]')?.dataset.state === 'ready', null, { timeout: 120000 });
const shot = async (page, file, fullPage = false) => { await page.screenshot({ path: path.join(out, file), fullPage }); report.screenshots.push(file); };
try {
  report.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await ready(page);
  check('One named main heading', await page.locator('h1').count() === 1 && (await page.locator('h1').innerText()).includes('Hikari'));
  check('Production debug handle absent', await page.evaluate(() => !('__hikariQa' in window)));
  check('Static poster hides after real model loads', await page.locator('.model-poster').evaluate(image => getComputedStyle(image).visibility === 'hidden'));
  const anchors = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => ({ href: link.getAttribute('href'), found: !!document.getElementById(link.getAttribute('href').slice(1)) })));
  check('Every in-page navigation destination exists', anchors.length >= 4 && anchors.every(link => link.found));
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
      const title = document.querySelector('h1');
      const range = document.createRange(); range.selectNodeContents(title);
      const text = range.getBoundingClientRect();
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const canvas = document.querySelector('#model-canvas').getBoundingClientRect();
      return { noOverflow: document.documentElement.scrollWidth <= innerWidth + 1, titleFits: text.left >= stage.left && text.right <= stage.right, canvasPositive: canvas.width > 200 && canvas.height > 200 };
    });
    check(`${width}px no page overflow`, layout.noOverflow);
    check(`${width}px complete title visible`, layout.titleFits);
    check(`${width}px usable character viewport`, layout.canvasPositive);
    await shot(page, `${width}-stage.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('a[href="#process"]').first().click();
  await page.waitForFunction(() => { const box = document.querySelector('#process').getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight / 2; });
  check('Creation navigation scrolls to visible section', await page.locator('#process').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight / 2; }));
  await shot(page, 'desktop-process.png');
  await page.locator('.notes-list summary').first().click();
  check('License details expand with native semantics', await page.locator('.notes-list details').first().getAttribute('open') !== null);
  await page.locator('.notes-list summary').first().press('Enter');
  check('License details close with keyboard', await page.locator('.notes-list details').first().getAttribute('open') === null);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Control+Home');
  await page.locator('.skip-link').focus();
  check('Skip link is visible on keyboard focus', await page.locator('.skip-link').evaluate(link => link.getBoundingClientRect().top >= 0));
  await page.keyboard.press('Enter');
  check('Skip link navigates to the stage', new URL(page.url()).hash === '#stage');
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'desktop-full.png', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'mobile-full.png', true);
  await page.close();

  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduced.goto(url, { waitUntil: 'load' }); await ready(reduced);
  check('Reduced motion starts paused', await reduced.locator('#pause-toggle').getAttribute('aria-pressed') === 'true');
  await reduced.locator('#settings-toggle').click();
  check('Reduced motion starts with follow disabled', await reduced.locator('#follow-toggle').getAttribute('aria-pressed') === 'false');
  await reduced.keyboard.press('Escape');
  check('Escape restores settings trigger focus', await reduced.locator('#settings-toggle').evaluate(button => document.activeElement === button));
  await reduced.close();

  const failure = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await failure.route('**/vendor/live2dcubismcore.min.js', route => route.abort('failed'));
  await failure.goto(url, { waitUntil: 'load' });
  await failure.waitForFunction(() => document.querySelector('[data-showcase]')?.dataset.state === 'error');
  check('Real-model load failure exposes retry', await failure.locator('#retry-button').isEnabled());
  check('Static preview remains visible on model failure', await failure.locator('.model-poster').evaluate(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility !== 'hidden'));
  check('Fallback identifies itself as a static preview', (await failure.locator('#model-fallback').innerText()).includes('静态预览'));
  check('Documentation is usable when the renderer fails', await failure.locator('#process a').isEnabled() && await failure.locator('#build a').count() >= 3);
  await shot(failure, 'mobile-static-fallback.png');
  await failure.unroute('**/vendor/live2dcubismcore.min.js');
  await failure.locator('#retry-button').click(); await ready(failure);
  check('Retry replaces the poster with the real character', await failure.locator('.model-poster').evaluate(image => getComputedStyle(image).visibility === 'hidden'));
  await failure.close();

  const nojs = await browser.newPage({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  await nojs.goto(url, { waitUntil: 'load' });
  check('No-JavaScript visitors can still read the creation guide', await nojs.locator('#process-title').isVisible());
  check('No-JavaScript visitors get an honest fallback message', await nojs.locator('.noscript-note').isVisible());
  await nojs.close();
  check('No errors in the normal interactive page', report.errors.length === 0);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.errors.push(String(error.stack ?? error)); process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors.length, output: out }));
}
