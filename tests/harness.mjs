// Shared harness for the e2e tests: starts the real server on a temp data dir, launches
// headless Chrome via playwright-core, and provides a tiny test framework plus DOM helpers.
// Run with: npm test  (builds the client first, then node tests/run.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const home = os.homedir();
  const candidates = [
    path.join(home, '.cache/puppeteer/chrome'),
    'C:/Users/adsci/.cache/puppeteer/chrome',
    path.join(home, '.cache/ms-playwright'),
  ];
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('Chrome executable not found — set CHROME_PATH');
}

export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-data-'));
  const port = 3800 + Math.floor(Math.random() * 400);
  const proc = spawn(process.execPath, [path.join(repoRoot, 'server/index.js')], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) },
    stdio: 'ignore',
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + '/api/rooms');
      if (r.ok) return { proc, base, dataDir, port };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('test server did not start');
}

let CTX = null;
export function ctx() { return CTX; }
export async function setup() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
  CTX = { server, browser, base: server.base };
  return CTX;
}
export async function teardown() {
  if (!CTX) return;
  await CTX.browser.close();
  CTX.server.proc.kill();
  fs.rmSync(CTX.server.dataDir, { recursive: true, force: true });
  CTX = null;
}

let roomCounter = 0;
// a fresh page in a fresh (empty) board inside a fresh workspace (#ws/board);
// pageerrors are collected in errors
export async function newRoom() {
  const { browser, base } = ctx();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/#t-${Date.now()}-${roomCounter++}/b-${roomCounter}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board');
  return { page, errors };
}

// world -> screen using the current viewport transform
export async function w2s(page, x, y) {
  const t = await page.evaluate(() => document.getElementById('viewport').getAttribute('transform'));
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(t);
  const tx = +m[1], ty = +m[2], k = +m[3];
  return { x: x * k + tx, y: y * k + ty };
}
export async function s2w(page, x, y) {
  const t = await page.evaluate(() => document.getElementById('viewport').getAttribute('transform'));
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(t);
  const tx = +m[1], ty = +m[2], k = +m[3];
  const r = await page.evaluate(() => document.getElementById('board').getBoundingClientRect());
  return { x: (x - r.left - tx) / k, y: (y - r.top - ty) / k };
}

export const sleep = (page, ms) => page.waitForTimeout(ms);

export async function drag(page, x1, y1, x2, y2, steps = 8, holdMs = 0) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.move(x2, y2, { steps });
  await page.mouse.up();
}
export async function dragWorld(page, wx1, wy1, wx2, wy2, opts = {}) {
  const a = await w2s(page, wx1, wy1);
  const b = await w2s(page, wx2, wy2);
  await drag(page, a.x, a.y, b.x, b.y, opts.steps ?? 8, opts.holdMs ?? 0);
}
export async function clickWorld(page, x, y) {
  const s = await w2s(page, x, y);
  await page.mouse.click(s.x, s.y);
}
export async function dblclickWorld(page, x, y) {
  const s = await w2s(page, x, y);
  await page.mouse.dblclick(s.x, s.y);
}

// ---------- DOM readers ----------
export const rects = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#shapes > rect[data-id]')]
    .map((r) => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height'), fill: r.getAttribute('fill'), stroke: r.getAttribute('stroke'), sw: +r.getAttribute('stroke-width') }))
    .sort((a, b) => a.x - b.x || a.y - b.y));
export const paths = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#shapes path[data-id]')]
    .filter((p) => p.getAttribute('stroke') !== 'transparent') // skip the invisible hit path
    .map((p) => ({
      d: p.getAttribute('d'), stroke: p.getAttribute('stroke'), sw: p.getAttribute('stroke-width'),
      dash: p.getAttribute('stroke-dasharray'), me: p.getAttribute('marker-end'), ms: p.getAttribute('marker-start'),
    })));
export const guides = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#overlay line.guide')].map((l) => (l.getAttribute('x1') === l.getAttribute('x2') ? 'V@' + l.getAttribute('x1') : 'H@' + l.getAttribute('y1'))));
export const shapeTexts = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#shapes text')].map((t) => ({
    y: +t.getAttribute('y'), fill: t.getAttribute('fill'),
    segs: [...t.querySelectorAll('tspan')].map((s) => ({ t: s.textContent, fw: s.getAttribute('font-weight'), fs: s.getAttribute('font-size'), fill: s.getAttribute('fill') })),
  })));
