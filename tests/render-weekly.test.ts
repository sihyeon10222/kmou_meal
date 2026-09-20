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
            return { geometry, crossesCenter, titleBottom: title.bottom, titleLeft: title.left, rangeTop: range.top, rangeLeft: range.left };
          });
          assert.equal(layout.geometry.length, 7);
          for (const day of layout.geometry) assert.deepEqual(day, layout.geometry[0]);
          assert.equal(layout.crossesCenter, true, 'Thursday menu must not avoid the center crop');
          assert.equal(layout.rangeLeft, layout.titleLeft);
          assert.ok(layout.rangeTop >= layout.titleBottom);
          assert.ok(layout.rangeTop - layout.titleBottom < 20);
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
    assert.equal(((await weeklyHtml(page)).match(/메뉴 없음/g) ?? []).length, 15);
    await renderWeekly(data, dir);
    page.days[0]!.sections[0]!.items = ['<script>alert("test")</script>'];
    assert.ok(!(await weeklyHtml(page)).includes('<script>'));
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
