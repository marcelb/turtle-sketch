import { test, assert, eq, newRoom, sleep, dragWorld, clickWorld, rects, selBoxes, handles, barSection, paths } from './harness.mjs';

async function twoRects() {
  const r = await newRoom();
  await r.page.click('button[data-tool="rect"]');
  await dragWorld(r.page, 140, 140, 260, 240); // A
  await dragWorld(r.page, 340, 140, 460, 240); // B
  await sleep(r.page, 200);
  return r;
}

test('groups: Ctrl+G groups, member click selects the group, drag moves all members', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280); // marquee both
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'both selected');
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'one selection box for the group');
  eq(await handles(page), 0, 'groups have no resize handle');
  eq(await barSection(page, 'groupctl'), 'contents', 'group controls shown');
  // clicking a member selects the group
  await clickWorld(page, 200, 190);
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'member click selects the group');
  // dragging the group moves both members
  await dragWorld(page, 200, 190, 250, 240);
  await sleep(page, 200);
  const rs = await rects(page);
  eq(rs.map((r) => [r.x, r.y]), [[190, 190], [390, 190]], 'both members moved by (50,50)');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: ungroup restores individual selection, delete removes members recursively', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 200);
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await page.keyboard.press('Control+Shift+g');
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'ungroup one level restores both');
  // re-group and delete: members are gone too
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await page.keyboard.press('Delete');
  await sleep(page, 200);
  eq((await rects(page)).length, 0, 'deleting the group deletes the members');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: arrows never dock to the group itself but members stay dockable', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await page.click('button[data-tool="arrow"]');
  // into the group's empty gap (world 300,190): nearest member border is 40px away -> free end
  await dragWorld(page, 640, 140, 300, 190);
  await sleep(page, 300);
  eq((await paths(page)).map((p) => p.d), ['M 640 140 L 300 190'], 'no dock to the group');
  // onto member A (inside it): docks to the member border (start away from the first arrow)
  await dragWorld(page, 700, 100, 200, 190);
  await sleep(page, 300);
  const all = await paths(page);
  eq(all.length, 2, 'second arrow created');
  const d2 = all[1].d;
  assert(d2.endsWith('L 140 190') || d2.endsWith('L 260 190'), `docked to member border, got ${d2}`);
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: click on empty area inside group bounds selects the group', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 200);
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await clickWorld(page, 300, 190); // empty gap between A(140-260) and B(340-460), inside group bounds
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'group selected via empty area inside its bounds');
  eq(await barSection(page, 'groupctl'), 'contents', 'group controls shown');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: nested groups move recursively and ungroup one level at a time', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+g'); // G1 = [A,B]
  await sleep(page, 200);
  await page.click('button[data-tool="rect"]');
  await dragWorld(page, 640, 340, 760, 440); // C
  await sleep(page, 150);
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 800, 500); // marquee G1 + C
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'group + rect selected');
  await page.click('#fb-group'); // G2 = [G1, C]
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'one box for the nested group');
  eq(await handles(page), 0, 'no resize handle on nested group');
  await dragWorld(page, 200, 190, 250, 240); // move G2 by (50,50) from inside A
  await sleep(page, 200);
  eq((await rects(page)).map((r) => [r.x, r.y]), [[190, 190], [390, 190], [690, 390]], 'all members moved recursively');
  await page.keyboard.press('Control+Shift+g'); // ungroup G2 -> [G1, C]
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'ungroup one level: G1 and C');
  await clickWorld(page, 1000, 600); // clear the multi-selection first
  await sleep(page, 150);
  await clickWorld(page, 240, 240); // inside A (now at 190,190) -> selects G1
  await sleep(page, 150);
  eq(await selBoxes(page), 1, 'member click selects the inner group');
  await page.keyboard.press('Control+Shift+g'); // ungroup G1 -> [A, B]
  await sleep(page, 200);
  eq(await selBoxes(page), 2, 'inner group ungrouped to A and B');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: deleting a group removes members and arrows docked to them', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await dragWorld(page, 100, 100, 500, 280);
  await sleep(page, 150);
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  await page.click('button[data-tool="arrow"]');
  await dragWorld(page, 700, 100, 200, 190); // arrow onto member A
  await sleep(page, 300);
  eq((await paths(page)).length, 1, 'arrow exists');
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // select the group via member
  await sleep(page, 150);
  await page.keyboard.press('Delete');
  await sleep(page, 200);
  eq((await rects(page)).length, 0, 'members deleted');
  eq((await paths(page)).length, 0, 'docked arrow deleted with the group');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('groups: click + shift-click multi-select, then Ctrl+G groups', async () => {
  const { page, errors } = await twoRects();
  await page.click('button[data-tool="select"]');
  await clickWorld(page, 200, 190); // A
  await sleep(page, 150);
  await page.keyboard.down('Shift');
  await clickWorld(page, 400, 190); // B
  await page.keyboard.up('Shift');
  await sleep(page, 150);
  eq(await selBoxes(page), 2, 'click + shift-click selects both');
  await page.keyboard.press('Control+g');
  await sleep(page, 200);
  eq(await selBoxes(page), 1, 'grouped into one');
  eq(await barSection(page, 'groupctl'), 'contents', 'group controls shown');
  eq(errors, [], 'no page errors');
  await page.close();
});
