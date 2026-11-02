// Connector labels: double-click an arrow -> rich text editor at the path midpoint;
// supports multiline, font size, bold, italic, color; the input grows with its content.
import { test, assert, eq, newRoom, sleep, dragWorld, dblclickWorld, clickWorld, paths, setColor } from './harness.mjs';

// two rects A(140,140,120x100) B(400,140,120x100) with a straight arrow A -> B (midpoint 330,190)
async function arrowRoom() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 140, 140, 260, 240); // A
  await dragWorld(r.page, 400, 140, 520, 240); // B
  await sleep(r.page, 150);
  await r.page.click('button[data-tool="arrow"]');
  await dragWorld(r.page, 260, 190, 400, 190); // A right-center -> B left-center
  await sleep(r.page, 300);
  eq(await r.page.evaluate(() => [...document.querySelectorAll('#shapes path[data-id]')].filter((p) => p.getAttribute('stroke') !== 'transparent').map((p) => p.getAttribute('d'))),
    ['M 260 190 L 400 190'], 'straight arrow created');
  await r.page.click('button[data-tool="select"]');
  await sleep(r.page, 100);
  return r;
}

// rendered labels: #shapes > g[data-id] (pill rect + one <text> per line with tspans)
const labels = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#shapes > g[data-id]')].map((g) => {
    const r = g.querySelector('rect');
    return {
      pill: { cx: +r.getAttribute('x') + +r.getAttribute('width') / 2, cy: +r.getAttribute('y') + +r.getAttribute('height') / 2, w: +r.getAttribute('width'), h: +r.getAttribute('height') },
      lines: [...g.querySelectorAll('text')].map((t) => ({
        y: +t.getAttribute('y'),
        fill: t.getAttribute('fill'), // whole-label text color lives on the <text> element
        segs: [...t.querySelectorAll('tspan')].map((s) => ({ t: s.textContent, fw: s.getAttribute('font-weight'), fs: s.getAttribute('font-size'), fi: s.getAttribute('font-style'), fill: s.getAttribute('fill') })),
      })),
    };
  }));
const editorOpen = (page) => page.evaluate(() => !!document.querySelector('.wb-editing'));
const editorFo = (page) => page.evaluate(() => {
  const f = document.querySelector('.wb-edit-fo');
  return f ? { x: +f.getAttribute('x'), y: +f.getAttribute('y'), w: +f.getAttribute('width'), h: +f.getAttribute('height') } : null;
});

