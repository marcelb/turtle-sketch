// Rotation tests: rot handle drag, rendering transform, rotation-aware hit-testing,
// selection box (AABB of rotated corners), arrow docking + elbow routing to rotated shapes.
import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, paths, w2s, s2w, handles, selBoxes, toDot } from './harness.mjs';

// world position of the rotation handle circle
const rotHandle = (page) => page.evaluate(() => {
  const c = document.querySelector('#selection circle[data-handle="rot"]');
  return c ? { x: +c.getAttribute('cx'), y: +c.getAttribute('cy') } : null;
});
// transform of the rotated shape group wrapping the shape (null when unrotated)
const rotTransform = (page) => page.evaluate(() => {
  const g = document.querySelector('#shapes > g[transform]');
  return g ? g.getAttribute('transform') : null;
});
const selBox = (page) => page.evaluate(() => {
  const r = document.querySelector('#selection .sel-box');
  return r ? { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') } : null;
});
// drag the rotation handle from its current position to world point (wx,wy)
async function dragRotHandle(page, wx, wy, shift = false) {
  const h = await rotHandle(page);
  assert(h, 'rotation handle visible');
  const a = await w2s(page, h.x, h.y);
  const b = await w2s(page, wx, wy);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
// create a rect, select it, rotate it 90° via the handle (handle sits at (cx, top-20))
async function makeRotatedRect(page) {
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 200, 200, 400, 300); // rect center (300,250), 200x100
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 300, 250);
  await sleep(page, 200);
  await dragRotHandle(page, 380, 250); // start angle -90° -> end angle 0° => rot 90
  await sleep(page, 200);
}

