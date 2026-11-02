import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, selBoxes, w2s, drag, s2w, ctx, repoRoot } from './harness.mjs';

test('tools: shape tool on unselected shape — short click selects, long drag creates', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await sleep(page, 150);
  // short click on A with rect tool -> selects A, no new rect
  await clickWorld(page, 200, 190);
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'short click selects the shape');
  eq((await rects(page)).length, 1, 'no new shape on short click');
  // long-hold drag starting inside A -> creates a new rect, A unmoved (A is selected now,
  // so first deselect by clicking empty space)
  await clickWorld(page, 1000, 600);
  await sleep(page, 150);
  await dragWorld(page, 200, 190, 300, 260, { holdMs: 300 });
  await sleep(page, 200);
  const rs = await rects(page);
  eq(rs.length, 2, 'long drag created a new rect');
  eq([rs[0].x, rs[0].y], [140, 140], 'original A unmoved');
  eq([rs[1].x, rs[1].y], [200, 190], 'new rect at press point');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('tools: drag on an already-selected shape moves it immediately', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A
  await sleep(page, 150);
  eq(await selBoxes(page), 1, 'A selected');
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 200, 190, 260, 250); // immediate drag
  await sleep(page, 200);
  const rs = await rects(page);
  eq(rs.length, 1, 'no new shape created');
  eq([rs[0].x, rs[0].y], [200, 200], 'A moved by (60,60)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('view: opening a document centers on the object nearest the origin', async () => {
  const { page, errors } = await newRoom();
  // pan so that world (-360,-660) is under screen (700,400): vp becomes (1060,1060)
  await page.click('button[data-tool="hand"]');
  const a = await w2s(page, 0, 0);
  await drag(page, a.x + 640, a.y + 340, a.x + 1640, a.y + 1340, 5); // pan +1000,+1000
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, -360, -660, -240, -560); // rect 120x100, center (-300,-610)
  await sleep(page, 300);
  eq((await rects(page)).length, 1, 'rect created far from origin');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#board');
  await sleep(page, 600);
  const t = await page.evaluate(() => document.getElementById('viewport').getAttribute('transform'));
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(t);
  const tx = +m[1], ty = +m[2], k = +m[3];
  // viewport 1400x800: center world (-300,-610) -> translate(700+300, 400+610) at k=1
  assert(Math.abs(tx - (700 - -300 * k)) < 2 && Math.abs(ty - (400 - -610 * k)) < 2, `view centered on nearest object, got ${t}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('tools: short click on an already-selected shape does not move it; fast flick creates', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A
  await sleep(page, 150);
  await page.click('button[data-tool="rect"]');
  // short click on selected A: no move, still selected, no new rect
  let s = await w2s(page, 200, 190);
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await sleep(page, 80); await page.mouse.up();
  await sleep(page, 200);
  eq((await rects(page)).length, 1, 'no new rect');
  eq([(await rects(page))[0].x, (await rects(page))[0].y], [140, 140], 'A unmoved');
  eq(await selBoxes(page), 1, 'A still selected');
  // fast flick (<200ms, moved >8px) starting inside A (after deselect): creates a new rect
  await clickWorld(page, 1000, 600);
  await sleep(page, 150);
  s = await w2s(page, 200, 190);
  const e = await w2s(page, 290, 260);
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(e.x, e.y, { steps: 4 }); await page.mouse.up();
  await sleep(page, 200);
  eq((await rects(page)).length, 2, 'fast flick created a new rect');
  eq([(await rects(page))[0].x, (await rects(page))[0].y], [140, 140], 'A unmoved');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('tools: dashboard shows the logo before the title and the app icon is set', async () => {
  const { browser, base } = ctx();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#dashboard .dash-head');
  const brand = await page.evaluate(() => {
    const b = document.querySelector('#dashboard .dash-brand');
    if (!b) return null;
    const kids = [...b.children].map((c) => c.tagName + '.' + c.className);
    return { kids, logoSrc: b.querySelector('img.dash-logo')?.getAttribute('src') };
  });
  eq(brand?.kids, ['IMG.dash-logo', 'H1.'], 'logo img sits before the title');
  eq(brand?.logoSrc, '/logo.svg', 'logo source');
  eq(await page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute('href')), '/logo.svg', 'favicon link');
  const logoOk = await page.evaluate(async () => (await fetch('/logo.svg')).ok);
  eq(logoOk, true, 'logo.svg served');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('tools: Download button (between name input and Home) exports the whiteboard as SVG', async () => {
  const { browser, base } = ctx();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/#dl-ws/dl-test`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board');
  // button order: name input, Download, Home
  const order = await page.evaluate(() => [...document.querySelectorAll('#topright > *')].map((e) => e.id || e.tagName));
  eq(order, ['status', 'users', 'name', 'dl-btn', 'dash-btn'], 'Download between name and Home');
  eq(await page.evaluate(() => {
    const b = document.getElementById('dash-btn');
    const img = b.querySelector('img');
    return { text: b.textContent.trim(), logo: img ? img.getAttribute('src') : null };
  }), { text: '', logo: '/logo.svg' }, 'Home button is the logo icon');
  const dlBtn = await page.evaluate(() => {
    const b = document.getElementById('dl-btn');
    return { text: b.textContent.trim(), svg: !!b.querySelector('svg') };
  });
  eq(dlBtn, { text: '', svg: true }, 'Download is an icon-only button');

  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 260, 220);
  await dragWorld(page, 400, 100, 520, 220);
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 180, 160, 460, 160);
  await sleep(page, 250);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#dl-btn'),
  ]);
  assert(download.suggestedFilename().endsWith('.svg'), 'svg filename: ' + download.suggestedFilename());
  const fs = await import('node:fs');
  const content = fs.readFileSync(await download.path(), 'utf8');
  assert(content.includes('<svg') && content.includes('viewBox'), 'standalone svg with viewBox');
  assert(content.includes('font-family="system-ui, sans-serif"'), 'exported svg pins the UI font so text does not fall back to serif');
  assert(content.includes('<rect') && content.includes('<path'), 'shapes and connector exported');
  assert(!content.includes('id="selection"') && !content.includes('id="overlay"'), 'selection/overlay excluded');
  assert(!content.includes('stroke="transparent"'), 'invisible hit paths excluded');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('tools: app version from package.json shown bottom-right on board and dashboard', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { browser, base } = ctx();
  const ver = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

  const health = await (await fetch(base + '/health')).json();
  eq(health, { status: 'ok', version: ver }, '/health reports the same package.json version');

  const { page, errors } = await newRoom();
  eq(await page.evaluate(() => document.getElementById('version').textContent), `v${ver}`, 'board bottom-right shows the version');
  eq(errors, [], 'no page errors');
  await page.close();

  const dpage = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const derrors = [];
  dpage.on('pageerror', (e) => derrors.push(e.message));
  await dpage.goto(base + '/', { waitUntil: 'networkidle' });
  await dpage.waitForSelector('#dashboard .dash-head');
  eq(await dpage.evaluate(() => document.getElementById('dash-version').textContent), `v${ver}`, 'dashboard bottom-right shows the version');
  eq(derrors, [], 'no page errors');
  await dpage.close();
});
