// Top-bar name input: Enter commits the new name (localStorage + awareness) and unfocuses.
import { test, assert, eq, newRoom, sleep } from './harness.mjs';

test('name input: Enter saves the name and blurs the input', async () => {
  const { page, errors } = await newRoom();
  const input = await page.$('#name');
  assert(input, 'name input exists');
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Marcel');
  await page.keyboard.press('Enter');
  await sleep(page, 150);
  eq(await page.evaluate(() => localStorage.getItem('wb-name')), 'Marcel', 'name saved');
  eq(await page.evaluate(() => document.activeElement === document.getElementById('name')), false, 'input unfocused after Enter');
  // the change event must not fire again on blur and clobber anything
  eq(await page.evaluate(() => localStorage.getItem('wb-name')), 'Marcel', 'name unchanged after blur');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('name input: clicking elsewhere (canvas) commits and unfocuses', async () => {
  const { page, errors } = await newRoom();
  await page.click('#name');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('ClickAway');
  // click on the canvas (its pointerdown preventDefault would normally block the blur)
  await page.mouse.click(700, 400);
  await sleep(page, 150);
  eq(await page.evaluate(() => localStorage.getItem('wb-name')), 'ClickAway', 'name committed by outside click');
  eq(await page.evaluate(() => document.activeElement === document.getElementById('name')), false, 'input unfocused after outside click');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('board title: clicking elsewhere on the page saves and unfocuses the rename input', async () => {
  const { page, errors } = await newRoom();
  await page.click('#title');
  const input = await page.$('#title-input');
  assert(input, 'title rename input opened');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('My Board');
  // click on the canvas (its pointerdown preventDefault would normally block the blur)
  await page.mouse.click(700, 400);
  await sleep(page, 150);
  eq(await page.evaluate(() => document.getElementById('title').textContent), 'My Board', 'title saved by outside click');
  eq(await page.evaluate(() => !!document.getElementById('title-input')), false, 'rename input closed after outside click');
  eq(await page.evaluate(() => document.activeElement === document.getElementById('title-input')), false, 'input unfocused after outside click');
  eq(errors, [], 'no page errors');
  await page.close();
});

test('name input: empty Enter keeps the old name', async () => {
  const { page, errors } = await newRoom();
  const before = await page.evaluate(() => localStorage.getItem('wb-name'));
  await page.click('#name');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
  await sleep(page, 150);
  eq(await page.evaluate(() => localStorage.getItem('wb-name')), before, 'empty name falls back to the old one');
  eq(errors, [], 'no page errors');
  await page.close();
});
