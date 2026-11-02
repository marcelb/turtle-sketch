// Multi-select options bar: space evenly horizontally/vertically, align top/bottom.
import { test, assert, eq, newRoom, sleep, dragWorld } from './harness.mjs';

// three rects with distinct sizes so they can be told apart by w/h:
// A(100,100,50x50) B(280,200,60x40) C(500,300,70x30)
async function threeRects() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 100, 100, 150, 150); // A 50x50
  await dragWorld(r.page, 280, 200, 340, 240); // B 60x40
  await dragWorld(r.page, 500, 300, 570, 330); // C 70x30
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="select"]');
  await dragWorld(r.page, 50, 50, 650, 400); // marquee over all three
  await sleep(r.page, 200);
  return r;
}

const bySize = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#shapes > rect[data-id]')]
    .map((r) => ({ w: +r.getAttribute('width'), h: +r.getAttribute('height'), x: +r.getAttribute('x'), y: +r.getAttribute('y') }))
    .sort((a, b) => a.w - b.w || a.h - b.h)); // A(50x50), B(60x40), C(70x30)

test('multi-ops: bar shows the multi controls only for 2+ selected objects', async () => {
  const { page, errors } = await threeRects();
  eq(await page.evaluate(() => document.getElementById('multictl').style.display), 'contents', 'multictl visible with 3 selected');
  // single selection hides it again (click empty canvas first, then one rect)
  const empty = await page.evaluate(() => {
    const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    return { x: 700 * +t[3] + +t[1], y: 450 * +t[3] + +t[2] };
  });
  await page.mouse.click(empty.x, empty.y);
  await sleep(page, 150);
  const a = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#shapes > rect[data-id]')].find((r) => +r.getAttribute('width') === 50);
    const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    return { x: (+r.getAttribute('x') + 25) * +t[3] + +t[1], y: (+r.getAttribute('y') + 25) * +t[3] + +t[2] };
  });
  await page.mouse.click(a.x, a.y);
  await sleep(page, 150);
  eq(await page.evaluate(() => document.getElementById('multictl').style.display), 'none', 'multictl hidden with a single selection');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('multi-ops: space evenly horizontally applies the leftmost gap to all, y untouched', async () => {
  const { page, errors } = await threeRects();
  // gap between A(right=150) and B(left=280) is 130 -> C moves to 280+60+130 = 470
  await page.click('#fmtbar #multictl button[data-act="spaceH"]');
  await sleep(page, 250);
  const rs = await bySize(page);
  eq(rs.map((r) => r.x), [100, 280, 470], 'x positions after spaceH');
  eq(rs.map((r) => r.y), [100, 200, 300], 'y untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('multi-ops: space evenly vertically applies the topmost gap to all, x untouched', async () => {
  const { page, errors } = await threeRects();
  // gap between A(bottom=150) and B(top=200) is 50 -> C moves to 200+40+50 = 290
  await page.click('#fmtbar #multictl button[data-act="spaceV"]');
  await sleep(page, 250);
  const rs = await bySize(page);
  eq(rs.map((r) => r.y), [100, 200, 290], 'y positions after spaceV');
  eq(rs.map((r) => r.x), [100, 280, 500], 'x untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});

// overlapping pair: A(100,100,50x50) B(120,200,60x40) C(500,300,70x30)
// A.right=150 > B.left=120 -> raw horizontal gap is -30, must clamp to 10
async function overlappingRects() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 100, 100, 150, 150); // A 50x50
  await dragWorld(r.page, 120, 200, 180, 240); // B 60x40, overlapping A horizontally
  await dragWorld(r.page, 500, 300, 570, 330); // C 70x30
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="select"]');
  await dragWorld(r.page, 50, 50, 650, 400); // marquee over all three
  await sleep(r.page, 200);
  return r;
}

test('multi-ops: spaceH enforces a 10px minimum gap when the first two overlap', async () => {
  const { page, errors } = await overlappingRects();
  await page.click('#fmtbar #multictl button[data-act="spaceH"]');
  await sleep(page, 250);
  const rs = await bySize(page);
  // clamped gap 10: B.x = 100+50+10 = 160, C.x = 160+60+10 = 230
  eq(rs.map((r) => r.x), [100, 160, 230], 'x positions after spaceH with min gap');
  eq(rs.map((r) => r.y), [100, 200, 300], 'y untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('multi-ops: spaceV enforces a 10px minimum gap when the first two overlap', async () => {
  // A(100,100,50x50) B(200,120,60x40) C(300,500,70x30): A.bottom=150 > B.top=120 -> raw gap -30
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 100, 100, 150, 150); // A 50x50
  await dragWorld(r.page, 200, 120, 260, 160); // B 60x40, overlapping A vertically
  await dragWorld(r.page, 300, 500, 370, 530); // C 70x30
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="select"]');
  await dragWorld(r.page, 50, 50, 650, 600);
  await sleep(r.page, 200);
  await r.page.click('#fmtbar #multictl button[data-act="spaceV"]');
  await sleep(r.page, 250);
  const rs = await bySize(r.page);
  // clamped gap 10: B.y = 100+50+10 = 160, C.y = 160+40+10 = 210
  eq(rs.map((r) => r.y), [100, 160, 210], 'y positions after spaceV with min gap');
  eq(rs.map((r) => r.x), [100, 200, 300], 'x untouched');
  eq(r.errors, [], 'no page errors');
  await r.page.close();
});

