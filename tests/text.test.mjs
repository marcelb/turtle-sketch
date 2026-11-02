import { test, assert, eq, newRoom, sleep, dragWorld, dblclickWorld, clickWorld, shapeTexts, editLineCount, editLineTexts, selectEditorText, setColor, measureEditHop } from './harness.mjs';

const LONG = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffff';

const PARA = 'This paragraph fills the body of the layout. It exists purely to occupy space so that typography, spacing, and overall rhythm can be reviewed before the real content arrives. Replace it whenever the actual copy is ready.';

test('text: long line wraps after blur exactly like in edit mode', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // rect w=120 -> wrap width 108
  await sleep(page, 150);
  await dblclickWorld(page, 200, 190);
  await sleep(page, 300);
  await page.keyboard.type(LONG, { delay: 3 });
  await sleep(page, 200);
  const editLines = await editLineCount(page);
  assert(editLines > 1, `expected wrapping in edit mode, got ${editLines} line(s)`);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const texts = await shapeTexts(page);
  eq(texts.length, editLines, 'rendered line count must equal edit-mode line count');
  eq(texts[0].segs.map((s) => s.t).join(''), 'aaaaaaaaaa ', 'first wrapped line content');
  eq(texts.map((t) => t.segs.map((s) => s.t).join('')).join(''), LONG, 'all text preserved');
  eq(errors, [], 'no page errors');
  await page.close();
});

// Blur out of edit mode and assert the rendered text matches what the contenteditable showed:
// same number of lines, all text present, no line past the shape's right edge, and every
// tspan rendered at its full width (i.e. no whitespace collapsed away at run boundaries).
async function assertRenderMatchesEdit(page, expectedText) {
  const editLines = await editLineCount(page);
  const editTexts = await editLineTexts(page);
  assert(editLines > 1, `expected wrapping in edit mode, got ${editLines} line(s)`);
  await clickWorld(page, 1000, 700); // blur
  await sleep(page, 300);
  const texts = await shapeTexts(page);
  eq(texts.length, editLines, 'rendered line count must equal edit-mode line count');
  // per-line content must match edit mode exactly (no mid-word breaks, no lost spaces)
  eq(
    texts.map((t) => t.segs.map((s) => s.t).join('').replace(/\s+/g, ' ').trim()),
    editTexts.map((t) => t.replace(/\s+/g, ' ').trim()),
    'rendered line breaks match edit-mode line breaks'
  );
  eq(texts.map((t) => t.segs.map((s) => s.t).join('')).join('').replace(/\s+/g, ''), expectedText.replace(/\s+/g, ''), 'all text preserved');
  const overflow = await page.evaluate(() => {
    const r = document.querySelector('#shapes rect[data-id]');
    const sx = +r.getAttribute('x');
    const sw = +r.getAttribute('width');
    return [...document.querySelectorAll('#shapes text')].map((t) => +t.getAttribute('x') + t.getComputedTextLength() - (sx + sw));
  });
  assert(overflow.every((o) => o <= 0.5), `lines overflow the shape by ${JSON.stringify(overflow)}`);
  // rendered glyph width of each tspan must equal a probe measuring its text with
  // xml:space=preserve — catches spaces collapsed at run boundaries (e.g. around bold words)
  const mismatch = await page.evaluate(() => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    probe.setAttribute('xml:space', 'preserve');
    document.getElementById('board').appendChild(probe);
    const out = [];
    for (const t of document.querySelectorAll('#shapes text tspan')) {
      probe.setAttribute('font-size', t.getAttribute('font-size') || '16');
      probe.setAttribute('font-weight', t.getAttribute('font-weight') || '400');
      if (t.getAttribute('font-style')) probe.setAttribute('font-style', t.getAttribute('font-style'));
      else probe.removeAttribute('font-style');
      probe.textContent = t.textContent;
      const expected = probe.getComputedTextLength();
      const actual = t.getComputedTextLength();
      if (Math.abs(expected - actual) > 0.5) out.push({ t: t.textContent, expected: +expected.toFixed(1), actual: +actual.toFixed(1) });
    }
    probe.remove();
    return out;
  });
  eq(mismatch, [], 'every tspan renders at full width incl. spaces');
  return texts;
}

