// Workspaces: index page lists workspaces, #ws lists boards, #ws/board is the board app.
// "Using is creating": opening a URL with a workspace/board id creates it server-side.
import { test, assert, eq, ctx, sleep } from './harness.mjs';

async function openPage(path) {
  const { browser, base } = ctx();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  return { page, errors };
}

const wsRows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#dash-list .room-row .room-name')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent })));
const wsApi = async (path, init) => (await fetch(ctx().base + path, init)).json();

test('workspaces: opening #ws creates the workspace and shows the board list (empty)', async () => {
  const ws = 'ws-create-' + Date.now().toString(36);
  const { page, errors } = await openPage(`/#${ws}`);
  await page.waitForSelector('#dashboard .dash-head');
  await page.waitForFunction(() => document.querySelector('#dash-list .dash-empty, #dash-list .room-row'));
  eq(await page.evaluate(() => document.querySelector('#dash-list .dash-empty')?.textContent), 'No boards in this workspace yet.', 'empty workspace page');
  eq(await page.evaluate(() => document.getElementById('dash-new').textContent), '+ New board', 'workspace page + button creates boards');
  eq(await page.evaluate(() => document.getElementById('dash-home').style.display), '', 'workspaces button visible on workspace page');
  await sleep(page, 300); // let the POST ensure land
  const list = await wsApi('/api/workspaces');
  const w = list.find((x) => x.id === ws);
  assert(w, 'workspace was created server-side by just opening the URL');
  eq(w.boards, 0, 'no boards yet');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('workspaces: opening #ws/board creates both and the board app loads', async () => {
  const ws = 'ws-board-' + Date.now().toString(36);
  const { page, errors } = await openPage(`/#${ws}/b1`);
  await page.waitForSelector('#board');
  eq(await page.evaluate(() => document.getElementById('roomlink').textContent), `link: ${ctx().base}/#${ws}/b1`, 'room link uses ws/board hash');
  await sleep(page, 300);
  const list = await wsApi('/api/workspaces');
  assert(list.some((x) => x.id === ws), 'workspace auto-created by board connect');
  const boards = await wsApi(`/api/workspaces/${ws}/boards`);
  eq(boards.length, 1, 'one board in workspace');
  eq(boards[0].id, 'b1', 'board id is the second hash segment');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('workspaces: turtle button on a board returns to the workspace page', async () => {
  const ws = 'ws-home-' + Date.now().toString(36);
  const { page, errors } = await openPage(`/#${ws}/b1`);
  await page.waitForSelector('#board');
  await page.click('#dash-btn');
  await page.waitForSelector('#dashboard .dash-head');
  eq(new URL(page.url()).hash, `#${ws}`, 'back on the workspace page');
  await page.waitForFunction(() => document.querySelector('#dash-list .room-row'));
  const rows = await wsRows(page);
  eq(rows, [{ href: `#${ws}/b1`, text: 'Untitled_b1' }], 'workspace page lists the board');
  // workspaces button goes back to the index of all workspaces
  await page.click('#dash-home');
  await page.waitForFunction(() => document.querySelector('#dash-list .room-row, #dash-list .dash-empty'));
  eq(new URL(page.url()).hash, '', 'index page has no hash');
  const idxRows = await wsRows(page);
  assert(idxRows.some((r) => r.href === `#${ws}`), 'index lists the workspace');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('workspaces: rename via inline input on the workspace page (no JS dialog)', async () => {
  const ws = 'ws-ren-' + Date.now().toString(36);
  const { page, errors } = await openPage(`/#${ws}`);
  await page.waitForSelector('#dashboard .dash-head');
  await page.waitForFunction((id) => document.getElementById('dash-title').textContent.includes(id), ws); // load() sets the name + click handler
  page.on('dialog', (d) => d.dismiss()); // would fail the test if a prompt/confirm appeared
  await page.click('#dash-title');
  await page.waitForSelector('input.rename-input');
  await page.fill('input.rename-input', 'My Space');
  await page.press('input.rename-input', 'Enter');
  await page.waitForFunction(() => !document.querySelector('input.rename-input'));
  await sleep(page, 200);
  eq(await page.evaluate(() => document.getElementById('dash-title').textContent), 'My Space', 'title updated inline');
  const list = await wsApi('/api/workspaces');
  eq(list.find((x) => x.id === ws)?.name, 'My Space', 'rename persisted server-side');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('workspaces: index rows have an inline rename button, no JS dialog', async () => {
  const ws = 'ws-ren2-' + Date.now().toString(36);
  await openPage(`/#${ws}/b1`); // create ws + board
  const idx = await openPage('/');
  await idx.page.waitForFunction((id) => [...document.querySelectorAll('#dash-list .room-row')].some((r) => r.querySelector('.room-name')?.getAttribute('href') === '#' + id), ws);
  idx.page.on('dialog', (d) => d.dismiss());
  await idx.page.click(`#dash-list .room-row:has(.room-name[href="#${ws}"]) .room-ren`);
  await idx.page.waitForSelector('#dash-list .room-row input.rename-input');
  await idx.page.fill('#dash-list .room-row input.rename-input', 'Renamed WS');
  await idx.page.press('#dash-list .room-row input.rename-input', 'Enter');
  await sleep(idx.page, 200);
  const list = await wsApi('/api/workspaces');
  eq(list.find((x) => x.id === ws)?.name, 'Renamed WS', 'rename persisted from the index row');
  eq(idx.errors, [], 'no page errors');
  await idx.page.close();
});

test('workspaces: board rows on the workspace page have an inline rename button', async () => {
  const ws = 'ws-bren-' + Date.now().toString(36);
  const bp = await openPage(`/#${ws}/b1`);
  await bp.page.waitForSelector('#board');
  const { page, errors } = await openPage(`/#${ws}`);
  await page.waitForFunction(() => document.querySelector('#dash-list .room-row .room-ren'));
  page.on('dialog', (d) => d.dismiss());
  await page.click('#dash-list .room-row .room-ren');
  await page.waitForSelector('#dash-list .room-row input.rename-input');
  await page.fill('#dash-list .room-row input.rename-input', 'Sketch A');
  await page.press('#dash-list .room-row input.rename-input', 'Enter');
  await sleep(page, 200);
  const boards = await wsApi(`/api/workspaces/${ws}/boards`);
  eq(boards[0]?.name, 'Sketch A', 'board renamed via the overview row');
  eq(errors, [], 'no page errors');
  await page.close();
  await bp.page.close();
});

test('workspaces: index lists workspaces with board counts; delete removes workspace and its boards', async () => {
  const ws = 'ws-del-' + Date.now().toString(36);
  // create two boards by connecting
  const p1 = await openPage(`/#${ws}/a`);
  await p1.page.waitForSelector('#board');
  const p2 = await openPage(`/#${ws}/b`);
  await p2.page.waitForSelector('#board');
  await sleep(p1.page, 300);
  let list = await wsApi('/api/workspaces');
  eq(list.find((x) => x.id === ws)?.boards, 2, 'workspace shows 2 boards');
  // index page shows it
  const idx = await openPage('/');
  await idx.page.waitForFunction(() => document.querySelector('#dash-list .room-row'));
  const rows = await wsRows(idx.page);
  const row = rows.find((r) => r.href === `#${ws}`);
  assert(row, 'index row links to #ws');
  await idx.page.close();
  // delete one board via the workspace API
  await fetch(`${ctx().base}/api/workspaces/${ws}/boards/a`, { method: 'DELETE' });
  eq((await wsApi(`/api/workspaces/${ws}/boards`)).map((b) => b.id), ['b'], 'board deleted');
  // delete the whole workspace
  await fetch(`${ctx().base}/api/workspaces/${ws}`, { method: 'DELETE' });
  list = await wsApi('/api/workspaces');
  assert(!list.some((x) => x.id === ws), 'workspace gone from list');
  const remaining = await wsApi('/api/rooms');
  assert(!remaining.some((b) => b.room.startsWith(ws + '/')), 'all boards of the workspace deleted too');
  eq(p1.errors, [], 'no page errors');
  eq(p2.errors, [], 'no page errors');
  await p1.page.close();
  await p2.page.close();
});

test('workspaces: delete buttons use an in-page HTML dialog, not window.confirm', async () => {
  const ws = 'ws-dlg-' + Date.now().toString(36);
  const bp = await openPage(`/#${ws}/b1`);
  await bp.page.waitForSelector('#board');
  await sleep(bp.page, 300);
  const { page, errors } = await openPage(`/#${ws}`);
  await page.waitForFunction(() => document.querySelector('#dash-list .room-row .room-del'));
  let jsDialog = false;
  page.on('dialog', (d) => { jsDialog = true; void d.dismiss(); });
  // cancel keeps the board
  await page.click('#dash-list .room-row .room-del');
  await page.waitForSelector('#confirm-dialog[open]');
  eq(await page.evaluate(() => document.getElementById('confirm-text').textContent), 'Delete board "Untitled_b1"?', 'dialog names the board');
  await page.click('#confirm-cancel');
  await page.waitForFunction(() => !document.getElementById('confirm-dialog').open);
  eq((await wsApi(`/api/workspaces/${ws}/boards`)).length, 1, 'board kept after cancel');
  // confirm deletes the board
  await page.click('#dash-list .room-row .room-del');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => !document.querySelector('#dash-list .room-row'));
  eq((await wsApi(`/api/workspaces/${ws}/boards`)).length, 0, 'board deleted after confirm');
  // close the pages that would re-create the workspace via their 5s "using is creating" POST
  await page.close();
  await bp.page.close();
  await new Promise((r) => setTimeout(r, 300));
  // workspace delete from the index page
  const idx = await openPage('/');
  await idx.page.waitForFunction((id) => [...document.querySelectorAll('#dash-list .room-row')].some((r) => r.querySelector('.room-name')?.getAttribute('href') === '#' + id), ws);
  idx.page.on('dialog', (d) => { jsDialog = true; void d.dismiss(); });
  await idx.page.click(`#dash-list .room-row:has(.room-name[href="#${ws}"]) .room-del`);
  await idx.page.waitForSelector('#confirm-dialog[open]');
  eq(await idx.page.evaluate(() => document.getElementById('confirm-text').textContent), `Delete workspace "Untitled_${ws}" and all 0 board(s) inside?`, 'dialog names the workspace and board count');
  await idx.page.click('#confirm-ok');
  await sleep(idx.page, 200);
  assert(!(await wsApi('/api/workspaces')).some((x) => x.id === ws), 'workspace deleted after confirm');
  assert(!jsDialog, 'no native JS dialog appeared');
  eq(errors, [], 'no page errors');
  await idx.page.close();
});
