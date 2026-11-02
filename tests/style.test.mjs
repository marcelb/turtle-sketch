import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, paths, setColor, shapeTexts, dblclickWorld, barSection, handles } from './harness.mjs';

test('style: shape fill, no-fill, border color and border thickness', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190);
  await sleep(page, 200);
  eq(await barSection(page, 'stylectl'), 'contents', 'style controls shown for a shape');
  await setColor(page, '#fb-fill-input', '#00ff00');
  await sleep(page, 200);
  eq((await rects(page))[0].fill, '#00ff00', 'fill color applied');
  await page.click('#fb-fill-none');
  await sleep(page, 200);
  eq((await rects(page))[0].fill, 'none', 'transparent fill');
  await setColor(page, '#fb-stroke-input', '#0000ff');
  await sleep(page, 200);
  eq((await rects(page))[0].stroke, '#0000ff', 'border color applied');
  await page.click('#stylectl [data-k="width"][data-v="4"]');
  await sleep(page, 200);
  eq((await rects(page))[0].sw, 4, 'border thickness applied');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: border color and text color are independent', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 300, 240);
  await sleep(page, 150);
  await dblclickWorld(page, 220, 190);
  await sleep(page, 300);
  await page.keyboard.type('hi');
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 220, 190);
  await sleep(page, 200);
  await setColor(page, '#fb-stroke-input', '#0000ff'); // border color only
  await sleep(page, 200);
  eq((await rects(page))[0].stroke, '#0000ff', 'border color applied');
  eq((await shapeTexts(page))[0].fill, '#1a1a1a', 'text color unchanged by border color');
  await setColor(page, '#fb-color-input', '#ff0000'); // text color only
  await sleep(page, 200);
  eq((await shapeTexts(page))[0].fill, '#ff0000', 'text color applied');
  eq((await rects(page))[0].stroke, '#0000ff', 'border color unchanged by text color');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: arrow color, thickness, dash and arrowheads', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 200, 500, 250);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 350, 225); // click the arrow line
  await sleep(page, 200);
  eq(await barSection(page, 'connctl'), 'contents', 'connector controls shown for an arrow');
  await setColor(page, '#fb-conn-color-input', '#ff00aa');
  await sleep(page, 200);
  eq((await paths(page))[0].stroke, '#ff00aa', 'arrow color applied');
  await page.click('#connctl [data-k="width"][data-v="4"]');
  await sleep(page, 200);
  eq((await paths(page))[0].sw, '4', 'arrow thickness applied');
  await page.click('#connctl [data-k="dash"]');
  await sleep(page, 200);
  eq((await paths(page))[0].dash !== null, true, 'dash applied');
  await page.click('#connctl [data-k="arrowStart"]');
  await sleep(page, 200);
  eq((await paths(page))[0].ms !== null, true, 'arrowhead at start applied');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: text color applies to the whole text box', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240); // auto-enters edit mode
  await sleep(page, 250);
  await page.keyboard.type('hello');
  await sleep(page, 150);
  await clickWorld(page, 1000, 600); // blur, but keep the text box selected? click empty clears; reselect instead
  await clickWorld(page, 540, 190); // select the text box
  await sleep(page, 200);
  eq(await barSection(page, 'textctl'), 'contents', 'text controls shown');
  await setColor(page, '#fb-color-input', '#ff0000');
  await sleep(page, 200);
  const fill = (await shapeTexts(page))[0].fill;
  eq(fill, '#ff0000', 'text color applied');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: frame fill, no-fill and border color; style change while editing keeps the editor open', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 140, 140, 340, 290);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 240, 140); // top border: frames are border-selectable only
  await sleep(page, 200);
  const frameRect = () => page.evaluate(() => {
    const r = document.querySelector('#frames rect[data-id]');
    return r ? { fill: r.getAttribute('fill'), stroke: r.getAttribute('stroke') } : null;
  });
  eq((await frameRect()).fill, 'rgba(120,140,180,0.07)', 'default frame fill');
  await setColor(page, '#fb-fill-input', '#00ff00');
  await sleep(page, 200);
  eq((await frameRect()).fill, '#00ff00', 'frame fill applied');
  await page.click('#fb-fill-none');
  await sleep(page, 200);
  eq((await frameRect()).fill, 'none', 'frame no-fill');
  // the "no fill" indicator under the fill swatch is a thick red diagonal, not a hairline
  const barStyle = await page.evaluate(() => {
    const b = document.getElementById('fb-fill-bar');
    const cs = getComputedStyle(b);
    return { bg: cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage, h: cs.height, r: cs.borderRadius, t: cs.transform };
  });
  eq(barStyle.bg, 'rgb(229, 83, 75)', 'no-fill indicator: solid red');
  eq(barStyle.h, '2px', 'no-fill indicator: 2px thick');
  eq(barStyle.r, '1px', 'no-fill indicator: rounded ends');
  // rotate(8deg) = clockwise = top-left to bottom-right; matrix(a,b,...) with b>0
  const m = /matrix\(\s*([-\d.]+),\s*([-\d.]+)/.exec(barStyle.t);
  assert(m && +m[2] > 0, 'no-fill indicator: gently diagonal, top-left to bottom-right');
  eq(await page.evaluate(() => document.querySelector('#fb-fill-none svg path:last-child').getAttribute('stroke-width')), '3', 'red diagonal in the no-fill icon');
  await setColor(page, '#fb-stroke-input', '#0000ff');
  await sleep(page, 200);
  eq((await frameRect()).stroke, '#0000ff', 'frame border color applied');
  // changing the fill of an edited shape must not close the editor (color picker flow)
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 500, 400, 620, 500);
  await sleep(page, 150);
  await dblclickWorld(page, 560, 450);
  await sleep(page, 300);
  await page.keyboard.type('xyz');
  await sleep(page, 150);
  await setColor(page, '#fb-fill-input', '#123456');
  await sleep(page, 200);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'editor stays open through fill change');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: frame border thickness; single selected shape shows resize handle and normal bar', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 140, 140, 340, 290);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 240, 140); // top border: frames are border-selectable only
  await sleep(page, 200);
  await page.click('#stylectl [data-k="width"][data-v="4"]');
  await sleep(page, 200);
  eq(await page.evaluate(() => document.querySelector('#frames rect[data-id]').getAttribute('stroke-width')), '4', 'frame border thickness');
  // single rect: resize handle present, style controls visible, group controls hidden
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 500, 400, 620, 500);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 560, 450);
  await sleep(page, 200);
  eq(await handles(page), 2, 'resize + rotate handles on a single shape');
  eq(await barSection(page, 'stylectl'), 'contents', 'style controls on single shape');
  eq(await barSection(page, 'groupctl'), 'none', 'no group controls on single shape');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: text box gets a visible background/border when styled while editing', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="text"]');
  await dragWorld(page, 440, 140, 640, 240);
  await sleep(page, 200);
  await page.keyboard.type('some text');
  await sleep(page, 150);
  await setColor(page, '#fb-fill-input', '#00ff00');
  await sleep(page, 150);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'editor stays open during fill change');
  await page.click('#stylectl [data-k="width"][data-v="4"]');
  await sleep(page, 150);
  await setColor(page, '#fb-stroke-input', '#ff00ff');
  await sleep(page, 150);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'editor stays open during border change');
  await clickWorld(page, 1000, 600); // blur
  await sleep(page, 300);
  const bg = await page.evaluate(() => {
    const r = document.querySelector('#shapes g[data-id] > rect');
    return r ? { fill: r.getAttribute('fill'), stroke: r.getAttribute('stroke'), sw: r.getAttribute('stroke-width') } : null;
  });
  eq(bg, { fill: '#00ff00', stroke: '#ff00ff', sw: '4' }, 'text box background rect rendered with fill+border');
  // arrow selected: stylectl hidden, connctl shown
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 500, 400, 550);
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 300, 525);
  await sleep(page, 200);
  eq(await barSection(page, 'stylectl'), 'none', 'style controls hidden for arrows');
  eq(await barSection(page, 'connctl'), 'contents', 'connector controls shown for arrows');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: shared color popup with 16 default swatches drives fill, border, text and arrow color', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190);
  await sleep(page, 200);

  const popVisible = () => page.evaluate(() => document.getElementById('colorpop').style.display !== 'none');
  const swatchCount = () => page.evaluate(() => document.querySelectorAll('#colorpop-grid button').length);
  const pick = (c) => page.click(`#colorpop-grid button[data-c="${c}"]`);

  // fill via popup
  await page.click('#fb-fill-btn');
  await sleep(page, 100);
  eq(await popVisible(), true, 'popup opens from the fill swatch');
  eq(await swatchCount(), 32, '32 default swatches');
  eq(await page.evaluate(() => !!document.querySelector('#colorpop-grid button[data-c="#f0e75e"]')), true, 'muted post-it yellow #f0e75e in the palette');
  await pick('#27ae60');
  await sleep(page, 150);
  eq(await popVisible(), false, 'popup closes after picking');
  eq((await rects(page))[0].fill, '#27ae60', 'fill applied from swatch');

  // border via popup
  await page.click('#fb-stroke-btn');
  await sleep(page, 100);
  await pick('#4a6cf7');
  await sleep(page, 150);
  eq((await rects(page))[0].stroke, '#4a6cf7', 'border applied from swatch');

  // text color via popup (whole text, no selection)
  await page.click('#fb-color-btn');
  await sleep(page, 100);
  await pick('#e5534b');
  await sleep(page, 150);
  eq(await page.evaluate(() => document.getElementById('fb-color-bar').style.background), 'rgb(229, 83, 75)', 'text color applied from swatch (bar shows #e5534b)');

  // popup toggles closed when clicking the same swatch again, and closes on outside click
  await page.click('#fb-fill-btn');
  await sleep(page, 100);
  eq(await popVisible(), true, 'popup reopens');
  await page.click('#fb-fill-btn');
  await sleep(page, 100);
  eq(await popVisible(), false, 'same swatch toggles the popup closed');
  await page.click('#fb-fill-btn');
  await sleep(page, 100);
  await page.mouse.click(700, 600); // outside
  await sleep(page, 100);
  eq(await popVisible(), false, 'outside click closes the popup');

  // arrow color via popup
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 400, 140, 520, 240); // B
  await sleep(page, 150);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 200, 190, 460, 190); // A -> B
  await sleep(page, 250);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 330, 190); // midpoint of the arrow
  await sleep(page, 200);
  await page.click('#fb-conn-color-btn');
  await sleep(page, 100);
  eq(await popVisible(), true, 'popup opens from the arrow color swatch');
  await pick('#9b51e0');
  await sleep(page, 150);
  eq((await paths(page))[0].stroke, '#9b51e0', 'arrow color applied from swatch');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('style: "no border" button removes the border (width 0) and marks itself active; thickness buttons restore it', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190);
  await sleep(page, 200);
  eq((await rects(page))[0].sw, 2, 'default border width 2');

  // the no-border button sits left of the thinnest border button
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#stylectl button')].map((b) => b.id || b.dataset.v).join(','));
  assert(order.indexOf('fb-stroke-none') < order.indexOf('1') && order.indexOf('fb-stroke-none') > -1, 'no-border button left of thickness buttons: ' + order);

  await page.click('#fb-stroke-none');
  await sleep(page, 200);
  eq((await rects(page))[0].sw, 0, 'border removed (stroke-width 0)');
  eq(await page.evaluate(() => document.getElementById('fb-stroke-none').classList.contains('active')), true, 'no-border button active');

  await page.click('#stylectl [data-k="width"][data-v="4"]');
  await sleep(page, 200);
  eq((await rects(page))[0].sw, 4, 'thickness button restores a visible border');
  eq(await page.evaluate(() => document.getElementById('fb-stroke-none').classList.contains('active')), false, 'no-border button inactive again');

  // works for frames too
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 400, 300, 600, 450);
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 500, 300); // frame top border
  await sleep(page, 200);
  await page.click('#fb-stroke-none');
  await sleep(page, 200);
  eq(await page.evaluate(() => +document.querySelector('#frames rect[data-id]').getAttribute('stroke-width')), 0, 'frame border removed too');

  eq(errors, [], 'no page errors');
  await page.close();
});
