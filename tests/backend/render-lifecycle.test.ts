import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createRenderBrowser } from '../../src/backend/rendering/browser.js';
import { createWeeklyRenderer } from '../../src/backend/rendering/weekly-renderer.js';
import { createStoryRenderer } from '../../src/backend/rendering/story-renderer.js';
import { weeklyDesignData } from '../../fixtures/design/weekly-design.js';
import { storyDesignData } from '../../fixtures/design/story-design.js';

test('weekly batch reuses one browser and releases each context after both success and overflow', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-render-lifecycle-'));
  const launch = chromium.launch.bind(chromium);
  const browsers: Browser[] = [];
  t.mock.method(chromium, 'launch', async () => {
    const browser = await launch({ headless: true });
    browsers.push(browser);
    return browser;
  });
  const renderer = createWeeklyRenderer();
  try {
    assert.equal(browsers.length, 0);
    const combined = weeklyDesignData('snack');
    combined.pages.push(weeklyDesignData('teacher').pages[0]!);
    assert.equal((await renderer.render(combined, directory)).images.length, 2);
    assert.equal(browsers.length, 1);
    assert.equal(browsers[0]!.contexts().length, 0);
    const overflow = weeklyDesignData('teacher');
    overflow.pages[0]!.days[0]!.sections[0]!.items = Array(300).fill('밥');
    await assert.rejects(renderer.render(overflow, directory), /초과/);
    assert.equal(browsers[0]!.contexts().length, 0);
    const next = await renderer.render(weeklyDesignData('badaro'), directory);
    assert.equal(next.images.length, 2);
    assert.ok(next.master);
    assert.equal(browsers.length, 1);
    assert.equal(browsers[0]!.contexts().length, 0);
  } finally {
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(browsers[0]!.isConnected(), false);
  await renderer.close();
  await assert.rejects(renderer.render(weeklyDesignData('snack'), directory), /종료/);
});

test('undecorated Stories capture only the final JPEG and close their page context', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-story-capture-'));
  const launch = chromium.launch.bind(chromium);
  const types: (string | undefined)[] = [];
  let browser: Browser | undefined;
  t.mock.method(chromium, 'launch', async () => {
    browser = await launch({ headless: true });
    const newPage = browser.newPage.bind(browser);
    t.mock.method(browser, 'newPage', async (...args: Parameters<Browser['newPage']>) => {
      const page = await newPage(...args);
      const screenshot = page.screenshot.bind(page);
      t.mock.method(page, 'screenshot', async (options: Parameters<typeof screenshot>[0]) => {
        types.push(options?.type);
        return screenshot(options);
      });
      return page;
    });
    return browser;
  });
  const renderer = createStoryRenderer();
  try {
    await renderer.render(storyDesignData('dormitory'), directory);
    assert.deepEqual(types, ['jpeg']);
    assert.equal(browser!.contexts().length, 0);
  } finally {
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(browser!.isConnected(), false);
});

test('browser startup failure can recover; closing an unused renderer never launches Chromium', async t => {
  const launch = chromium.launch.bind(chromium);
  let attempts = 0;
  t.mock.method(chromium, 'launch', async () => {
    if (++attempts === 1) throw new Error('startup failed');
    return launch({ headless: true });
  });
  await createRenderBrowser('Unused').close();
  assert.equal(attempts, 0);
  const renderer = createRenderBrowser('Test');
  try {
    await assert.rejects(renderer.newPage({}), /startup failed/);
    const page = await renderer.newPage({});
    const browser = page.context().browser()!;
    await page.close();
    assert.equal(attempts, 2);
    await browser.close();
    // A crashed/disconnected browser must not poison later images in the batch.
    const recovered = await renderer.newPage({});
    await recovered.close();
    assert.equal(attempts, 3);
  } finally { await renderer.close(); }
  await assert.rejects(renderer.newPage({}), /종료/);
});

test('closing during startup waits for and closes the browser once without opening a page', async t => {
  let release!: (browser: Browser) => void;
  const pending = new Promise<Browser>(resolve => { release = resolve; });
  t.mock.method(chromium, 'launch', () => pending);
  let closes = 0, pages = 0;
  const browser = {
    once: () => {},
    close: async () => { closes++; },
    newPage: async () => { pages++; throw new Error('unexpected page'); },
  } as unknown as Browser;
  const renderer = createRenderBrowser('Test');
  const opening = renderer.newPage({});
  const rejected = assert.rejects(opening, /종료/);
  const closing = renderer.close();
  assert.equal(renderer.close(), closing);
  release(browser);
  await Promise.all([rejected, closing]);
  assert.equal(closes, 1);
  assert.equal(pages, 0);
});
