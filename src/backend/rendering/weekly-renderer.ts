import { buildWeeklyHtml, type WeeklyTemplateAssets } from '../../frontend/weekly/html.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRenderBrowser } from './browser.js';
import { readTemplate, loadFontCss } from './assets.js';
import { layoutWeekly } from '../../frontend/weekly/layout.js';
import type { WeeklyData, WeeklyPage, WeeklyImages } from '../../shared/contracts/weekly.js';

import sharp from 'sharp';

async function loadWeeklyAssets(): Promise<WeeklyTemplateAssets> {
  const [css, font, design] = await Promise.all([
    readTemplate('weekly.css'), loadFontCss(), readTemplate('design.css'),
  ]);
  return { css, font, design };
}

export async function weeklyHtml(data: WeeklyPage, updatedOn?: string, menuChanges?: WeeklyData['menuChanges'], updatedKinds?: WeeklyData['updatedKinds']): Promise<string> {
  return buildWeeklyHtml(data, await loadWeeklyAssets(), updatedOn, menuChanges, updatedKinds);
}

export async function renderWeekly(data: WeeklyData, outputDir = 'output'): Promise<WeeklyImages> {
  const renderer = createWeeklyRenderer();
  try { return await renderer.render(data, outputDir); }
  finally { await renderer.close(); }
}

/** Share Chromium across feed kinds while keeping page state and failures isolated. */
export function createWeeklyRenderer() {
  const browser = createRenderBrowser('Weekly');
  let assets: Promise<WeeklyTemplateAssets> | undefined;
  let closed = false;
  return {
    async render(data: WeeklyData, outputDir = 'output'): Promise<WeeklyImages> {
      if (closed) throw new Error('Weekly 렌더러가 이미 종료되었습니다.');
      const images: string[] = [];
      let master: string | undefined;
      for (const page of data.pages) {
        const rendered = await renderWeeklyPage(browser, await (assets ??= loadWeeklyAssets()), page, data.week, outputDir, data.updatedOn, data.menuChanges, data.updatedKinds);
        images.push(...rendered.images);
        master = rendered.master ?? master;
      }
      return { images, ...(master ? { master } : {}) };
    },
    async close() { closed = true; await browser.close(); },
  };
}

async function renderWeeklyPage(browser: ReturnType<typeof createRenderBrowser>, assets: WeeklyTemplateAssets, data: WeeklyPage, week: string, outputDir: string, updatedOn?: string, menuChanges?: WeeklyData['menuChanges'], updatedKinds?: WeeklyData['updatedKinds']): Promise<WeeklyImages> {
  await mkdir(outputDir, { recursive: true });
  const stem = resolve(outputDir, `${week}-${data.kind}-weekly`);
  const panorama = data.kind === 'dormitory' || data.kind === 'badaro';
  const page = await browser.newPage({ viewport: { width: panorama ? 2160 : 1080, height: 1440 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(buildWeeklyHtml(data, assets, updatedOn, menuChanges, updatedKinds), { waitUntil: 'load' });
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    await page.evaluate(layoutWeekly);
    await writeFile(`${stem}.html`, await page.content());
    await writeFile(`${stem}.menu.json`, JSON.stringify(data, null, 2));
    // Render the complete design before cropping. The center may cut through
    // Thursday's text intentionally; no layout element adapts to the crop line.
    const bytes = await page.screenshot({ type: 'png' });
    if (!panorama) {
      const image = `${stem}.jpg`;
      await sharp(bytes).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(image);
      return { images: [image] };
    }
    const master = `${stem}-master.png`;
    await writeFile(master, bytes);
    const images: string[] = [];
    for (let index = 0; index < 2; index++) {
      const image = `${stem}-${index + 1}.jpg`;
      await sharp(bytes).extract({ left: index * 1080, top: 0, width: 1080, height: 1440 }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(image);
      images.push(image);
    }
    return { images, master };
  } finally { await page.close(); }
}
