import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createWeeklyFetcher, weeklyRange } from '../src/weekly-data.js';
import { renderWeekly, weeklyHtml } from '../src/render-weekly.js';
import { coopMenu } from './fixtures.js';
import { publishableWeekly } from '../src/weekly-snapshot.js';

const range = weeklyRange('2026-09-20');
const fetcher = createWeeklyFetcher({
  coop: async () => coopMenu,
  badaro: async date => ({ date: String(date), breakfast: ['우유/시리얼'], lunch: ['삼겹살구이*상추쌈'], dinner: ['메밀소바+유부초밥'] }),
  dormitory: async date => ({ date: String(date), breakfast: ['우유/시리얼', '셀프토스트&버터/딸기잼', '야채샐러드&소스'], lunch: ['삼겹살구이*상추쌈', '밥/김치'], dinner: ['메밀소바+유부초밥', '콩나물국'] }),
});
for (const kind of ['combined', 'badaro', 'dormitory'] as const) {
  test(`weekly ${kind} renders every cell inside 3:4 pages`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-'));
    try {
      const data = await fetcher(kind, range);
      const result = await renderWeekly(data, dir);
      assert.equal(result.images.length, 2);
      if (kind === 'combined') {
        assert.match(result.images[0]!, /snack-weekly.jpg$/);
        assert.match(result.images[1]!, /teacher-weekly.jpg$/);
        assert.equal(result.master, undefined);
      }
      for (const path of result.images) {
        const meta = await sharp(path).metadata();
        assert.equal(meta.width, 1080); assert.equal(meta.height, 1440);
      }
      if (result.master) {
        const meta = await sharp(result.master).metadata();
        assert.equal(meta.width, 2160); assert.equal(meta.height, 1440);
        // Both files must come from exact halves of the same master, not independent renders.
        for (const [index, path] of result.images.entries()) {
          const expected = await sharp(result.master).extract({ left: index * 1080, top: 0, width: 1080, height: 1440 }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
          assert.deepEqual(await readFile(path), expected);
        }
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 2160, height: 1440 } });
          await page.setContent(await readFile(join(dir, `${range.week}-${kind}-weekly.html`), 'utf8'));
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const layout = await page.evaluate(() => {
            const days = [...document.querySelectorAll('.day')];
            const geometry = days.map(day => ({
              width: day.getBoundingClientRect().width,
              headings: [...day.querySelectorAll('h2')].map(node => node.textContent),
              fonts: [...day.querySelectorAll('.menu')].map(node => getComputedStyle(node).fontSize),
              menus: day.querySelectorAll('.menu').length,
            }));
            const title = document.querySelector('h1')!.getBoundingClientRect();
            const range = document.querySelector('.range')!.getBoundingClientRect();
            const crossesCenter = [...days[3]!.querySelectorAll('.menu p')].some(node => {
              const text = document.createRange(); text.selectNodeContents(node);
              return [...text.getClientRects()].some(rect => rect.left < 1080 && rect.right > 1080);
            });
            return { geometry, crossesCenter, titleTop: title.top, titleRight: title.right, titleBottom: title.bottom, titleLeft: title.left, rangeTop: range.top, rangeLeft: range.left, rangeRight: range.right, rangeAlign: getComputedStyle(document.querySelector('.range')!).textAlign, titleSize: getComputedStyle(document.querySelector('h1')!).fontSize };
          });
          assert.equal(layout.geometry.length, 7);
          for (const day of layout.geometry) {
            const first = layout.geometry[0]!;
            assert.ok(Math.abs(day.width - first.width) < 1, 'columns differ only by subpixel rounding');
            assert.deepEqual({ ...day, width: first.width }, first);
          }
          assert.equal(layout.crossesCenter, true, 'Thursday menu must not avoid the center crop');
          assert.equal(layout.rangeAlign, 'left');
          assert.equal(layout.titleSize, '72px');
          assert.ok(layout.rangeRight <= 1080);
          assert.ok(Math.abs(layout.rangeTop - layout.titleTop) <= 1);
          assert.ok(Math.abs(layout.rangeLeft - layout.titleRight - 24) <= 1);
        } finally { await browser.close(); }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
test('empty weekday/holiday areas and HTML escaping survive rendering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-empty-'));
  try {
    const data = await fetcher('combined', range);
    const page = data.pages[1]!;
    page.days.forEach(day => day.sections.forEach(section => { section.items = []; }));
    assert.equal(((await weeklyHtml(page)).match(/등록된 식단 없음/g) ?? []).length, 15);
    await renderWeekly(data, dir);
    page.days[0]!.sections[0]!.items = ['<script>alert("test")</script>'];
    assert.ok(!(await weeklyHtml(page)).includes('<script>'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('one available restaurant renders a single combined feed image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-single-'));
  try {
    const data = await fetcher('combined', range);
    data.pages[1]!.days.forEach(day => day.sections.forEach(section => { section.items = []; }));
    const prepared = publishableWeekly(data)!;
    assert.deepEqual(prepared.pages.map(page => page.kind), ['snack']);
    assert.match(prepared.caption, /학식 식단/);
    assert.doesNotMatch(prepared.caption, /교직원/);
    const rendered = await renderWeekly(prepared, dir);
    assert.equal(rendered.images.length, 1);
    assert.match(rendered.images[0]!, /snack-weekly.jpg$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('괄호 안 날짜 범위와 닫는 괄호는 한 줄 단위로 유지한다', async () => {
  const data = await fetcher('badaro', range);
  data.pages[0]!.days[0]!.sections[0]!.items = ['추석연휴(9/24~27)'];
  const html = await weeklyHtml(data.pages[0]!);
  assert.match(html, /추석연휴<span class="no-break">\(9\/24~27\)<\/span>/);
  assert.doesNotMatch(html, /<wbr>\)/);
});
test('overflow fails before returning publishable images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-overflow-'));
  try {
    const data = await fetcher('combined', range);
    data.pages[1]!.days[0]!.sections[1]!.items = Array.from({ length: 90 }, () => '메뉴');
    await assert.rejects(renderWeekly(data, dir), /초과/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('compact ranges and update notices fit within the first panorama image', async () => {
  const data = await fetcher('dormitory', range);
  const html = await weeklyHtml(data.pages[0]!, '2026-09-23');
  assert.match(html, /9\/21 ~ 9\/27/);
  assert.match(html, /9\/23\(수\)에 식단표 변경됨/);
  assert.doesNotMatch(await weeklyHtml(data.pages[0]!), /식단표 변경됨/);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2160, height: 1440 } });
    await page.setContent(html);
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return { notice: rect('.update-notice'), calendar: rect('.calendar'), range: rect('.range'), title: rect('h1') };
    });
    assert.ok(boxes.notice.right < 1080 && boxes.notice.left >= 0);
    assert.ok(boxes.notice.top >= boxes.title.bottom);
    assert.equal(boxes.notice.left, boxes.title.left);
    assert.ok(boxes.notice.bottom < boxes.calendar.top);
    assert.doesNotMatch(html, /@kmou_meal|<footer/);
    assert.equal(boxes.calendar.left, 24);
    assert.equal(2160 - boxes.calendar.right, 24);
    assert.equal(1440 - boxes.calendar.bottom, 24);
    assert.ok(boxes.range.bottom < boxes.calendar.top);
    assert.ok(boxes.title.right < 1080);
  } finally { await browser.close(); }
});
