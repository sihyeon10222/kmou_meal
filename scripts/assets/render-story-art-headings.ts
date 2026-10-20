import { frontendAsset } from '../../src/backend/config/paths.js';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { loadFontCss } from '../../src/backend/rendering/assets.js';

// Bake the same rounded, bundled font used by the Story pills into transparent headings.
// Runtime composition then needs no installed fonts or fontconfig, including on Actions.
const directory = frontendAsset('illustrations/');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 160 }, deviceScaleFactor: 3 });
  for (const meal of ['lunch', 'dinner'] as const) {
    const title = meal === 'lunch' ? 'Lunch' : 'Dinner';
    await page.setContent(`<style>${await loadFontCss()}body{margin:0;background:transparent}.title{display:inline-block;font:700 48px/1.5 Meal;color:#103D82;white-space:nowrap}</style><span class="title">${title}</span>`);
    await page.evaluate(() => document.fonts.ready);
    const image = await page.locator('.title').screenshot({ omitBackground: true });
    await sharp(image).trim().resize(148, 40, { fit: 'inside' }).png().toFile(fileURLToPath(new URL(`story-${meal}-heading.png`, directory)));
  }
} finally { await browser.close(); }
