import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, guides, w2s, drag } from './harness.mjs';

async function twoRects() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 140, 140, 260, 240); // A 120x100
  await dragWorld(r.page, 400, 300, 520, 400); // B 120x100
  await sleep(r.page, 200);
  return r;
}

test('align: moving snaps to edges/centers within 4px and shows red guide lines', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A
  await sleep(page, 150);
  // drag so A's left edge is 2px from B's left edge (400): dx = 258 -> A.x = 398 -> snap to 400
  let a = await w2s(page, 200, 190);
  let b = await w2s(page, 458, 190);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(page, 150);
  eq(await guides(page), ['V@400'], 'vertical guide at B left edge');
  eq((await rects(page))[0].x, 400, 'A snapped so left edges align');
  await page.mouse.up();
  await sleep(page, 200);
  eq(await guides(page), [], 'guides removed after drop');
  // y snap: A is now at (400,140), center (460,190); drag to y=348 -> A.y=298 (2px from B.top=300) -> snap
  a = await w2s(page, 460, 190);
  b = await w2s(page, 460, 348);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(page, 150);
  assert((await guides(page)).includes('H@300'), 'horizontal guide at B top edge');
  eq((await rects(page))[0].y, 300, 'A snapped so top edges align');
  await page.mouse.up();
  await sleep(page, 200);
  // far away: no snap, no guides (A is at (400,300) now, center (460,350))
  a = await w2s(page, 460, 350);
  b = await w2s(page, 900, 650);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await guides(page), [], 'no guides when far from alignment');
  await page.mouse.up();
  await sleep(page, 200);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: resizing snaps the moving edge within 4px and shows guides', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A
  await sleep(page, 150);
  // drag the bottom-right handle (world 260,240) to world x=398 -> w=258 -> snap to 260 (edge 400)
  const a = await w2s(page, 260, 240);
  const b = await w2s(page, 398, 240);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  // V@400 is the edge snap; V@270/V@460 are the size-match inner lines through the centers
  // (A and B are both 100 tall, so the height match draws vertical center lines)
  eq(await guides(page), ['V@400', 'V@270', 'V@460'], 'edge guide plus inner size-match lines during resize');
  eq((await rects(page))[0].w, 260, 'width snapped so right edge aligns with B left edge');
  await page.mouse.up();
  await sleep(page, 200);
  eq(await guides(page), [], 'guides removed after drop');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: center-to-center snap works too', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A (140,140 120x100)
  await sleep(page, 150);
  // drag so A's center x (A.x+60) is 2px from B's center x (460): A.x=398 -> dx=258
  const a = await w2s(page, 200, 190);
  const b = await w2s(page, 458, 190);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(page, 150);
  const g = await guides(page);
  assert(g.includes('V@460') || g.includes('V@400'), `a vertical guide shown (center or edge), got ${g}`);
  const ax = (await rects(page))[0].x;
  assert(ax === 400 || ax === 398 + 2, `snapped near alignment, A.x=${ax}`);
  await page.mouse.up();
  await sleep(page, 150);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: distance hints — dragging a third shape into a gap equal to an existing nearby gap snaps and shows blue hints', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 300, 220); // A (100,100) 200x120
  await dragWorld(page, 420, 100, 620, 220); // B: gap A->B = 120
  await dragWorld(page, 800, 100, 920, 220); // C (800,100) 120x120
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  // drag C left so its gap to B is 117 (3px off the reference gap 120) -> should snap to gap 120
  const a = await w2s(page, 860, 160); // interior of C
  const b = await w2s(page, 797, 160); // C.x would be 737, gap = 737-620 = 117
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(page, 150);
  const gl = await guides(page);
  assert(gl.length >= 2, 'two blue distance hint lines shown (dragged gap + reference gap), got ' + JSON.stringify(gl));
  const blue = await page.evaluate(() => [...document.querySelectorAll('#overlay line.guide')].filter((l) => l.getAttribute('stroke') === '#4a6cf7').length);
  eq(blue, 2, 'both hint lines are blue');
  eq((await rects(page)).map((r) => r.x).sort((x, y) => x - y)[2], 740, 'C snapped so gap to B is 120 (x=740)');
  await page.mouse.up();
  await sleep(page, 150);
  eq(await guides(page), [], 'hints removed after drop');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: distance hints only use nearby reference pairs, not the whole board', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 420, 100, 620, 220); // B
  await dragWorld(page, 800, 100, 920, 220); // C
  await dragWorld(page, 3000, 100, 3120, 220); // far-away pair partner D
  await dragWorld(page, 3240, 100, 3360, 220); // E: far gap D->E = 120
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  // drag C to gap 117 from B: no NEARBY reference pair exists (A is absent, D/E are far),
  // so no spacing snap and no blue hints even though D->E has gap 120
  const a = await w2s(page, 860, 160);
  const b = await w2s(page, 797, 160);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(page, 150);
  eq(await page.evaluate(() => [...document.querySelectorAll('#overlay line.guide')].filter((l) => l.getAttribute('stroke') === '#4a6cf7').length), 0, 'no distance hints from far-away pairs');
  eq((await rects(page)).filter((r) => r.w === 120 && r.x < 2000).map((r) => r.x), [737], 'C stays at 737 (no snap)');
  await page.mouse.up();
  await sleep(page, 150);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: snapping (position, distance, scale) only considers shapes visible on screen', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 300, 220); // A (100,100) 200x120
  await dragWorld(page, 420, 100, 620, 220); // B: gap A->B = 120, left edge 420, right edge 620
  await dragWorld(page, 800, 100, 920, 220); // C (800,100) 120x120
  await dragWorld(page, 1000, 100, 1120, 220); // D: left edge 1000, off-screen after zoom
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  // zoom in on C until A, B and D are off-screen
  const c = await w2s(page, 860, 160);
  await page.mouse.move(c.x, c.y);
  const visOf = () => page.evaluate(() => {
    const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    const r = document.getElementById('board').getBoundingClientRect();
    return { x: -+t[1] / +t[3], y: -+t[2] / +t[3], w: r.width / +t[3], h: r.height / +t[3] };
  });
  let vis = await visOf();
  for (let i = 0; i < 8 && (vis.x < 620 || vis.x + vis.w > 1000); i++) {
    await page.mouse.wheel(0, -480);
    await sleep(page, 120);
    vis = await visOf();
  }
  assert(vis.x > 620 && vis.x + vis.w < 1000, `B and D are off-screen after zoom (visible x ${vis.x.toFixed(0)}..${(vis.x + vis.w).toFixed(0)})`);
  assert(vis.x < 920 && vis.x + vis.w > 800, 'C still on screen');

  const blueGuides = () => page.evaluate(() => [...document.querySelectorAll('#overlay line.guide')].filter((l) => l.getAttribute('stroke') === '#4a6cf7').length);
  const anyGuides = async () => (await guides(page)).length;
  const cRect = async () => (await rects(page)).find((r) => r.x === 800 || (r.x === 418 || r.x === 737) && r.w > 120);

  // 1) scale: drag C's right border to x=998 (would snap to D's left edge 1000 if D were visible)
  let a = await w2s(page, 920, 160);
  let b = await w2s(page, 998, 160);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await anyGuides(), 0, 'no guides while scaling toward off-screen D');
  await page.mouse.up();
  await sleep(page, 150);
  eq((await rects(page)).find((r) => r.x === 800).w, 198, 'right edge stays at 998 (no snap to 1000)');

  // 2) distance: drag C so its gap to B would be 117 (would snap to 120 if B were visible)
  a = await w2s(page, 899, 160); // C center (800 + 198/2)
  b = await w2s(page, 836, 160); // C.x would be 737
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await blueGuides(), 0, 'no distance hints from off-screen pairs');
  await page.mouse.up();
  await sleep(page, 150);
  eq((await rects(page)).find((r) => r.w === 198).x, 737, 'C stays at x=737 (no spacing snap)');

  // 3) position: drag C so its left edge is 418 (would snap to B's left edge 420 if visible)
  a = await w2s(page, 836, 160); // C center after distance drag
  b = await w2s(page, 517, 160); // C.x would be 418
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await anyGuides(), 0, 'no guides while moving toward off-screen B');
  await page.mouse.up();
  await sleep(page, 150);
  eq((await rects(page)).find((r) => r.w === 198).x, 418, 'C stays at x=418 (no snap to 420)');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('align: no snapping or hints below 50% zoom (move, scale and distance all disabled)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 300, 220); // A (100,100) 200x120
  await dragWorld(page, 420, 100, 620, 220); // B: left edge 420, right edge 620
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  // zoom out below 50%: two wheel-ups at the screen center -> k ~0.32
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 480);
  await page.mouse.wheel(0, 480);
  await sleep(page, 250);
  const k = await page.evaluate(() => +/scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'))[1]);
  assert(k < 0.5, `zoom is below 50% (k=${k.toFixed(2)})`);

  // 1) move: drag A so its left edge is 418 (would snap to B's left edge 420 at >=50%)
  let a = await w2s(page, 200, 190); // A center
  let b = await w2s(page, 518, 190); // A.x would be 418
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await guides(page), [], 'no guides while moving below 50%');
  await page.mouse.up();
  await sleep(page, 150);
  eq(Math.round((await rects(page)).find((r) => r.w === 200 && r.x < 420).x), 418, 'no edge snap below 50%');

  // 2) scale: drag A's right border to 630 (would snap to B's right edge 620 at >=50%)
  a = await w2s(page, 618, 160); // A right border
  b = await w2s(page, 630, 160);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq(await guides(page), [], 'no guides while scaling below 50%');
  await page.mouse.up();
  await sleep(page, 150);
  eq(Math.round((await rects(page)).find((r) => Math.round(r.x) === 418).w), 212, 'no scale snap below 50% (right edge stays at 630, not 620)');

  eq(errors, [], 'no page errors');
  await page.close();
});