test('rotation: handle drag rotates the shape group, selection box becomes the rotated AABB, resize handle hidden', async () => {
  const { page, errors } = await newRoom();
  await makeRotatedRect(page);
  eq(await rotTransform(page), 'rotate(90 300 250)', 'shape group transform');
  // rotated corners of (200,200)-(400,300) around (300,250) by 90°: AABB = (250,150) 100x200; sel-box pads 3
  const b = await selBox(page);
  eq(b, { x: 247, y: 147, w: 106, h: 206 }, 'selection box = AABB of rotated corners');
  eq(await handles(page), 1, 'only the rotation handle while rotated (no resize handle)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: unrotated selection shows resize + rotate handles', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 200, 200, 400, 300);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 300, 250);
  await sleep(page, 200);
  eq(await handles(page), 2, 'resize + rotate handles when unrotated');
  eq(await rotTransform(page), null, 'no transform when unrotated');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: shift-drag snaps to 15° steps', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 200, 200, 400, 300);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 300, 250);
  await sleep(page, 200);
  // handle at (300,180), center (300,250): start angle -90°; end (400,220): angle atan2(-30,100) ≈ -16.7° => delta ≈ 73.3° -> snap 75
  await dragRotHandle(page, 400, 220, true);
  await sleep(page, 200);
  eq(await rotTransform(page), 'rotate(75 300 250)', 'shift snaps to 15° multiple');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: plain drag snaps to 90° multiples within 6°, so rotating back to 0 is easy', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 200, 200, 400, 300); // center (300,250)
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 300, 250);
  await sleep(page, 200);
  // handle at (300,142): start angle -90°. Target (399.6,241.3): angle atan2(-8.7,99.6) ≈ -5° => delta 85° -> snaps to 90
  await dragRotHandle(page, 399.6, 241.3);
  await sleep(page, 200);
  eq(await rotTransform(page), 'rotate(90 300 250)', '85° snaps to 90°');
  // handle now at (300,92) (AABB top after 90°): start angle -90°. Target (200.4,241.3): angle ≈ -175° => delta -85° => rot 5° -> snaps to 0
  await dragRotHandle(page, 200.4, 241.3);
  await sleep(page, 200);
  eq(await rotTransform(page), null, '5° snaps back to 0 (original rotation)');
  // an angle far from any 90° multiple stays free: delta 73.3° -> 73.3
  await dragRotHandle(page, 400, 220);
  await sleep(page, 200);
  eq(await rotTransform(page), 'rotate(73.3 300 250)', '73.3° does not snap');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: hit-testing follows the rotated outline', async () => {
  const { page, errors } = await newRoom();
  await makeRotatedRect(page); // rect (200,200)-(400,300) rotated 90° => occupies x 250..350, y 150..350
  // (300,160) is inside the rotated rect but outside the unrotated one -> selects
  await clickWorld(page, 300, 160);
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'point inside rotated outline selects');
  await clickWorld(page, 1000, 600);
  await sleep(page, 120);
  // (210,210) is inside the unrotated rect but outside the rotated one -> no selection
  await clickWorld(page, 210, 210);
  await sleep(page, 200);
  eq(await selBoxes(page), 0, 'point inside old bbox but outside rotated outline does not select');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: moving a rotated shape keeps the rotation', async () => {
  const { page, errors } = await newRoom();
  await makeRotatedRect(page);
  await dragWorld(page, 300, 250, 360, 290); // move by (+60,+40)
  await sleep(page, 200);
  eq(await rotTransform(page), 'rotate(90 360 290)', 'transform center follows the move, rot kept');
  const r = await page.evaluate(() => {
    const rect = document.querySelector('#shapes g[transform] rect[data-id]');
    return rect ? { x: +rect.getAttribute('x'), y: +rect.getAttribute('y') } : null;
  });
  eq(r, { x: 260, y: 240 }, 'local rect coords moved by the drag delta');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: arrow docks to the rotated border (endpoint offset rides the rotation)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 300, 200); // A: center (200,150), 200x100
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 150);
  await sleep(page, 200);
  await dragRotHandle(page, 280, 150); // -90° -> 0° => rot 90; outline now x 150..250, y 50..250
  await sleep(page, 200);
  eq(await rotTransform(page), 'rotate(90 200 150)', 'A rotated 90°');
  // arrow from free space on the right, dropped near A: docks at the center of the side
  // facing the start — world +x is the local top edge after 90° rotation => world (250,150)
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 400, 150, 245, 150);
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 400 150 L 250 150'], 'arrow docks to the rotated border point');
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 325, 150); // on the arrow shaft
  await sleep(page, 200);
  eq(await toDot(page), { x: 250, y: 150 }, 'endpoint dot on the rotated border');
  // rotate A back to 0 (handle at (200,-8), drag to (120,150): angle -90° -> 180° = delta -90):
  // the stored local offset (top side center) must now land at the unrotated top center (200,100)
  await clickWorld(page, 200, 150);
  await sleep(page, 200);
  await dragRotHandle(page, 120, 150);
  await sleep(page, 200);
  eq(await rotTransform(page), null, 'A back to unrotated');
  eq((await paths(page)).map((p) => p.d), ['M 400 150 L 200 100'], 'docked endpoint followed the rotation back');
  await clickWorld(page, 300, 125); // on the new shaft
  await sleep(page, 200);
  eq(await toDot(page), { x: 200, y: 100 }, 'endpoint dot on the unrotated side center');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('rotation: elbow arrow to a rotated shape stays axis-aligned and docks on its border', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 300, 200); // A: center (200,150)
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 400, 300, 520, 400); // B: center (460,350)
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 150);
  await sleep(page, 200);
  await dragRotHandle(page, 280, 150); // A rot 90 => outline x 150..250, y 50..250
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 460, 350, 260, 200); // from B towards A's right side
  await sleep(page, 300);
  const ps = await paths(page);
  eq(ps.length, 1, 'one elbow arrow created');
  const pts = ps[0].d.replace(/^M /, '').split(' L ').map((s) => s.split(' ').map(Number));
  assert(pts.length >= 2, 'path has points');
  for (let i = 0; i < pts.length - 1; i++) {
    assert(Math.abs(pts[i][0] - pts[i + 1][0]) < 0.01 || Math.abs(pts[i][1] - pts[i + 1][1]) < 0.01,
      `segment ${i} is axis-aligned: ${JSON.stringify(pts[i])} -> ${JSON.stringify(pts[i + 1])}`);
  }
  // select the arrow via its shaft to read the endpoint dot
  await page.click('button[data-tool="select"]');
  const midSeg = { x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2 };
  await clickWorld(page, midSeg.x, midSeg.y);
  await sleep(page, 200);
  // the target end must sit on A's rotated outline: local coords back on the rect border
  const end = pts[pts.length - 1];
  const dot = await toDot(page);
  assert(dot, 'endpoint dot visible');
  eq(end, [dot.x, dot.y], 'path end = endpoint dot');
  const local = await page.evaluate(([x, y]) => {
    // recompute local coords the way util.localPoint does: rotate by -90 around (200,150)
    const r = -90 * Math.PI / 180;
    const dx = x - 200, dy = y - 150;
    return { x: 200 + dx * Math.cos(r) - dy * Math.sin(r), y: 150 + dx * Math.sin(r) + dy * Math.cos(r) };
  }, end);
  const onBorder = Math.abs(local.x - 100) < 0.5 || Math.abs(local.x - 300) < 0.5 || Math.abs(local.y - 100) < 0.5 || Math.abs(local.y - 200) < 0.5;
  assert(onBorder, `dock point on the rotated outline (local ${JSON.stringify(local)})`);
  assert(local.x >= 100 - 0.5 && local.x <= 300 + 0.5 && local.y >= 100 - 0.5 && local.y <= 200 + 0.5, 'dock point within the shape bounds');
  eq(errors, [], 'no page errors');
  await page.close();
});
