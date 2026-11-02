// Arrow keys move the whole selection by 10px; Shift+Arrow moves by 1px (fine tune)
import { test, assert, eq, newRoom, sleep, dragWorld, rects } from './harness.mjs';

test('keys: arrow keys move all selected shapes, shift+arrow is fine tune', async () => {
  const { page, errors } = await newRoom();
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 100, 100, 200, 180);
  await dragWorld(page, 300, 100, 400, 180);
  await sleep(page, 150);
  // marquee-select both rects
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 50, 50, 450, 250);
  await sleep(page, 150);
  eq((await rects(page)).length, 2, 'two rects created');
  const before = await rects(page);

  await page.keyboard.press('ArrowRight');
  await sleep(page, 150);
  let after = await rects(page);
  eq(after.map((r) => [r.x, r.y]), before.map((r) => [r.x + 10, r.y]), 'ArrowRight moved both shapes by 10px');

  await page.keyboard.press('Shift+ArrowDown');
  await sleep(page, 150);
  after = await rects(page);
  eq(after.map((r) => [r.x, r.y]), before.map((r) => [r.x + 10, r.y + 1]), 'Shift+ArrowDown fine-tunes by 1px');

  await page.keyboard.press('Shift+ArrowUp'); // -1, undoes the earlier Shift+ArrowDown
  await page.keyboard.press('ArrowLeft'); // -10, undoes the earlier ArrowRight
  await sleep(page, 150);
  after = await rects(page);
  eq(after.map((r) => [r.x, r.y]), before.map((r) => [r.x, r.y]), 'Shift+ArrowUp + ArrowLeft moved back to the start');

  // clicking empty canvas deselects; arrows then do nothing
  await page.mouse.click(60, 700);
  await sleep(page, 150);
  await page.keyboard.press('ArrowRight');
  await sleep(page, 150);
  eq(await rects(page), after, 'arrows with empty selection move nothing');
  eq(errors, [], 'no page errors');
  await page.close();
});