test('multi-ops: frames are excluded from space evenly and aligning', async () => {
  const r = await newRoom();
  await r.page.click('button[data-tool="frame"]');
  await dragWorld(r.page, 140, 140, 340, 290); // frame (140,140)-(340,290)
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 400, 100, 450, 150); // A 50x50
  await dragWorld(r.page, 520, 200, 580, 240); // B 60x40
  await dragWorld(r.page, 700, 300, 770, 330); // C 70x30
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="select"]');
  await dragWorld(r.page, 130, 130, 800, 400); // marquee crosses the frame border, contains all rects
  await sleep(r.page, 200);
  const frameSel = await r.page.evaluate(() => {
    const f = document.querySelector('#frames rect[data-id]');
    const sel = [...document.querySelectorAll('#selection .sel-box')];
    return { n: sel.length, fx: +f.getAttribute('x'), fy: +f.getAttribute('y') };
  });
  eq(frameSel.n, 4, 'frame + 3 rects selected');

  // gap A.right=450 -> B.left=520 is 70 -> C.x = 520+60+70 = 650; frame must not move
  await r.page.click('#fmtbar #multictl button[data-act="spaceH"]');
  await sleep(r.page, 250);
  let rs = await bySize(r.page);
  eq(rs.map((x) => x.x), [400, 520, 650], 'rect x positions after spaceH');
  let fr = await r.page.evaluate(() => {
    const f = document.querySelector('#frames rect[data-id]');
    return { x: +f.getAttribute('x'), y: +f.getAttribute('y') };
  });
  eq(fr, { x: 140, y: 140 }, 'frame unmoved by spaceH');

  // bottoms A=150, B=240, C=330 -> all bottoms at 330; frame must not move
  await r.page.click('#fmtbar #multictl button[data-act="alignBottom"]');
  await sleep(r.page, 250);
  rs = await bySize(r.page);
  eq(rs.map((x) => x.y + x.h), [330, 330, 330], 'all rect bottoms at 330');
  fr = await r.page.evaluate(() => {
    const f = document.querySelector('#frames rect[data-id]');
    return { x: +f.getAttribute('x'), y: +f.getAttribute('y') };
  });
  eq(fr, { x: 140, y: 140 }, 'frame unmoved by alignBottom');
  eq(r.errors, [], 'no page errors');
  await r.page.close();
});

test('multi-ops: align top sets every top edge to the highest top edge', async () => {
  const { page, errors } = await threeRects();
  await page.click('#fmtbar #multictl button[data-act="alignTop"]');
  await sleep(page, 250);
  const rs = await bySize(page);
  eq(rs.map((r) => r.y), [100, 100, 100], 'all tops at y=100');
  eq(rs.map((r) => r.x), [100, 280, 500], 'x untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('multi-ops: align bottom sets every bottom edge to the lowest bottom edge', async () => {
  const { page, errors } = await threeRects();
  // bottoms: A 150, B 240, C 330 -> all bottoms at 330: A.y=280, B.y=290, C.y=300
  await page.click('#fmtbar #multictl button[data-act="alignBottom"]');
  await sleep(page, 250);
  const rs = await bySize(page);
  eq(rs.map((r) => r.y + r.h), [330, 330, 330], 'all bottoms at 330');
  eq(rs.map((r) => r.x), [100, 280, 500], 'x untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});
