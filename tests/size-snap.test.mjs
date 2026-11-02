// Size snap: resizing a shape snaps its width/height to another on-screen shape's
// width/height (within 4 screen px) and shows a dotted inner line inside both shapes.
import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, guides, w2s } from './harness.mjs';

async function twoRects() {
  const r = await newRoom();
  const { page } = r;
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 140, 140, 260, 240); // A 120x100 at (140,140)
  await dragWorld(page, 400, 300, 500, 380); // B 100x80 at (400,300)
  await sleep(page, 200);
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select A
  await sleep(page, 150);
  return r;
}

test('size-snap: se resize snaps width to another shape and shows inner dotted lines in both', async () => {
  const { page, errors } = await twoRects();
  // drag A's se handle (260,240) to (238,230): w=98 -> within 4 of B.w=100 -> snap to 100
  const a = await w2s(page, 260, 240);
  const b = await w2s(page, 238, 230);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq((await rects(page))[0].w, 100, 'A width snapped to B width');
  // width match -> horizontal dotted line through the vertical center of both shapes
  // A is now {140,140,100,90} -> H@185; B is {400,300,100,80} -> H@340
  const g = (await guides(page)).sort();
  eq(g, ['H@185', 'H@340'], 'inner dotted lines through the centers of A and B');
  await page.mouse.up();
  await sleep(page, 200);
  eq(await guides(page), [], 'guides removed after drop');
  eq((await rects(page))[0].w, 100, 'width stays snapped after drop');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('size-snap: border resize snaps height to another shape without touching width', async () => {
  const { page, errors } = await twoRects();
  // drag A's bottom border midpoint (200,240) up to (200,218): h=78 -> within 4 of B.h=80 -> snap to 80
  const a = await w2s(page, 200, 240);
  const b = await w2s(page, 200, 218);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  const r = (await rects(page))[0];
  eq(r.h, 80, 'A height snapped to B height');
  eq(r.w, 120, 'width untouched by bottom-border drag');
  // height match -> vertical dotted line through the horizontal center of both shapes
  // A is now {140,140,120,80} -> V@200; B is {400,300,100,80} -> V@450
  const g = (await guides(page)).sort();
  eq(g, ['V@200', 'V@450'], 'inner dotted lines through the centers of A and B');
  await page.mouse.up();
  await sleep(page, 200);
  eq(await guides(page), [], 'guides removed after drop');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('size-snap: no snap when sizes differ by more than 4px', async () => {
  const { page, errors } = await twoRects();
  // drag se handle to (300,240): w=160 (B.w=100, diff 60), h=100 (B.h=80, diff 20) -> no size snap;
  // right edge 300 is far from B's edges -> no edge snap either
  const a = await w2s(page, 260, 240);
  const b = await w2s(page, 300, 240);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(page, 150);
  eq((await rects(page))[0].w, 160, 'no snap, width is raw 160');
  eq(await guides(page), [], 'no guides');
  await page.mouse.up();
  await sleep(page, 200);
  eq(errors, [], 'no page errors');
  await page.close();
});
