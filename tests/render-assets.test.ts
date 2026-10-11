import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { storyHtml } from '../src/render-story.js';
import { weeklyHtml } from '../src/render-weekly.js';
import { storyDesignData } from './fixtures/story-design.js';
import { designKinds, weeklyDesignData } from './fixtures/weekly-design.js';

test('solid backgrounds and bundled fonts render offline from another working directory, including in Actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-offline-assets-'));
  const cwd = process.cwd();
  const browser = await chromium.launch({ headless: true });
  try {
    process.chdir(directory);
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const externalRequests: string[] = [];
    page.on('request', request => {
      if (/^(https?|file):/u.test(request.url())) externalRequests.push(request.url());
    });
    for (const kind of designKinds) for (const format of ['weekly', 'story'] as const) {
      const html = format === 'story' ? await storyHtml(storyDesignData(kind)) : await weeklyHtml(weeklyDesignData(kind).pages[0]!);
      assert.ok(!html.includes('data:image/') && !html.includes('backgrounds/'), `${kind} ${format}: no background image dependency`);
      assert.ok(!html.includes('/Downloads/') && !html.includes('file://'));
      await page.setContent(html, { waitUntil: 'load' });
      const assets = await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.fonts].map(font => font.load()));
        const main = getComputedStyle(document.querySelector('main')!);
        return { backgroundImage: main.backgroundImage, backgroundColor: main.backgroundColor,
          fontsLoaded: [...document.fonts].every(font => font.status === 'loaded') };
      });
      assert.equal(assets.backgroundImage, 'none');
      assert.equal(assets.backgroundColor, 'rgb(246, 248, 251)');
      assert.equal(assets.fontsLoaded, true);
    }
    assert.deepEqual(externalRequests, []);
  } finally {
    process.chdir(cwd);
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
