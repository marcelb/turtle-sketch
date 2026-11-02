import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, w2s, paths, selBoxes, barSection, shapeTexts, selectEditorText } from './harness.mjs';

async function twoRects() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 140, 140, 260, 240); // A
  await dragWorld(r.page, 340, 140, 460, 240); // B
  await sleep(r.page, 200);
  return r;
}

test('clipboard: empty copy/paste are no-ops', async () => {
  const { page, errors } = await newRoom();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  eq((await rects(page)).length, 0, 'nothing pasted');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: paste duplicates the selection and is a single undo step', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280); // marquee both
  await sleep(page, 150);
  await page.keyboard.press('Control+c');
  await sleep(page, 100);
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  eq((await rects(page)).length, 4, 'two pasted');
  await page.keyboard.press('Control+z');
  await sleep(page, 300);
  eq((await rects(page)).length, 2, 'one undo removes the whole paste');
  await page.keyboard.press('Control+Shift+z');
  await sleep(page, 300);
  eq((await rects(page)).length, 4, 'redo restores');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: paste lands centered under the cursor, cascades +24, resets on mouse move', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+c');
  await sleep(page, 100);
  // pasted bounds are (140,140)-(460,240), center (300,190); target cursor world (940,540)
  // -> shift (640,350) -> A' at (780,490), B' at (980,490)
  const s = await w2s(page, 940, 540);
  await page.mouse.move(s.x, s.y);
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  let rs = await rects(page);
  eq(rs.map((r) => [r.x, r.y]), [[140, 140], [340, 140], [780, 490], [980, 490]], 'paste centered under cursor');
  // paste again without moving the mouse -> cascade +24
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  rs = await rects(page);
  eq(rs.map((r) => [r.x, r.y]), [[140, 140], [340, 140], [780, 490], [804, 514], [980, 490], [1004, 514]], 'cascade +24 without mouse move');
  // move the mouse, paste -> lands under the new cursor, cascade reset
  const s2 = await w2s(page, 240, 590);
  await page.mouse.move(s2.x, s2.y);
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  rs = await rects(page);
  eq(rs.map((r) => [r.x, r.y]), [[80, 540], [140, 140], [280, 540], [340, 140], [780, 490], [804, 514], [980, 490], [1004, 514]], 'paste under new cursor, cascade reset');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: single shape pastes with its center under the cursor', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A alone
  await sleep(page, 150);
  await page.keyboard.press('Control+c');
  await sleep(page, 100);
  const s = await w2s(page, 640, 590); // A is 120x100 -> pasted at (580,540)
  await page.mouse.move(s.x, s.y);
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  const rs = await rects(page);
  eq([rs[rs.length - 1].x, rs[rs.length - 1].y], [580, 540], 'single rect center at cursor');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: pasting a group keeps it a group and movable as a unit', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await page.keyboard.press('Control+c');
  await sleep(page, 100);
  const s = await w2s(page, 940, 540);
  await page.mouse.move(s.x, s.y);
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  eq((await rects(page)).map((r) => [r.x, r.y]), [[140, 140], [340, 140], [780, 490], [980, 490]], 'group pasted under cursor');
  eq(await selBoxes(page), 1, 'pasted content is one group selection');
  eq(await barSection(page, 'groupctl'), 'contents', 'ungroup available for pasted group');
  // moving the pasted group moves both pasted rects, originals stay
  await dragWorld(page, 840, 540, 890, 590);
  await sleep(page, 200);
  eq((await rects(page)).map((r) => [r.x, r.y]), [[140, 140], [340, 140], [830, 540], [1030, 540]], 'pasted group moved as a unit');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: marquee selects a connector together with shapes; paste keeps it docked', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 640, 340, 760, 440); // C
  await dragWorld(page, 840, 340, 960, 440); // D
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 700, 390, 900, 390);
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 760 390 L 840 390'], 'arrow C->D docked');
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 600, 300, 1000, 480); // marquee C + D + arrow
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'two rects selected'); eq(await page.evaluate(() => document.querySelectorAll('#selection [data-ep]').length), 3, 'connector endpoint dots shown');
  await page.keyboard.press('Control+c');
  await sleep(page, 100);
  await page.keyboard.press('Control+v'); // no mouse move -> cascade +24
  await sleep(page, 1000);
  eq((await rects(page)).length, 4, 'rects pasted');
  const ps = (await paths(page)).map((p) => p.d);
  eq(ps.length, 2, 'arrow pasted');
  eq(ps[1], 'M 960 480 L 1040 480', 'pasted arrow still docked between the pasted rects (shifted to cursor)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: Ctrl+X cuts (originals gone) and paste restores the content', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+x');
  await sleep(page, 300);
  eq((await rects(page)).length, 0, 'cut removed the originals');
  await page.keyboard.press('Control+v');
  await sleep(page, 1000);
  eq((await rects(page)).length, 2, 'paste restored them');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('undo: deleting a selection can be undone', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Delete');
  await sleep(page, 200);
  eq((await rects(page)).length, 0, 'deleted');
  await page.keyboard.press('Control+z');
  await sleep(page, 300);
  eq((await rects(page)).length, 2, 'undo restores both');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('clipboard: text copied in the editor carries the base font size into another shape', async () => {
  const { page, errors } = await newRoom();
  // shape A: text box, base size 20, "bb" bold
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // auto-enters edit mode
  await sleep(page, 250);
  await page.keyboard.type('aa bb cc');
  await sleep(page, 200);
  await page.keyboard.press('Control+a');
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // 18 -> 20
  await sleep(page, 150);
  await selectEditorText(page, 3, 5);
  await page.click('#fmtbar [data-k="bold"]');
  await sleep(page, 150);
  // capture what a copy inside the editor puts on the clipboard
  const html = await page.evaluate(() => {
    const div = document.querySelector('.wb-editing');
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ev = new ClipboardEvent('copy', { clipboardData: new DataTransfer() });
    div.dispatchEvent(ev);
    return ev.clipboardData.getData('text/html');
  });
  assert(html.includes('font-size: 20px'), 'copied html carries the base font size 20: ' + html);
  await clickWorld(page, 1000, 700); // blur A
  await sleep(page, 300);
  // shape B: plain text box at the default size 16; paste the captured html into its editor
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 400, 640, 500);
  await sleep(page, 250);
  await page.evaluate((h) => {
    const div = document.querySelector('.wb-editing');
    div.innerHTML = h;
    div.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await sleep(page, 200);
  await clickWorld(page, 1000, 700); // blur B
  await sleep(page, 300);
  const b = (await shapeTexts(page)).filter((t) => t.y > 300)[0];
  eq(b.segs.map((s) => [s.t, s.fw, s.fs]), [['aa ', '400', '20'], ['bb', '700', '20'], [' cc', '400', '20']], 'pasted text keeps base size 20 and the bold word');
  eq(errors, [], 'no page errors');
  await page.close();
});