test('arrow label: double-click on arrow opens the text input at the midpoint', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  assert(await editorOpen(page), 'editor is open');
  const fo = await editorFo(page);
  eq({ x: Math.round(fo.x + fo.w / 2), y: Math.round(fo.y + fo.h / 2) }, { x: 330, y: 190 }, 'editor centered on the midpoint (330,190)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: typing + Ctrl+Enter renders the label pill on the arrow', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('hello');
  await sleep(page, 150);
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  assert(!(await editorOpen(page)), 'editor closed');
  const ls = await labels(page);
  eq(ls.length, 1, 'one label rendered');
  eq(ls[0].lines.flatMap((l) => l.segs.map((s) => s.t)).join(''), 'hello', 'label text');
  eq({ x: Math.round(ls[0].pill.cx), y: Math.round(ls[0].pill.cy) }, { x: 330, y: 190 }, 'pill centered at path midpoint');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: multiline via Enter, editor and pill grow, Ctrl+Enter commits', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await sleep(page, 200);
  assert(await editorOpen(page), 'plain Enter inserts a line, editor stays open');
  const fo = await editorFo(page);
  assert(fo.h > 30 / 1.6, `editor grew taller (h=${fo.h})`); // initial height was 30 screen px
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  const ls = await labels(page);
  eq(ls[0].lines.length, 2, 'two rendered lines');
  eq(ls[0].lines.map((l) => l.segs.map((s) => s.t).join('')), ['first', 'second'], 'line contents');
  assert(ls[0].pill.h > 30, `pill grew with the two lines (h=${ls[0].pill.h})`);
  eq({ x: Math.round(ls[0].pill.cx), y: Math.round(ls[0].pill.cy) }, { x: 330, y: 190 }, 'pill still centered at midpoint');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: input field width grows with long content', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  const before = (await editorFo(page)).w;
  await page.keyboard.type('a fairly long label that should widen the input field');
  await sleep(page, 200);
  const after = (await editorFo(page)).w;
  assert(after > before + 20, `editor width grew: ${before} -> ${after}`);
  await page.keyboard.press('Control+Enter');
  await sleep(page, 150);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: font size, bold, italic and color apply to the label', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('styled');
  await page.keyboard.press('Control+A');
  await sleep(page, 100);
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // 16 -> 18
  await page.click('#fmtbar [data-k="bold"]');
  await page.click('#fmtbar [data-k="italic"]');
  await setColor(page, '#fb-color-input', '#ff0000');
  await sleep(page, 150);
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  const ls = await labels(page);
  const seg = ls[0].lines[0].segs[0];
  eq(seg.t, 'styled', 'text');
  eq(seg.fs, '18', 'font size applied');
  eq(seg.fw, '700', 'bold applied');
  eq(seg.fi, 'italic', 'italic applied');
  eq(seg.fill, '#ff0000', 'color applied');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: Escape reverts the edit', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('draft');
  await page.keyboard.press('Escape');
  await sleep(page, 200);
  assert(!(await editorOpen(page)), 'editor closed');
  eq(await labels(page), [], 'no label after revert');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: editing an existing label replaces it; clearing removes it', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('first');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  eq((await labels(page))[0].lines.flatMap((l) => l.segs.map((s) => s.t)).join(''), 'first', 'label set');
  // re-open: the editor is pre-filled with the existing label
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelector('.wb-editing').textContent), 'first', 'editor pre-filled');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('second');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  eq((await labels(page))[0].lines.flatMap((l) => l.segs.map((s) => s.t)).join(''), 'second', 'label replaced');
  // clear it entirely -> label disappears
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  eq(await labels(page), [], 'label removed when cleared');
  eq((await paths(page)).length, 1, 'arrow itself still there');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: double-click on the selected elbow arrow\'s mid handle opens the editor (pointer capture suppresses native dblclick)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A
  await dragWorld(page, 400, 320, 520, 420); // B below-right
  await sleep(page, 150);
  await page.click('button[data-tool="elbow"]');
  await dragWorld(page, 260, 190, 460, 320); // elbow: M 260 190 L 460 190 L 460 320
  await sleep(page, 300);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 360, 190); // select the arrow -> mid handle at the corner (460,190)
  await sleep(page, 200);
  const handle = await page.evaluate(() => {
    const e = document.querySelector('#selection [data-ep="mid"]');
    return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null;
  });
  eq(handle, { x: 460, y: 190 }, 'mid handle at the elbow corner');
  await dblclickWorld(page, 460, 190); // exactly on the handle
  await sleep(page, 250);
  assert(await editorOpen(page), 'editor opened from the handle double-click');
  await page.keyboard.type('corner');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  const ls = await labels(page);
  eq(ls[0].lines.flatMap((l) => l.segs.map((s) => s.t)).join(''), 'corner', 'label text');
  eq({ x: Math.round(ls[0].pill.cx), y: Math.round(ls[0].pill.cy) }, { x: 460, y: 190 }, 'label at the elbow corner');
  // the double-click must not have dragged the elbow anchor: path unchanged
  eq(await page.evaluate(() => [...document.querySelectorAll('#shapes path[data-id]')].filter((p) => p.getAttribute('stroke') !== 'transparent').map((p) => p.getAttribute('d'))),
    ['M 260 190 L 460 190 L 460 320'], 'elbow path unchanged');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: while editing, the editor is an opaque input and the mid knob is hidden', async () => {
  const { page, errors } = await arrowRoom();
  await clickWorld(page, 330, 190); // select the arrow -> mid knob visible
  await sleep(page, 200);
  assert(await page.evaluate(() => !!document.querySelector('#selection [data-ep="mid"]')), 'mid knob visible when selected');
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  assert(await editorOpen(page), 'editor open');
  eq(await page.evaluate(() => document.querySelector('.wb-edit-fo').getAttribute('class')), 'wb-edit-fo conn', 'connector editor has the input style class');
  eq(await page.evaluate(() => getComputedStyle(document.querySelector('.wb-edit-wrap')).backgroundColor), 'rgb(255, 255, 255)', 'editor background is opaque white');
  eq(await page.evaluate(() => !!document.querySelector('#selection [data-ep="mid"]')), false, 'mid knob hidden while editing');
  eq(await page.evaluate(() => !!document.querySelector('#selection [data-ep="from"]')), true, 'endpoint knobs still visible');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  eq(await page.evaluate(() => !!document.querySelector('#selection [data-ep="mid"]')), true, 'mid knob back after commit');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: text controls work on the selected arrow without entering edit mode', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('fmt me');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  await clickWorld(page, 330, 190); // select the arrow (not editing)
  await sleep(page, 200);
  eq(await page.evaluate(() => document.getElementById('textctl').style.display), 'contents', 'text controls visible for a selected arrow');
  eq(await page.evaluate(() => document.getElementById('connctl').style.display), 'contents', 'arrow controls still visible');
  await page.click('#fmtbar [data-k="bold"]');
  await page.click('#fmtbar [data-k="italic"]');
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]');
  await setColor(page, '#fb-color-input', '#00aa00');
  await sleep(page, 250);
  const ls = await labels(page);
  const seg = ls[0].lines[0].segs[0];
  eq(seg.fw, '700', 'bold applied while only selected');
  eq(seg.fi, 'italic', 'italic applied while only selected');
  eq(seg.fs, '18', 'font size applied while only selected');
  eq(ls[0].lines[0].fill, '#00aa00', 'color applied while only selected (whole-label text color)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('arrow label: label follows the arrow when an endpoint is re-docked', async () => {
  const { page, errors } = await arrowRoom();
  await dblclickWorld(page, 330, 190);
  await sleep(page, 200);
  await page.keyboard.type('move me');
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  // drag the "to" endpoint dot from B's left edge down to B's top edge (460,140)
  const dot = await page.evaluate(() => {
    const e = document.querySelector('#selection [data-ep="to"]');
    return e ? { x: +e.getAttribute('cx'), y: +e.getAttribute('cy') } : null;
  });
  assert(dot, 'endpoint dot visible (arrow selected)');
  const a = await page.evaluate(({ x, y }) => {
    const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    return { x: x * +t[3] + +t[1], y: y * +t[3] + +t[2] };
  }, dot);
  const b = await page.evaluate(() => {
    const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    return { x: 460 * +t[3] + +t[1], y: 140 * +t[3] + +t[2] };
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await sleep(page, 300);
  const ls = await labels(page);
  eq(ls[0].lines.flatMap((l) => l.segs.map((s) => s.t)).join(''), 'move me', 'label still there');
  const c = { x: Math.round(ls[0].pill.cx), y: Math.round(ls[0].pill.cy) };
  assert(c.x !== 330 || c.y !== 190, `label moved with the new midpoint (now ${JSON.stringify(c)})`);
  eq(errors, [], 'no page errors');
  await page.close();
});
