import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import * as weekly from '../src/render-weekly.js';
import { createStoryRenderer } from '../src/render-story.js';
import { createResidenceMenuFetcher } from '../src/fetch-menu.js';
import { storyDesignData } from '../tests/fixtures/story-design.js';
import { weeklyDesignData } from '../tests/fixtures/weekly-design.js';
// Fixed fixtures only: no school, Storage, Instagram or AI requests.
// One warm-up followed by five measured sequential batches.
const label = process.argv[2] ?? 'current';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Benchmark label: letters, digits, _ or -');
const root = resolve('output/benchmark', label);
await mkdir(root, { recursive: true });
const samples = { weekly: [] as number[], story: [] as number[], menus: [] as number[] };
const counts = { launches: 0, png: 0, jpeg: 0 };
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  counts.launches++;
  const browser = await launch(...args);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...pageArgs) => {
    const page = await newPage(...pageArgs);
    const screenshot = page.screenshot.bind(page);
    page.screenshot = async options => {
      counts[options?.type === 'jpeg' ? 'jpeg' : 'png']++;
      return screenshot(options);
    };
    return page;
  };
  return browser;
};
const hashes: Record<string, string> = {};
const digest = async (file: string) => { hashes[file.slice(root.length + 1)] = createHash('sha256').update(await readFile(file)).digest('hex'); };
const combined = weeklyDesignData('snack');
combined.pages.push(weeklyDesignData('teacher').pages[0]!);
for (let round = 0; round < 6; round++) {
  const out = resolve(root, String(round));
  // The fallback also lets this script measure revisions predating browser reuse.
  const factory = (weekly as typeof weekly & { createWeeklyRenderer?: () => { render: typeof weekly.renderWeekly; close(): Promise<void> } }).createWeeklyRenderer;
  const renderer = factory ? factory() : { render: weekly.renderWeekly, close: async () => {} };
  let start = performance.now();
  try {
    for (const data of [combined, weeklyDesignData('badaro'), weeklyDesignData('dormitory')]) {
      const result = await renderer.render(data, out);
      for (const file of [...result.images, ...(result.master ? [result.master] : [])]) await digest(file);
    }
  } finally { await renderer.close(); }
  if (round) samples.weekly.push(performance.now() - start);
  const stories = createStoryRenderer();
  start = performance.now();
  try {
    for (const kind of ['dormitory', 'badaro', 'snack', 'teacher'] as const) await digest(await stories.render(storyDesignData(kind), out));
  } finally { await stories.close(); }
  if (round) samples.story.push(performance.now() - start);
}
const originalFetch = globalThis.fetch;
const rows = Array.from({ length: 31 }, (_, day) => Array.from({ length: 3 }, (_, version) => ({
  dietDate: `2026/10/${String(day + 1).padStart(2, '0')}`, dietSeq: day * 3 + version,
  dietAditCn1: version === 0 ? ' 밥\r\n국\n김치 ' : null,
  dietAditCn2: version === 1 ? ' 점심\n밥\n반찬 ' : '', dietAditCn3: version === 2 ? ' 저녁\n밥\n반찬 ' : null,
}))).flat();
const body = JSON.stringify(rows);
globalThis.fetch = async () => new Response(body);
try {
  for (let round = 0; round < 6; round++) {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      const fetcher = createResidenceMenuFetcher('dorm');
      for (let day = 5; day <= 11; day++) await fetcher(`2026-10-${String(day).padStart(2, '0')}`);
    }
    if (round) samples.menus.push(performance.now() - start);
  }
} finally { globalThis.fetch = originalFetch; }
const medians = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [...values].sort((a, b) => a - b)[2]]));
const report = { label, node: process.version, platform: `${process.platform}/${process.arch}`, samples, medians, counts, hashes };
await writeFile(resolve(root, 'results.json'), JSON.stringify(report, null, 2));
const comparison = process.argv[3];
if (comparison) {
  const before = JSON.parse(await readFile(comparison, 'utf8')) as { hashes: Record<string, string> };
  assert.deepEqual(hashes, before.hashes, 'Rendered image bytes changed');
  console.log(`Identical image SHA-256 hashes: ${Object.keys(hashes).length}`);
}
console.log(JSON.stringify({ label, medians, counts }));
