import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createWeeklyFetcher, weeklyRange, type WeeklyData } from '../src/weekly-data.js';
import { renderWeekly, weeklyHtml } from '../src/render-weekly.js';
import { coopMenu } from './fixtures.js';

const range = weeklyRange('2026-09-20');
const fetcher = createWeeklyFetcher({
  coop: async () => coopMenu,
  dormitory: async date => ({ date: String(date), breakfast: ['우유/시리얼', '셀프토스트&버터/딸기잼', '야채샐러드&소스'], lunch: ['삼겹살구이*상추쌈', '밥/김치'], dinner: ['메밀소바+유부초밥', '콩나물국'] }),
});
for (const kind of ['teacher', 'snack', 'dormitory'] as const) {
  test(`weekly ${kind} renders every cell inside 3:4 pages`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-'));
    try {
      const data = await fetcher(kind, range);
      const result = await renderWeekly(data, dir);
      assert.equal(result.images.length, kind === 'dormitory' ? 2 : 1);
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
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
test('empty weekday/holiday areas and HTML escaping survive rendering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-empty-'));
  try {
    const data = await fetcher('teacher', range);
    data.days.forEach(day => day.sections.forEach(section => { section.items = []; }));
    assert.equal(((await weeklyHtml(data)).match(/메뉴 없음/g) ?? []).length, 15);
    await renderWeekly(data, dir);
    data.days[0]!.sections[0]!.items = ['<script>alert("test")</script>'];
    assert.ok(!(await weeklyHtml(data)).includes('<script>'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('overflow fails before returning publishable images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-overflow-'));
  try {
    const data: WeeklyData = await fetcher('teacher', range);
    data.days[0]!.sections[1]!.items = Array.from({ length: 90 }, () => '메뉴');
    await assert.rejects(renderWeekly(data, dir), /초과/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