export const selBoxes = (page) => page.evaluate(() => document.querySelectorAll('#selection .sel-box').length);
export const handles = (page) => page.evaluate(() => document.querySelectorAll('#selection [data-handle]').length);
export const barSection = (page, id) => page.evaluate((i) => document.getElementById(i).style.display, id);
export const toDot = (page) => page.evaluate(() => {
  const e = document.querySelector('#selection [data-ep="to"]');
  return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null;
});
// simulate picking a color in a format-bar color input
export const setColor = (page, sel, hex) => page.$eval(sel, (el, v) => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, hex);
// set the text selection inside the open editor to character offsets [start,end) of its content
export const selectEditorText = (page, start, end) => page.evaluate(([s, e]) => {
  const div = document.querySelector('.wb-editing');
  const find = (off) => {
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      const len = n.textContent.length;
      if (off <= len) return { n, off };
      off -= len;
      n = walker.nextNode();
    }
    return null;
  };
  const a = find(s);
  const b = find(e);
  const range = document.createRange();
  if (a) range.setStart(a.n, a.off);
  if (b) range.setEnd(b.n, b.off);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}, [start, end]);
export const editLineCount = (page) => page.evaluate(() => {
  const div = document.querySelector('.wb-editing');
  if (!div) return null;
  // per-character caret rects, clustered by vertical center: a single selectNodeContents
  // range returns multiple rects per line when inline elements nest (<b><span>…), which
  // would double-count lines
  const centers = [];
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    for (let i = 0; i < n.textContent.length; i++) {
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const rect = range.getClientRects()[0];
      if (rect) centers.push(rect.top + rect.height / 2);
    }
  }
  centers.sort((a, b) => a - b);
  let lines = 0;
  let last = -Infinity;
  for (const c of centers) {
    if (c - last > 6) lines++;
    last = c;
  }
  return lines;
});

// per-line text of the open editor (same caret-rect walk as editLineCount, clustered)
export const editLineTexts = (page) => page.evaluate(() => {
  const div = document.querySelector('.wb-editing');
  if (!div) return null;
  const chars = [];
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let n;
  let prevC = null;
  while ((n = walker.nextNode())) {
    for (let i = 0; i < n.textContent.length; i++) {
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const rect = range.getClientRects()[0];
      // a space at a wrap point has no caret rect — keep it on the previous char's line
      const c = rect ? rect.top + rect.height / 2 : prevC;
      if (c !== null) chars.push({ c, t: n.textContent[i] });
      prevC = c;
    }
  }
  // chars are already in document order; cluster them into lines sequentially (sorting by
  // center would scramble chars when mixed font sizes shift their centers within a line)
  const lines = [];
  let last = -Infinity;
  for (const { c, t } of chars) {
    if (c - last > 6) lines.push('');
    lines[lines.length - 1] += t;
    last = c;
  }
  return lines;
});

// ---------- tiny test framework ----------
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error('assert failed: ' + msg); }
export function eq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'eq failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
export async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('PASS', t.name);
    } catch (e) {
      failed++;
      console.log('FAIL', t.name, '\n   ', String(e.message).split('\n').join('\n    '));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
  if (failed) process.exitCode = 1;
}

// Measure the edit-mode hop: rendered text position (unfocused) vs the editor's first line box
// (focused), in world coords. Returns { rendered: {x, y, lineTop}, edit: {lineLeft, lineTop}, dx, dy }.
// dy compares line tops (rendered baseline - 0.8*lineH vs editor line top); dx compares line lefts.
export async function measureEditHop(page, fontSize) {
  const rendered = await page.evaluate(() => {
    const t = document.querySelector('#shapes text');
    return t ? { x: +t.getAttribute('x'), y: +t.getAttribute('y') } : null; // not rendered while editing
  });
  const edit = await page.evaluate(() => {
    const div = document.querySelector('.wb-editing');
    if (!div) return null; // not in edit mode
    const range = document.createRange();
    range.selectNodeContents(div);
    const rc = range.getClientRects()[0];
    const svgR = document.getElementById('board').getBoundingClientRect();
    const vpT = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    const k = +vpT[3];
    return { lineLeft: (rc.left - svgR.left - +vpT[1]) / k, lineTop: (rc.top - svgR.top - +vpT[2]) / k };
  });
  const lineH = fontSize * 1.3;
  const rLineTop = rendered ? rendered.y - 0.8 * lineH : null;
  return {
    rendered,
    edit,
    renderedLineTop: rLineTop,
    // deltas only when both sides were captured (rendered while blurred, edit while focused)
    dx: rendered && edit ? edit.lineLeft - rendered.x : null,
    dy: rendered && edit ? edit.lineTop - rLineTop : null,
  };
}
