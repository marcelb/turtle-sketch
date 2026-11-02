// Border-drag resizing: pressing a shape's border and dragging scales that side only; a plain
// click on the border just selects. Frames are excluded (border drag moves them). Also: the
// selection knobs keep a constant screen size when zooming.
import { newRoom, test, assert, eq, sleep, dragWorld, clickWorld, selBoxes, w2s, guides } from './harness.mjs';

const shapeRect = (page, sel = '#shapes > rect[data-id]') => page.evaluate((s) => {
  const r = document.querySelector(s);
  return r ? { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') } : null;
}, sel);

const frameRect = (page) => shapeRect(page, '#frames rect[data-id]');

const vpK = (page) => page.evaluate(() => {
  const m = /scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
  return +m[1];
});

const seHandle = (page) => page.evaluate(() => {
  const h = document.querySelector('#selection [data-handle="se"]');
  return h ? { w: +h.getAttribute('width'), k: +/scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'))[1] } : null;
});

async function makeRect(page, x1 = 100, y1 = 100, x2 = 300, y2 = 220) {
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, x1, y1, x2, y2);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);
}

test('border-resize: dragging the right border scales width only, top border height only, corner both', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page); // rect (100,100) 200x120

  await dragWorld(page, 300, 160, 360, 160); // grab right border midpoint
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 100, y: 100, w: 260, h: 120 }, 'right border drag: only width grows');

  await dragWorld(page, 200, 100, 200, 60); // grab top border midpoint
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 100, y: 60, w: 260, h: 160 }, 'top border drag: only y/h change');

  await dragWorld(page, 100, 220, 70, 250); // grab bottom-left corner
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 70, y: 60, w: 290, h: 190 }, 'corner drag: left+bottom scale');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: plain click on the border selects; interior drag still moves', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page);

  await clickWorld(page, 300, 160); // right border, no drag
  await sleep(page, 450);
  eq(await selBoxes(page), 1, 'border click selects');

  await dragWorld(page, 200, 160, 260, 200); // interior drag
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 160, y: 140, w: 200, h: 120 }, 'interior drag moves, does not scale');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: ellipse and text box scale from their border too', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="ellipse"]');
  await dragWorld(page, 100, 100, 300, 220);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 300, 160, 350, 160); // ellipse right border
  await sleep(page, 150);
  const e = await page.evaluate(() => {
    const el = document.querySelector('#shapes ellipse[data-id]');
    return { cx: +el.getAttribute('cx'), rx: +el.getAttribute('rx') };
  });
  eq(e, { cx: 225, rx: 125 }, 'ellipse border drag scales the bbox');

  await page.click('button[data-tool="text"]');
  await dragWorld(page, 400, 300, 520, 360);
  await sleep(page, 200);
  await page.keyboard.type('hi'); // empty text boxes vanish on blur
  await page.keyboard.press('Control+Enter'); // commit and leave text edit mode (Escape would cancel)
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 520, 330, 560, 330); // text box right border
  await sleep(page, 150);
  eq(await shapeRect(page, '#shapes g[data-id] rect'), { x: 396, y: 296, w: 168, h: 64 }, 'text box border drag scales (incl. its 4px pad)');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: frame border drag moves the frame, never scales it', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 140, 140, 340, 290);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  await dragWorld(page, 340, 215, 400, 215); // grab right border of the frame
  await sleep(page, 150);
  eq(await frameRect(page), { x: 200, y: 140, w: 200, h: 150 }, 'frame border drag moves it, size unchanged');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: hover cursor reflects the border side under the mouse', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page); // rect (100,100) 200x120
  const cursorAt = async (wx, wy) => {
    const s = await w2s(page, wx, wy);
    await page.mouse.move(s.x, s.y);
    await sleep(page, 80);
    return page.evaluate(() => document.getElementById('board').style.cursor);
  };
  eq(await cursorAt(300, 160), 'ew-resize', 'right border');
  eq(await cursorAt(100, 160), 'ew-resize', 'left border');
  eq(await cursorAt(200, 100), 'ns-resize', 'top border');
  eq(await cursorAt(200, 220), 'ns-resize', 'bottom border');
  eq(await cursorAt(300, 220), 'nwse-resize', 'bottom-right corner');
  eq(await cursorAt(100, 100), 'nwse-resize', 'top-left corner');
  eq(await cursorAt(300, 100), 'nesw-resize', 'top-right corner');
  eq(await cursorAt(200, 160), 'move', 'interior');
  eq(await cursorAt(700, 600), '', 'empty canvas');

  // frame border: drag moves, so the cursor is move, not resize
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 500, 400, 700, 550);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);
  eq(await cursorAt(700, 475), 'move', 'frame border shows move cursor');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: border drag snaps to alignment guides like the corner knob', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page); // A: (100,100) 200x120
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 360, 300, 460, 400); // B: left edge at x=360
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  // drag A's right border toward B's left edge, stopping 3px short: should snap to 360
  const a = await w2s(page, 300, 160);
  const b = await w2s(page, 357, 160);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await sleep(page, 120);
  assert((await guides(page)).length > 0, 'guide line visible mid-drag');
  await page.mouse.up();
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 100, y: 100, w: 260, h: 120 }, 'right edge snapped to x=360 (w=260, not 257)');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: knob and selection-box strokes stay constant screen width when zooming', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page);
  await clickWorld(page, 200, 160);
  await sleep(page, 200);
  const check = () => page.evaluate(() => {
    const h = document.querySelector('#selection [data-handle="se"]');
    const b = document.querySelector('#selection .sel-box');
    return { handle: getComputedStyle(h).vectorEffect, box: getComputedStyle(b).vectorEffect };
  });
  eq(await check(), { handle: 'non-scaling-stroke', box: 'non-scaling-stroke' }, 'strokes are non-scaling before zoom');
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -480);
  await sleep(page, 250);
  eq(await check(), { handle: 'non-scaling-stroke', box: 'non-scaling-stroke' }, 'strokes are non-scaling after zoom');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: selection knobs keep constant screen size when zooming', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page);
  await clickWorld(page, 200, 160); // select the rect
  await sleep(page, 200);

  const before = await seHandle(page);
  assert(before, 'resize handle visible');
  const screenW1 = before.w * before.k;

  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -480); // zoom in
  await sleep(page, 250);
  const after = await seHandle(page);
  assert(after, 'resize handle still visible after zoom');
  const screenW2 = after.w * after.k;

  assert(after.k !== before.k, 'zoom actually changed');
  eq(Math.round(screenW2 * 100), Math.round(screenW1 * 100), 'knob screen size identical before/after zoom');
  eq(Math.round(after.w * 1000), Math.round((9 / after.k) * 1000), 'knob world size tracks 1/k');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('border-resize: the corner scale knob snaps to 1:1 (square) when near equal width/height', async () => {
  const { page, errors } = await newRoom();
  await makeRect(page); // rect (100,100) 200x120
  await clickWorld(page, 200, 160);
  await sleep(page, 200);

  // drag the se knob so width 122 vs height 118 (4px apart) -> snaps to 122x122, thick X shown mid-drag
  const xLines = () => page.evaluate(() => [...document.querySelectorAll('#overlay line.guide')].filter((l) => l.getAttribute('stroke-width') === '3' && l.getAttribute('stroke') === '#4a6cf7').length);
  let a = await w2s(page, 295, 215);
  let b = await w2s(page, 222, 218);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await sleep(page, 150);
  eq(await xLines(), 2, 'thick X (2 lines) visible while the 1:1 snap is active');
  await page.mouse.up();
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 100, y: 100, w: 122, h: 122 }, 'near-square drag snapped to 1:1');
  eq(await xLines(), 0, 'X gone after drop');

  // drag far from square: 200x160 -> no snap
  await dragWorld(page, 217, 217, 300, 260);
  await sleep(page, 150);
  eq(await shapeRect(page), { x: 100, y: 100, w: 200, h: 160 }, 'non-square drag not snapped');

  eq(errors, [], 'no page errors');
  await page.close();
});
