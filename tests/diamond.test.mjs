import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, paths, setColor, w2s } from './harness.mjs';

test('diamond: creation renders a polygon and hit-test uses the diamond outline', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 440, 140, 640, 240); // diamond (440,140) 200x100, center (540,190)
  await sleep(page, 200);
  const poly = await page.evaluate(() => {
    const p = document.querySelector('#shapes polygon[data-id]');
    return p ? p.getAttribute('points') : null;
  });
  eq(poly, '540,140 640,190 540,240 440,190', 'diamond polygon points');
  // center click selects
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 540, 190);
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelectorAll('#selection .sel-box').length), 1, 'center click selects');
  // corner of the bounding box (outside the diamond) does not select
  await clickWorld(page, 1000, 600); await sleep(page, 120);
  await clickWorld(page, 448, 148);
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelectorAll('#selection .sel-box').length), 0, 'bbox corner outside diamond does not select');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('diamond: styling and arrow docking on the outline', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 140, 140, 260, 240); // A diamond center (200,190)
  await dragWorld(page, 400, 140, 520, 240); // B diamond center (460,190)
  await sleep(page, 200);
  // style A: fill + border
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190);
  await sleep(page, 200);
  await setColor(page, '#fb-fill-input', '#00ff00');
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelector('#shapes polygon[data-id]').getAttribute('fill')), '#00ff00', 'diamond fill');
  // arrow A -> B: docks on the outlines (right vertex of A, left vertex of B)
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 190, 398, 190); // near B's left vertex
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 260 190 L 400 190'], 'arrow docks vertex-to-vertex');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('diamond: endpoints cling to the border and snap to a corner only within 14px (creation + endpoint drag)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 400, 140, 520, 240); // B diamond, center (460,190), vertices (460,140),(520,190),(460,240),(400,190)
  await sleep(page, 200);
  await page.click('button[data-tool="arrow"]');
  // creation from below, drop near the top vertex: snaps to the cursor-near corner (460,140)
  await dragWorld(page, 460, 400, 462, 146);
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 460 400 L 460 140'], 'creation snaps to the corner nearest the cursor');
  // creation drop on the top-right edge midpoint: border point (496,170) is 29px from the
  // nearest corner (beyond 14px snap) -> slides to the border point, no corner snap
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 500, 505, 165); // start away from the first arrow
  await sleep(page, 300);
  eq((await paths(page))[1].d, 'M 200 500 L 496 170', 'creation beyond 14px of a corner slides to the border point');
  // endpoint drag: select the arrow, drag the 'to' dot near the top corner -> snaps to (460,140)
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 460, 320); // on the arrow line
  await sleep(page, 200);
  const toDot = () => page.evaluate(() => {
    const e = document.querySelector('#selection [data-ep="to"]');
    return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null;
  });
  const dragTo = async (wx, wy) => {
    const d0 = await toDot();
    const a = await w2s(page, d0.x, d0.y);
    const b = await w2s(page, wx, wy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await sleep(page, 200);
  };
  await dragTo(461, 144); // 4px from top corner (460,140): within 14px snap
  eq((await paths(page))[0].d, 'M 460 400 L 460 140', 'endpoint within 14px of a corner snaps to it');
  await dragTo(505, 165); // mid-edge, 29px from nearest corner: slides along the border, NOT a corner
  const d2 = (await paths(page))[0].d;
  const m = /L ([\d.]+) ([\d.]+)$/.exec(d2);
  const ex = +m[1], ey = +m[2];
  const onOutline = Math.abs(Math.abs(ex - 460) / 60 + Math.abs(ey - 190) / 50 - 1) < 0.05;
  const isVertex = [[460, 140], [520, 190], [460, 240], [400, 190]].some(([vx, vy]) => Math.abs(ex - vx) < 1 && Math.abs(ey - vy) < 1);
  assert(onOutline, `mid-edge endpoint clings to the border, got (${ex},${ey})`);
  assert(!isVertex, `mid-edge endpoint must not snap to a corner beyond 14px, got (${ex},${ey})`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('diamond: elbow arrow start snaps to the corner too (0-bend)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 140, 140, 260, 240); // A center (200,190), right vertex (260,190)
  await dragWorld(page, 400, 140, 520, 240); // B center (460,190), left vertex (400,190)
  await sleep(page, 200);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 200, 190, 430, 190); // drop inside B near the left vertex
  await sleep(page, 300);
  const d = (await paths(page))[0].d;
  assert(d.startsWith('M 260 190 '), `elbow start at right corner of A, got `);
  assert(d.endsWith('L 400 190'), `elbow end at left corner of B, got `);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('diamond: dragging the arrow START node around the diamond clings to the border and snaps to corners within 14px, both directions, all edges', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="diamond"]');
  await dragWorld(page, 400, 140, 520, 240); // diamond, center (460,190), vertices T(460,140) R(520,190) B(460,240) L(400,190)
  await sleep(page, 200);
  // arrow starting ON the diamond (right vertex), ending free far right
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 520, 190, 800, 190);
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 520 190 L 800 190'], 'arrow starts at right vertex');
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 660, 190); // select the arrow (midpoint)
  await sleep(page, 200);
  const fromDot = () => page.evaluate(() => {
    const e = document.querySelector('#selection [data-ep="from"]');
    return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null;
  });
  const verts = [[460, 140], [520, 190], [460, 240], [400, 190]];
  const cx = 460, cy = 190, hw = 60, hh = 50;
  const cursorAt = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const rOut = 1 / (Math.abs(Math.cos(rad)) / hw + Math.abs(Math.sin(rad)) / hh);
    const r = rOut + 6; // 6px outside the surface
    return { x: Math.round(cx + r * Math.cos(rad)), y: Math.round(cy + r * Math.sin(rad)) };
  };
  const dragFromTo = async (wx, wy) => {
    const d0 = await fromDot();
    assert(d0, 'from-dot visible');
    const a = await w2s(page, d0.x, d0.y);
    const b = await w2s(page, wx, wy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await sleep(page, 120);
    const d = (await paths(page))[0].d;
    const m = /^M ([\d.-]+) ([\d.-]+)/.exec(d);
    return { x: +m[1], y: +m[2], d };
  };
  const check = (deg, end) => {
    const c = cursorAt(deg);
    // expected border point toward the cursor (diamond ray intersection)
    const dx = c.x - cx, dy = c.y - cy;
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    const op = { x: cx + dx * t, y: cy + dy * t };
    // snap happens when the BORDER POINT (the visible node position) is within 14px of a corner
    const nearV = verts.map((v) => ({ v, d: Math.hypot(op.x - v[0], op.y - v[1]) }));
    const nearest = nearV.reduce((a, b) => (b.d < a.d ? b : a));
    const free = Math.abs(end.x - c.x) < 0.5 && Math.abs(end.y - c.y) < 0.5;
    // 1) while sliding along the border the node always clings to it (docked on the outline)
    assert(!free, `angle ${deg}: endpoint went FREE at cursor (${c.x},${c.y})`);
    const onOutline = Math.abs(Math.abs(end.x - cx) / hw + Math.abs(end.y - cy) / hh - 1) < 0.05
      || verts.some((v) => Math.abs(end.x - v[0]) < 1 && Math.abs(end.y - v[1]) < 1);
    assert(onOutline, `angle ${deg}: endpoint not on the diamond border, end=(${end.x},${end.y}) cursor=(${c.x},${c.y})`);
    // 2) border point within 14px of a corner -> snap exactly onto that corner...
    if (nearest.d <= 14) {
      assert(Math.abs(end.x - nearest.v[0]) < 1 && Math.abs(end.y - nearest.v[1]) < 1,
        `angle ${deg}: border point ${nearest.d.toFixed(1)}px from corner (${nearest.v}) but end=(${end.x},${end.y}) did not snap`);
    } else {
      // ...otherwise the node slides to the border point, not onto a corner
      const atVertex = verts.some((v) => Math.abs(end.x - v[0]) < 1 && Math.abs(end.y - v[1]) < 1);
      assert(!atVertex, `angle ${deg}: snapped to corner (${end.x},${end.y}) though border point ${nearest.d.toFixed(1)}px from nearest`);
      assert(Math.hypot(end.x - op.x, end.y - op.y) < 1.5, `angle ${deg}: end=(${end.x},${end.y}) should slide to border point (${op.x.toFixed(1)},${op.y.toFixed(1)})`);
    }
  };
  // counterclockwise (on screen: right -> top -> left -> bottom -> right), then clockwise back
  const angles = [];
  for (let a = 0; a < 360; a += 10) angles.push(a);
  for (const a of [...angles, ...[...angles].reverse()]) {
    const c = cursorAt(a);
    const end = await dragFromTo(c.x, c.y);
    check(a, end);
  }
  // explicitly to the middle of each edge (still snaps to the nearest corner)
  for (const a of [45, 135, 225, 315]) {
    const c = cursorAt(a);
    const end = await dragFromTo(c.x, c.y);
    check(a, end);
  }
  eq(errors, [], 'no page errors');
  await page.close();
});
