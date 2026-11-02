// Frames are selectable only on their border band, never their interior area.
import { newRoom, test, assert, eq, sleep, dragWorld, clickWorld, dblclickWorld, selBoxes } from './harness.mjs';

const selBoxRect = (page) => page.evaluate(() => {
  const r = document.querySelector('#selection .sel-box');
  return r ? { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') } : null;
});

async function makeFrame(page) {
  await page.click('button[data-tool="frame"]');
  await dragWorld(page, 140, 140, 340, 290); // frame spans (140,140)-(340,290)
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);
}

test('frames: interior click does not select, border clicks do', async () => {
  const { page, errors } = await newRoom();
  await makeFrame(page);

  await clickWorld(page, 240, 215); // dead center of the frame
  await sleep(page, 150);
  eq(await selBoxes(page), 0, 'interior click selects nothing');

  for (const [x, y] of [[240, 140], [340, 215], [240, 290], [140, 215]]) { // top/right/bottom/left border
    await clickWorld(page, x, y);
    await sleep(page, 450); // >400ms so consecutive clicks don't trigger double-click-to-edit
    eq(await selBoxes(page), 1, `border click at ${x},${y} selects the frame`);
  }
  eq(await selBoxRect(page), { x: 137, y: 137, w: 206, h: 156 }, 'selected box is the frame bounds');

  await clickWorld(page, 240, 160); // inside, 20px below the top border (beyond the hit band)
  await sleep(page, 150);
  eq(await selBoxes(page), 0, 'click just inside the border does not select');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('frames: clicking the label selects, double-clicking it opens renaming', async () => {
  const { page, errors } = await newRoom();
  await makeFrame(page);

  // the label "Frame" is rendered at (148, 160) baseline, font 14 — click inside the text
  await clickWorld(page, 160, 156);
  await sleep(page, 450);
  eq(await selBoxes(page), 1, 'label click selects the frame');

  await dblclickWorld(page, 160, 156);
  await sleep(page, 300);
  eq(await page.evaluate(() => !!document.querySelector('.wb-editing')), true, 'double-click on the label opens the name editor');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('frames: shapes inside the frame remain clickable through its interior', async () => {
  const { page, errors } = await newRoom();
  await makeFrame(page);
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 180, 170, 260, 230); // rect fully inside the frame
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await sleep(page, 100);

  await clickWorld(page, 220, 200); // center of the inner rect, deep inside the frame
  await sleep(page, 150);
  eq(await selBoxes(page), 1, 'inner shape is selected');
  eq(await selBoxRect(page), { x: 177, y: 167, w: 86, h: 66 }, 'selected box is the inner rect, not the frame');

  eq(errors, [], 'no page errors');
  await page.close();
});

test('frames: marquee selects the frame only when crossing its border', async () => {
  const { page, errors } = await newRoom();
  await makeFrame(page);

  // marquee fully inside the frame interior: no border crossed
  await dragWorld(page, 180, 170, 300, 260);
  await sleep(page, 150);
  eq(await selBoxes(page), 0, 'marquee inside the frame selects nothing');

  // marquee crossing the right border
  await dragWorld(page, 300, 200, 400, 250);
  await sleep(page, 150);
  eq(await selBoxes(page), 1, 'marquee crossing the border selects the frame');
  eq(await selBoxRect(page), { x: 137, y: 137, w: 206, h: 156 }, 'selected box is the frame bounds');

  // marquee fully containing the frame also selects it (all four borders crossed)
  await dragWorld(page, 100, 100, 400, 340);
  await sleep(page, 150);
  eq(await selBoxes(page), 1, 'marquee around the frame selects it');

  eq(errors, [], 'no page errors');
  await page.close();
});
