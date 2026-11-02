import { test, assert, eq, newRoom, sleep, dragWorld, paths } from './harness.mjs';

const bends = (d) => (d.match(/L /g) || []).length - 1; // path points - 2 = bend count

test('elbow: rect to rect below-right takes the 1-bend route into the top edge (not a 2-bend Z)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A (140,140,120,100)
  await dragWorld(page, 400, 300, 520, 400); // B (400,300,120,100), below-right of A
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 200, 190, 460, 350); // A center -> B center
  await sleep(page, 300);
  const d = (await paths(page))[0].d;
  eq(d, 'M 260 190 L 460 190 L 460 300', '1-bend L into the top edge of B');
  eq(bends(d), 1, 'exactly 1 bend');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('elbow: diamond to rect side-by-side is a 0-bend straight line', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 140, 140, 260, 240); // diamond A, right vertex (260,190)
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 400, 140, 520, 240); // rect B, left edge (400,190)
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 200, 190, 460, 190);
  await sleep(page, 300);
  const d = (await paths(page))[0].d;
  eq(d, 'M 260 190 L 400 190', 'straight, 0 bends');
  eq(bends(d), 0, '0 bends');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('elbow: rect above diamond, vertically aligned -> 0-bend into the top vertex', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 400, 140, 520, 240); // rect A, bottom edge (460,240)
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 400, 300, 520, 400); // diamond B, top vertex (460,300)
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 460, 190, 460, 350);
  await sleep(page, 300);
  const d = (await paths(page))[0].d;
  eq(d, 'M 460 240 L 460 300', 'straight into the top vertex, 0 bends');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('elbow: ellipse to rect side-by-side -> 0 bends; rect above ellipse -> 0 bends', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="ellipse"]');
  await dragWorld(page, 760, 170, 920, 270); // ellipse A center (840,220) rx80
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 1000, 170, 1120, 270); // rect B center (1060,220), left edge (1000,220)
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 840, 220, 1060, 220);
  await sleep(page, 300);
  let d = (await paths(page))[0].d;
  eq(d, 'M 920 220 L 1000 220', 'ellipse->rect straight, 0 bends');
  eq(bends(d), 0, '0 bends');
  // rect above ellipse, vertically aligned
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 1000, 340, 1120, 440); // rect C center (1060,390), bottom edge (1060,440)
  await page.click('button[data-tool="ellipse"]');
  await dragWorld(page, 980, 500, 1140, 600); // ellipse D center (1060,550), top (1060,500)
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 1060, 390, 1060, 550);
  await sleep(page, 300);
  d = (await paths(page))[1].d;
  eq(d, 'M 1060 440 L 1060 500', 'rect->ellipse straight into the top, 0 bends');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('elbow: path never comes closer than the stub to a docked ellipse (screenshot case)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="ellipse"]');
  await dragWorld(page, 700, 200, 1000, 360); // ellipse, center (850,280), rx150 ry80
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  // from the right vertex to a free point below-right of the ellipse (the screenshot case)
  await dragWorld(page, 1000, 280, 960, 370);
  await sleep(page, 300);
  const d = (await paths(page))[0].d;
  // parse the polyline and check clearance to the ellipse (except within stub of the endpoints)
  const pts = d.slice(2).split(' L ').map((s) => s.split(' ').map(Number));
  const stub = 28;
  const c = { x: 850, y: 280 }, rx = 150, ry = 80;
  const distEllipse = (x, y) => {
    if (((x - c.x) / rx) ** 2 + ((y - c.y) / ry) ** 2 <= 1) return 0;
    const dx = x - c.x, dy = y - c.y;
    const th = Math.atan2(dy, dx);
    const r = (rx * ry) / Math.sqrt((ry * Math.cos(th)) ** 2 + (rx * Math.sin(th)) ** 2);
    return Math.hypot(dx, dy) - r;
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.ceil(len / 2));
    for (let j = 0; j <= n; j++) {
      const x = ax + ((bx - ax) * j) / n;
      const y = ay + ((by - ay) * j) / n;
      // endpoints have a 2-stub approach corridor (intentional); beyond that, no near-misses
      const nearEnd = Math.hypot(x - pts[0][0], y - pts[0][1]) < 2 * stub || Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]) < 2 * stub;
      if (nearEnd) continue;
      assert(distEllipse(x, y) > 0.5, `path CROSSES the ellipse at (${x.toFixed(0)},${y.toFixed(0)}), path ${d}`);
      assert(distEllipse(x, y) >= stub - 0.5, `path point (${x.toFixed(0)},${y.toFixed(0)}) only ${distEllipse(x, y).toFixed(1)}px from ellipse (< stub ${stub}), path ${d}`);
    }
  }
  eq(errors, [], 'no page errors');
  await page.close();
});