async function boldWords(page, text, words) {
  for (const w of words) {
    const i = text.indexOf(w);
    await selectEditorText(page, i, i + w.length);
    await page.click('#fmtbar [data-k="bold"]');
    await sleep(page, 100);
  }
}

test('text: mixed bold runs wrap after blur exactly like in edit mode', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 540, 440); // rect w=400 -> wrap width 388
  await sleep(page, 150);
  await dblclickWorld(page, 340, 290);
  await sleep(page, 300);
  await page.keyboard.type(PARA, { delay: 1 });
  await sleep(page, 200);
  await boldWords(page, PARA, ['paragraph', 'body', 'typography', 'rhythm', 'reviewed', 'copy']);
  const texts = await assertRenderMatchesEdit(page, PARA);
  // sanity: the bold words really are separate runs on the rendered lines
  assert(texts.some((t) => t.segs.some((s) => s.fw === '700' && s.t === 'paragraph')), 'paragraph rendered bold');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: whole-paragraph global bold+size wraps like edit mode', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 540, 440);
  await sleep(page, 150);
  await dblclickWorld(page, 340, 290);
  await sleep(page, 300);
  await page.keyboard.type(PARA, { delay: 1 });
  await sleep(page, 200);
  await page.keyboard.press('Control+a');
  await page.click('#fmtbar [data-k="bold"]');
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]');
  await sleep(page, 200);
  const texts = await assertRenderMatchesEdit(page, PARA);
  assert(texts.every((t) => t.segs.every((s) => s.fw === '700' && s.fs === '18')), 'all runs globally bold 18px');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: mixed sizes, italic and color on specific words wrap like edit mode', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 540, 440);
  await sleep(page, 150);
  await dblclickWorld(page, 340, 290);
  await sleep(page, 300);
  await page.keyboard.type(PARA, { delay: 1 });
  await sleep(page, 200);
  const i1 = PARA.indexOf('occupy');
  await selectEditorText(page, i1, i1 + 'occupy'.length);
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // 18 -> 20
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // -> 22
  await sleep(page, 100);
  const i2 = PARA.indexOf('spacing');
  await selectEditorText(page, i2, i2 + 'spacing'.length);
  await page.click('#fmtbar [data-k="italic"]');
  await sleep(page, 100);
  const i3 = PARA.indexOf('overall');
  await selectEditorText(page, i3, i3 + 'overall'.length);
  await setColor(page, '#fb-color-input', '#ff0000');
  await sleep(page, 100);
  const texts = await assertRenderMatchesEdit(page, PARA);
  const flat = texts.flatMap((t) => t.segs);
  assert(flat.some((s) => s.t === 'occupy' && s.fs === '20'), 'occupy grew to 20px');
  assert(flat.some((s) => s.t === 'overall' && s.fill === '#ff0000'), 'overall is red');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: multiple paragraphs with bold words in each wrap like edit mode', async () => {
  const P1 = 'First paragraph with a bold word here and more text to make it wrap around nicely.';
  const P2 = 'Second paragraph also has a bold word and enough text so that it wraps too.';
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 460, 500); // rect w=320 -> wrap width 308
  await sleep(page, 150);
  await dblclickWorld(page, 300, 320);
  await sleep(page, 300);
  await page.keyboard.type(P1, { delay: 1 });
  await page.keyboard.press('Enter');
  await page.keyboard.type(P2, { delay: 1 });
  await sleep(page, 200);
  const all = P1 + '\n' + P2;
  await boldWords(page, P1, ['bold']);
  await boldWords(page, P2, ['bold']);
  await assertRenderMatchesEdit(page, all);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: single newlines and empty lines render after blur', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // auto-enters edit mode
  await sleep(page, 250);
  await page.keyboard.type('aaa');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bbb');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  const texts = await shapeTexts(page);
  eq(texts.map((t) => t.segs.map((s) => s.t).join('')), ['aaa', '', 'bbb'], 'lines after blur');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: bold/size apply only to the selected part; whole-text applies to all', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // auto-enters edit mode
  await sleep(page, 250);
  await page.keyboard.type('aa bb cc');
  await sleep(page, 200);
  // select "bb" (offsets 3..5) and make it bold + bigger
  await selectEditorText(page, 3, 5);
  await page.click('#fmtbar [data-k="bold"]');
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  let segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fw, s.fs]), [['aa ', '400', '18'], ['bb', '700', '20'], [' cc', '400', '18']], 'partial bold+size');
  // now select all and press + once: the mixed sizes are overwritten uniformly (18+2=20),
  // and the bold of "bb" stays untouched (size and bold are independent)
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  await page.keyboard.press('Control+a');
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fw, s.fs]), [['aa ', '400', '20'], ['bb', '700', '20'], [' cc', '400', '20']], 'whole-text size overwrites uniformly, bold independent');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: partial color applies to the selection, whole-text color overwrites run colors', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 240, 190, 640, 440); // rect (180,130) 400x250
  await sleep(page, 150);
  await dblclickWorld(page, 440, 315);
  await sleep(page, 300);
  await page.keyboard.type('hello world foo');
  await sleep(page, 200);
  // select "hello world " via keyboard
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await sleep(page, 150);
  await setColor(page, '#fb-color-input', '#ff0000');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  let segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fill]), [['hello world ', '#ff0000'], ['foo', null]], 'partial color on selection only');
  // whole-text color: collapse selection, pick green -> all runs lose their own color
  await dblclickWorld(page, 440, 315);
  await sleep(page, 300);
  await page.keyboard.press('ArrowRight'); // collapse
  await setColor(page, '#fb-color-input', '#00ff00');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => s.fill), [null, null], 'run colors stripped by whole-text color');
  eq(segs.map((s) => s.t).join(''), 'hello world foo', 'full text intact');
  const shapeFill = await page.evaluate(() => document.querySelector('#shapes text').getAttribute('fill'));
  eq(shapeFill, '#00ff00', 'shape text color is green');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: native color picker blur keeps edit mode; canvas click exits it', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  const editingAfterCreate = await page.evaluate(() => !!document.querySelector('.wb-editing'));
  eq(editingAfterCreate, true, 'text box enters edit mode right after creation');
  await page.keyboard.type('abc');
  await sleep(page, 150);
  // open the native color picker (mousedown marks it active), then simulate it stealing focus
  await page.$eval('#fb-color-input', (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  await page.$eval('.wb-editing', (el) => el.dispatchEvent(new FocusEvent('blur')));
  await sleep(page, 200);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'picker blur keeps edit mode');
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), false, 'canvas click exits edit mode');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: alignment applies to the whole box and renders after blur', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // text box (380,80) 200x100
  await sleep(page, 200);
  await page.keyboard.type('hi');
  await sleep(page, 150);
  await page.click('#fmtbar [data-k="align"][data-v="right"]');
  await page.click('#fmtbar [data-k="valign"][data-v="bottom"]');
  await sleep(page, 200);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const t = await page.evaluate(() => {
    const el = document.querySelector('#shapes text');
    return el ? { x: +el.getAttribute('x'), y: +el.getAttribute('y') } : null;
  });
  assert(t, 'text rendered');
  // right-aligned: text x near right inner edge (380+200-2=578 minus text width); bottom: y near bottom
  assert(t.x > 500, `right-aligned x=${t.x} should be near the right edge`);
  assert(t.y > 150, `bottom-aligned y=${t.y} should be near the bottom (box 80..180)`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: size minus and bold toggle on a partial selection', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('aa bb');
  await sleep(page, 150);
  await selectEditorText(page, 0, 2); // "aa"
  await page.click('#fmtbar [data-k="fontSize"][data-d="-2"]');
  await sleep(page, 150);
  await page.click('#fmtbar [data-k="bold"]');
  await sleep(page, 150);
  await page.click('#fmtbar [data-k="bold"]'); // toggle off again
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  const segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fw, s.fs]), [['aa', '400', '16'], [' bb', '400', '18']], 'minus on selection; bold toggled on and off');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: overflowing shape text is clipped (clip-path present)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 200, 170); // small rect 60x30
  await sleep(page, 150);
  await dblclickWorld(page, 170, 155);
  await sleep(page, 300);
  await page.keyboard.type('aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  const clip = await page.evaluate(() => {
    const g = document.querySelector('#shapes g[clip-path]');
    return g ? g.getAttribute('clip-path') : null;
  });
  assert(clip && clip.startsWith('url(#sclip-'), `text group is clipped, got ${clip}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: whole-text bold toggle flips bold everywhere but keeps sizes', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('aa bb');
  await sleep(page, 150);
  await selectEditorText(page, 0, 2);
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // "aa" -> 20
  await sleep(page, 150);
  await page.keyboard.press('Control+a'); // select all
  await page.click('#fmtbar [data-k="bold"]'); // bold everywhere
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  let segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fw, s.fs]), [['aa', '700', '20'], [' bb', '700', '18']], 'bold on all, sizes kept');
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  await page.keyboard.press('Control+a');
  await page.click('#fmtbar [data-k="bold"]'); // bold off everywhere
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fw, s.fs]), [['aa', '400', '20'], [' bb', '400', '18']], 'bold off all, sizes still kept');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: bold applied via select-all in the editor toggles off correctly at shape level', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('aa bb');
  await sleep(page, 150);
  await page.keyboard.press('Control+a');
  await page.click('#fmtbar [data-k="bold"]'); // bold the whole text via editor selection
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const allFw = async () => (await shapeTexts(page))[0].segs.map((s) => s.fw);
  eq(await allFw(), ['700'], 'all bold after blur (runs merged)');
  await clickWorld(page, 540, 190); // select the whole box (no editor)
  await sleep(page, 200);
  const active = await page.evaluate(() => document.querySelector('#fmtbar [data-k="bold"]').classList.contains('active'));
  eq(active, true, 'bold button shows active for run-level bold');
  await page.click('#fmtbar [data-k="bold"]'); // one click must unbold
  await sleep(page, 200);
  eq(await allFw(), ['400'], 'first shape-level click unbolds');
  await page.click('#fmtbar [data-k="bold"]');
  await sleep(page, 200);
  eq(await allFw(), ['700'], 'second click bolds again');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: repeated +/- on a partial selection keeps stepping that selection only', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('aa bb');
  await sleep(page, 150);
  await selectEditorText(page, 0, 2); // "aa"
  for (let i = 0; i < 3; i++) { await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); await sleep(page, 120); }
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  const segs = (await shapeTexts(page))[0].segs;
  eq(segs.map((s) => [s.t, s.fs]), [['aa', '24'], [' bb', '18']], 'three + clicks step the selection to 24, rest untouched');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: format bar reflects the partial selection (size number, bold state)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('aa bb');
  await sleep(page, 150);
  await selectEditorText(page, 0, 2);
  await page.click('#fmtbar [data-k="fontSize"][data-d="2"]'); // aa -> 20
  await sleep(page, 150);
  await page.click('#fmtbar [data-k="bold"]'); // aa bold
  await sleep(page, 150);
  // reselect "aa" and check the bar reflects it
  await selectEditorText(page, 0, 2);
  await sleep(page, 150);
  eq(await page.evaluate(() => document.getElementById('fb-size').textContent), '20', 'size number shows the selection size');
  eq(await page.evaluate(() => document.querySelector('#fmtbar [data-k="bold"]').classList.contains('active')), true, 'bold active for bold selection');
  // mixed selection (all): size not uniform -> shows base, bold not uniform -> inactive
  await page.keyboard.press('Control+a');
  await sleep(page, 150);
  eq(await page.evaluate(() => document.getElementById('fb-size').textContent), '18', 'mixed-size selection shows base size');
  eq(await page.evaluate(() => document.querySelector('#fmtbar [data-k="bold"]').classList.contains('active')), false, 'mixed-bold selection shows inactive');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: mousedown on the color swatch keeps editor focus', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('abc');
  await sleep(page, 150);
  await selectEditorText(page, 0, 3);
  await page.$eval('#fb-color-input', (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  await sleep(page, 150);
  eq(await page.evaluate(() => document.activeElement?.classList.contains('wb-editing')), true, 'editor keeps focus through swatch mousedown');
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'still editing');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: Escape reverts edits, Ctrl+Enter commits and exits', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('original');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur -> committed "original"
  await sleep(page, 300);
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('changed');
  await sleep(page, 150);
  await page.keyboard.press('Escape'); // revert
  await sleep(page, 200);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), false, 'Escape exits edit mode');
  eq((await shapeTexts(page))[0].segs.map((s) => s.t).join(''), 'original', 'Escape reverted the text');
  // Ctrl+Enter commits and exits
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('committed');
  await sleep(page, 150);
  await page.keyboard.press('Control+Enter');
  await sleep(page, 200);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), false, 'Ctrl+Enter exits edit mode');
  eq((await shapeTexts(page))[0].segs.map((s) => s.t).join(''), 'committed', 'Ctrl+Enter committed the text');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: entering edit mode hops the text exactly ~1px down, 0px horizontal (left/top case)', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // text box world (440,140), fontSize 18
  await sleep(page, 200);
  await page.keyboard.type('hello');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const rendered = await page.evaluate(() => {
    const t = document.querySelector('#shapes text');
    return { x: +t.getAttribute('x'), y: +t.getAttribute('y') };
  });
  await dblclickWorld(page, 540, 190); // enter edit mode
  await sleep(page, 300);
  const edit = await page.evaluate(() => {
    const fo = document.querySelector('.wb-edit-fo');
    const div = document.querySelector('.wb-editing');
    const range = document.createRange();
    range.selectNodeContents(div);
    const r = range.getClientRects()[0];
    const svgR = document.getElementById('board').getBoundingClientRect();
    const k = 1; // vp.k at default zoom
    const vpT = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(document.getElementById('viewport').getAttribute('transform'));
    return {
      foX: +fo.getAttribute('x'), foY: +fo.getAttribute('y'),
      lineTop: (r.top - svgR.top - +vpT[2]) / k,
      lineH: r.height,
    };
  });
  // rendered: pad 6 (same as the editor) -> text at box.x+6, baseline at box.y+6+lineH*0.8 (lineH = 18*1.3 = 23.4)
  eq(rendered.x, 446, 'rendered text x = box.x + 6');
  eq(Math.round(rendered.y * 100) / 100, 164.72, 'rendered baseline = box.y + 6 + 23.4*0.8');
  // edit mode: editor origin at box.x+6, box.y+6+2 (the +2 fo offset, line box starts 1px above it)
  eq(edit.foX, 446, 'edit-mode editor x = box.x + 6');
  eq(edit.foY, 148, 'edit-mode editor y = box.y + 8');
  assert(Math.abs(edit.lineTop - 147) <= 1, `edit-mode first line top = box.y + 7, got ${edit.lineTop}`);
  // the intentional, uniform edit-mode cue: 0px horizontal, ~1px down (same as centered cases)
  eq(edit.foX - rendered.x, 0, 'horizontal hop of 0px (render and editor use the same pad)');
  assert(Math.abs((edit.lineTop - (rendered.y - edit.lineH * 0.8)) - 1) <= 1, 'vertical hop of ~1px down');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: edit-mode hop with center/center alignment is ~0px horizontal, ~1px down', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // box (440,140) 200x100, in edit mode
  await sleep(page, 200);
  await page.click('#fmtbar [data-k="align"][data-v="center"]');
  await page.click('#fmtbar [data-k="valign"][data-v="middle"]');
  await sleep(page, 150);
  await page.keyboard.type('hello');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const before = await measureEditHop(page, 18);
  await dblclickWorld(page, 540, 190); // re-enter edit mode
  await sleep(page, 300);
  const after = await measureEditHop(page, 18);
  const dx = after.edit.lineLeft - before.rendered.x;
  const dy = after.edit.lineTop - before.renderedLineTop;
  // rendered (centered): x = 440 + (200 - 38.87)/2 = 520.57, baseline = 140 + (100-23.4)/2 + 23.4*0.8 = 197.02
  assert(Math.abs(before.rendered.x - 520.57) < 0.5, `rendered centered x, got ${before.rendered.x}`);
  assert(Math.abs(before.rendered.y - 197.02) < 0.5, `rendered centered baseline, got ${before.rendered.y}`);
  assert(Math.abs(dx) <= 0.5, `horizontal hop ~0 for centered text, got ${dx.toFixed(2)}`);
  assert(dy > 0 && dy <= 2, `small downward hop ~1px for centered text, got ${dy.toFixed(2)}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('shapes: edit-mode hop for a rect (default center/middle) is also ~0px horizontal, ~1px down', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 440, 140, 640, 240); // rect (440,140) 200x100
  await sleep(page, 150);
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  await page.keyboard.type('hello');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const before = await measureEditHop(page, 16);
  await dblclickWorld(page, 540, 190);
  await sleep(page, 300);
  const after = await measureEditHop(page, 16);
  const dx = after.edit.lineLeft - before.rendered.x;
  const dy = after.edit.lineTop - before.renderedLineTop;
  assert(Math.abs(before.rendered.x - 522.73) < 0.5, `rendered centered x, got ${before.rendered.x}`);
  assert(Math.abs(dx) <= 0.5, `horizontal hop ~0 for rect, got ${dx.toFixed(2)}`);
  assert(dy > 0 && dy <= 2, `small downward hop ~1px for rect, got ${dy.toFixed(2)}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: empty or whitespace-only text box vanishes on blur; shapes with empty text stay', async () => {
  const { page, errors } = await newRoom();
  // empty text box: create and blur without typing -> gone
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  eq(await page.evaluate(() => document.querySelectorAll('#shapes g[data-id], #shapes > rect[data-id]').length), 0, 'empty text box vanished');
  // whitespace-only: type spaces, blur -> gone
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('   ');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  eq(await page.evaluate(() => document.querySelectorAll('#shapes g[data-id], #shapes > rect[data-id]').length), 0, 'whitespace-only text box vanished');
  // text box with real text stays
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('hi');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  eq(await page.evaluate(() => document.querySelectorAll('#shapes g[data-id]').length), 1, 'text box with content stays');
  // rect with empty text stays
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 700, 400, 820, 500);
  await sleep(page, 150);
  await dblclickWorld(page, 760, 450);
  await sleep(page, 250);
  await clickWorld(page, 1000, 600);
  await sleep(page, 300);
  eq(await page.evaluate(() => document.querySelectorAll('#shapes > rect[data-id]').length), 1, 'rect with empty text stays');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('text: italic button applies to the selection while editing and to the whole text otherwise; toggles off', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 140, 140, 340, 200);
  await sleep(page, 250);
  await page.keyboard.type('hello world');
  await sleep(page, 150);

  const segStyles = () => page.evaluate(() =>
    [...document.querySelectorAll('#shapes text tspan')].map((t) => ({ t: t.textContent, fs: t.getAttribute('font-style') })));

  // selection-level: italicize "hello" (while editing, the text lives in the editor div)
  const editHtml = () => page.evaluate(() => document.querySelector('.wb-editing')?.innerHTML);
  await selectEditorText(page, 0, 5);
  await page.click('#fmtbar [data-k="italic"]');
  await sleep(page, 200);
  eq(await editHtml(), '<i>hello</i> world', 'only the selected run is wrapped in <i>');

  // toggle off via the same selection (reset span, wrapper unwrapped)
  await selectEditorText(page, 0, 5);
  await page.click('#fmtbar [data-k="italic"]');
  await sleep(page, 200);
  eq(await editHtml(), '<span style="font-style: normal;">hello</span> world', 'italic toggled off again');

  // select all + italic -> every run italic, survives blur
  await selectEditorText(page, 0, 11);
  await page.click('#fmtbar [data-k="italic"]');
  await sleep(page, 150);
  await page.keyboard.press('Control+Enter');
  await sleep(page, 250);
  eq((await segStyles()).map((s) => s.fs), ['italic'], 'all runs render italic after blur');

  // whole-text toggle with no editor: shape-level italic off again, button state follows
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 240, 170);
  await sleep(page, 200);
  await page.click('#fmtbar [data-k="italic"]');
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelector('#fmtbar [data-k="italic"]').classList.contains('active')), false, 'italic button inactive after whole-text toggle off');
  eq((await segStyles()).every((s) => s.fs === null), true, 'all runs normal again');

  eq(errors, [], 'no page errors');
  await page.close();
});
