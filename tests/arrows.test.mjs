import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, paths, rects, toDot, w2s, drag, setColor, barSection } from './harness.mjs';

// container S(100,100,400,300) with inner T(140,140,80,60) and U(320,140,80,60)
async function containerRoom() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 140, 140, 220, 200); // T
  await dragWorld(r.page, 320, 140, 400, 200); // U
  await dragWorld(r.page, 100, 100, 500, 400); // S (press outside T/U)
  await sleep(r.page, 200);
  return r;
}
const pathD = async (page) => (await paths(page)).map((p) => p.d);

test('arrows: new arrow between rects docks at side centers', async () => {
  const { page, errors } = await containerRoom();
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 180, 170, 360, 170); // T -> U
  await sleep(page, 300);
  eq(await pathD(page), ['M 220 170 L 320 170'], 'T right-center to U left-center');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: release near a border from outside docks to it', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await dragWorld(page, 400, 140, 520, 240); // B
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 260, 190, 388, 190); // 12px outside B's left edge (snap 14)
  await sleep(page, 300);
  eq(await pathD(page), ['M 260 190 L 400 190'], 'dock at B left edge');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: end inside a different shape docks (old behavior)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await dragWorld(page, 400, 140, 520, 240); // B
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 260, 190, 460, 190); // deep inside B
  await sleep(page, 300);
  eq(await pathD(page), ['M 260 190 L 400 190'], 'dock at side facing start');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: both ends inside the same shape -> free-free, no dock, no clone', async () => {
  const { page, errors } = await containerRoom();
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 310, 360, 250, 300); // both inside S only
  await sleep(page, 300);
  eq(await pathD(page), ['M 310 360 L 250 300'], 'free start and free end');
  eq((await rects(page)).length, 3, 'no clone spawned');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: start on inner shape, end in clear space of container -> clone created', async () => {
  const { page, errors } = await containerRoom();
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 180, 170, 250, 300); // T -> clear space inside S
  await sleep(page, 300);
  const rs = await rects(page);
  eq(rs.length, 4, 'clone of T created');
  const d = (await pathD(page))[0];
  assert(d.endsWith('L 250 300') || d.endsWith('L 250.00000000000003 300'), `arrow ends at drop point, got ${d}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: endpoint drag moves around the shape and snaps to side middle when near', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await dragWorld(page, 400, 300, 520, 400); // B
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 190, 460, 350); // A -> B, side centers
  await sleep(page, 300);
  eq(await pathD(page), ['M 260 190 L 400 350'], 'created with side centers');
  // select the arrow by clicking its midpoint, then drag the 'to' dot around B
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 330, 270);
  await sleep(page, 200);
  const dragToDot = async (wx, wy) => {
    const dot = await toDot(page);
    assert(dot, 'to-endpoint dot visible');
    const a = await w2s(page, dot.x, dot.y);
    const b = await w2s(page, wx, wy);
    await drag(page, a.x, a.y, b.x, b.y, 6);
    await sleep(page, 200);
  };
  await dragToDot(520, 330); // right side of B
  eq((await pathD(page))[0], 'M 260 190 L 520 330', 'moved to right side');
  await dragToDot(460, 400); // bottom side
  eq((await pathD(page))[0], 'M 260 190 L 460 400', 'moved to bottom side');
  await dragToDot(400, 390); // left side, far from middle -> no snap
  eq((await pathD(page))[0], 'M 260 190 L 400 390', 'left side, no midpoint snap');
  await dragToDot(402, 360); // near left-side middle (400,350) within 14 -> snap
  eq((await pathD(page))[0], 'M 260 190 L 400 350', 'snapped to side middle');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: text boxes are never dock targets (both directions)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 340, 290); // rect
  await sleep(page, 100);
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 540, 140, 740, 240); // text box
  await sleep(page, 200);
  await clickWorld(page, 1000, 600); // exit text edit if open
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  // from inside the text box to inside the rect: start free, end docked on rect border
  await dragWorld(page, 640, 190, 240, 215);
  await sleep(page, 300);
  let d = (await pathD(page))[0];
  assert(d.startsWith('M 640 190 '), `start is a free point inside the text box, got ${d}`);
  assert(/L (140|340) /.test(d) || /L \d+ 140 /.test(d) || /L \d+ 290 /.test(d), `end docked on rect border, got ${d}`);
  // from the rect to inside the text box: end free at the drop point
  await dragWorld(page, 240, 215, 660, 220);
  await sleep(page, 300);
  const all = await pathD(page);
  eq(all.length, 2, 'second arrow created');
  assert(all[1].endsWith('L 660 220'), `end inside the text box stays a free point, got ${all[1]}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: elbow arrow between aligned rects has 0 bends and can be colored', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 640, 340, 760, 440); // C
  await dragWorld(page, 840, 340, 960, 440); // D
  await sleep(page, 150);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 700, 390, 900, 390);
  await sleep(page, 300);
  eq(await pathD(page), ['M 760 390 L 840 390'], 'elbow arrow straight between aligned rects (0 bends)');
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 800, 390);
  await sleep(page, 200);
  eq(await barSection(page, 'connctl'), 'contents', 'connctl shown for elbow arrow');
  await setColor(page, '#fb-conn-color-input', '#00ff00');
  await sleep(page, 200);
  eq((await paths(page))[0].stroke, '#00ff00', 'elbow arrow color applied');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: ellipse creation and dock lands on the ellipse outline (not side center)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="ellipse"]');
  await dragWorld(page, 140, 140, 260, 240); // ellipse A center (200,190) rx60 ry50
  await dragWorld(page, 400, 140, 520, 240); // ellipse B center (460,190) rx60 ry50
  await sleep(page, 150);
  const ellipses = await page.evaluate(() => [...document.querySelectorAll('#shapes ellipse[data-id]')].length);
  eq(ellipses, 2, 'ellipses created');
  await page.click('button[data-tool="arrow"]');
  // start on A's right edge area, end 5px outside B's left edge -> dock on B's outline
  await dragWorld(page, 260, 190, 393, 190);
  await sleep(page, 300);
  const d = (await pathD(page))[0];
  const m = /L ([\d.]+) ([\d.]+)$/.exec(d);
  assert(m, `arrow docked, got ${d}`);
  const ex = +m[1], ey = +m[2];
  const onEllipse = Math.abs(((ex - 460) / 60) ** 2 + ((ey - 190) / 50) ** 2 - 1) < 0.05;
  assert(onEllipse, `endpoint (${ex},${ey}) lies on B's ellipse outline`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrows: dragging the midpoint handle curves the arrow', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 200, 500, 250);
  await sleep(page, 300);
  eq(await pathD(page), ['M 200 200 L 500 250'], 'straight first');
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 350, 225); // select arrow
  await sleep(page, 200);
  const mid = await page.evaluate(() => { const e = document.querySelector('#selection [data-ep="mid"]'); return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null; });
  assert(mid, 'mid handle shown');
  const a = await w2s(page, mid.x, mid.y);
  const b = await w2s(page, mid.x, mid.y + 80);
  await drag(page, a.x, a.y, b.x, b.y, 6);
  await sleep(page, 250);
  const d = (await pathD(page))[0];
  assert(d.includes('Q'), `path is curved after mid drag, got ${d}`);
  eq(errors, [], 'no page errors');
  await page.close();
});
