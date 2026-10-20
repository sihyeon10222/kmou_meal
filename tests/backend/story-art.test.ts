import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createFoodAi, cloudflareConfig, FOOD_IMAGE_MODEL, FOOD_SELECTION_MODEL } from '../../src/backend/integrations/cloudflare/food-ai.js';
import { artMenus, createStoryArt, validateSelection, foodPrompt } from '../../src/backend/rendering/art/decorate.js';
import { artMode } from '../../src/shared/contracts/art.js';
import { transparentBubble } from '../../src/backend/rendering/art/image-processing.js';
import { ART_MAX_WIDTH, ART_MIN_WIDTH, bubbleCollisionParts, findArtPlacement, intersects, type StoryArtLayout } from '../../src/frontend/story/art-placement.js';
import { createStoryRenderer } from '../../src/backend/rendering/story-renderer.js';
import { storyDesignData } from '../../fixtures/design/story-design.js';
import { parseCliOptions } from '../../src/backend/cli/options.js';
import { safeError } from '../../src/backend/support/safe-error.js';
import { cloudBody, renderThoughtBubble } from '../../src/backend/rendering/art/bubble-compositor.js';

const layout: StoryArtLayout = {
  width: 1080, height: 1920,
  meals: { lunch: { x: 32, y: 800, width: 1016, height: 500 }, dinner: { x: 32, y: 1332, width: 1016, height: 556 } },
  obstacles: [{ x: 64, y: 900, width: 400, height: 900 }],
};
const choice = { lunch: { index: 0, description: 'Spicy beef and mushroom stew' }, dinner: { index: 1, description: 'Spicy Korean pork ribs' } };
const bubble = () => sharp(Buffer.from('<svg width="512" height="512"><rect width="512" height="512" fill="#ff00ff"/><circle cx="256" cy="230" r="180" fill="white" stroke="#7caeff" stroke-width="8"/><ellipse cx="256" cy="250" rx="80" ry="45" fill="#dc8f42"/><circle cx="256" cy="447" r="18" fill="white"/></svg>')).png().toBuffer();

test('actual free space selects maximum decoration, shrinks to fit, and omits below minimum', () => {
  const full = findArtPlacement({ ...layout, meals: { ...layout.meals, lunch: { ...layout.meals.lunch!, y: 700, height: 600 } }, obstacles: [] }, ['lunch', 'dinner'])!;
  assert.equal(full.width, ART_MAX_WIDTH);
  assert.equal(full.character.width, 340 * 1.3);
  assert.equal(full.bubbles.lunch!.width, 250 * 1.2);
  assert.equal(full.bubbles.dinner!.width, 250 * 1.2);
  assert.ok(full.bubbles.lunch!.y > full.bubbles.dinner!.y);
  const narrow = { ...layout, obstacles: [{ x: 0, y: 0, width: 710, height: 1920 }] };
  const fit = findArtPlacement(narrow, ['lunch', 'dinner'])!;
  assert.ok(fit.width >= ART_MIN_WIDTH && fit.width < ART_MAX_WIDTH);
  for (const part of [fit.character, ...Object.values(fit.bubbles)]) {
    assert.ok(part.y + part.height <= 1856);
  }
  for (const part of [fit.character, ...Object.values(fit.bubbles).flatMap(bubbleCollisionParts)]) {
    assert.ok(narrow.obstacles.every(obstacle => !intersects(part, obstacle, 16)));
  }
  assert.equal(findArtPlacement({ ...layout, obstacles: [{ x: 0, y: 0, width: 760, height: 1920 }] }, ['lunch', 'dinner']), undefined);
});

test('different restaurant card heights share the approved Badaro canvas anchor', () => {
  const placements = [522, 700, 820].map(y => findArtPlacement({
    ...layout, obstacles: [],
    meals: { lunch: { x: 32, y, width: 1016, height: 1200 - y }, dinner: layout.meals.dinner! },
  }, ['lunch', 'dinner']));
  for (const placement of placements) {
    assert.deepEqual(placement, placements[0]);
    assert.equal(placement!.character.x, 606);
    assert.equal(placement!.character.y, 1223);
    assert.equal(placement!.bubbles.lunch!.y, 951);
    assert.equal(placement!.bubbles.dinner!.y, 861);
  }
});

test('snack, breakfast-only, empty/closed meals and insufficient space make zero AI calls', async () => {
  const base = Buffer.from('never decoded');
  const art = createStoryArt({ mode: 'generate', ai: { select: async () => { throw new Error('unexpected call'); }, image: async () => { throw new Error('unexpected call'); } } });
  for (const data of [storyDesignData('snack'), storyDesignData('dormitory', 'empty'), storyDesignData('teacher', 'normal', 'breakfast')]) {
    const result = await art.decorate(data, layout, base);
    assert.equal(result.report.status, 'skipped');
    assert.equal(result.report.selectionCalls + result.report.imageCalls, 0);
  }
  const closed = storyDesignData('teacher');
  closed.sections.forEach(s => { s.items = ['*한글날 미운영']; });
  assert.deepEqual(artMenus(closed), {});
  const result = await art.decorate(storyDesignData('dormitory'), { ...layout, obstacles: [{ x: 0, y: 0, width: 1080, height: 1920 }] }, base);
  assert.equal(result.report.reason, 'insufficient-space');
  assert.equal(result.report.selectionCalls, 0);
});

test('every supplied meal must select a real original menu item', () => {
  const menus = { lunch: ['닭갈비', '배추김치'] };
  assert.equal(validateSelection({ lunch: { index: 0, description: 'Korean stir fried chicken' } }, menus)[0]!.item, '닭갈비');
  for (const value of [{}, { lunch: null }, { lunch: { index: 10, description: 'Not in menu' } }, { lunch: { index: '0', description: 'Wrong index' } }]) {
    assert.throws(() => validateSelection(value, menus));
  }
  assert.throws(() => validateSelection({ ...choice, dinner: null }, { lunch: ['찌개'], dinner: ['밥', '갈비'] }), /dinner/);
});

test('chroma removal preserves opaque bubble whites; invalid backgrounds are rejected', async () => {
  const image = await transparentBubble(await bubble());
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.ok(data.some((value, index) => index % 4 === 3 && value === 0));
  assert.ok(data.some((value, index) => index % 4 === 3 && value === 255));
  await assert.rejects(transparentBubble(await sharp({ create: { width: 512, height: 512, channels: 3, background: 'white' } }).png().toBuffer()));
});

test('thought trails replace generated dots with three separated shrinking outlined circles at every size', async () => {
  const input = await transparentBubble(await bubble());
  const body = await sharp(await cloudBody(input)).metadata();
  assert.ok(body.height! < 400, 'detached generated dot is removed');
  for (const size of [150, 250, 260]) for (const meal of ['lunch', 'dinner'] as const) {
    const height = Math.round(size * 1.28);
    const output = await renderThoughtBubble(input, meal, { x: 500, y: 600, width: size, height },
      { x: meal === 'lunch' ? 580 : 300, y: 900, width: 460, height: 545 });
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const bands: { top: number; bottom: number }[] = [];
    let active = false;
    for (let y = 0; y < height; y++) {
      let occupied = false;
      for (let x = 0; x < size; x++) if (data[(y * size + x) * 4 + 3]! > 16) occupied = true;
      if (occupied && !active) bands.push({ top: y, bottom: y });
      if (occupied) bands.at(-1)!.bottom = y;
      active = occupied;
    }
    assert.equal(info.width, size); assert.equal(info.height, height);
    assert.equal(bands.length, 4, 'one cloud and three detached circles');
    assert.ok(bands[0]!.bottom - bands[0]!.top > size * .9, 'cloud uses the enlarged body area');
    const heights = bands.slice(1).map(band => band.bottom - band.top);
    assert.ok(heights[0]! > heights[1]! && heights[1]! > heights[2]!);
    assert.ok(bands.at(-1)!.bottom < height - 1, 'last circle remains inside the checked rectangle');
  }
});

test('heading and sun/moon remain pixel-identical when the food changes', async () => {
  const foods = await Promise.all(['#E2933D', '#79B56D'].map(fill => sharp(Buffer.from(
    `<svg width="260" height="166"><ellipse cx="130" cy="83" rx="115" ry="70" fill="${fill}"/></svg>`,
  )).png().toBuffer()));
  const box = { x: 588, y: 951, width: 253, height: 302 };
  const character = { x: 676, y: 1223, width: 372, height: 441 };
  for (const meal of ['lunch', 'dinner'] as const) {
    const rendered = await Promise.all(foods.map(food => renderThoughtBubble(food, meal, box, character)));
    const headings = await Promise.all(rendered.map(image => sharp(image).extract({ left: 0, top: 0, width: 253, height: 90 }).raw().toBuffer()));
    assert.deepEqual(headings[0], headings[1]);
    assert.notDeepEqual(rendered[0], rendered[1]);
  }
  assert.match(foodPrompt({ meal: 'lunch', item: '생선까스', description: 'A golden fish cutlet' }), /No accompanying rice.*sun, moon.*text/);
});

test('successful images and selection are reused offline; one-meal context reuses the same dish image', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'story-art-'));
  let selections = 0, images = 0;
  const ai = {
    select: async () => { selections++; return choice; },
    image: async () => { images++; return bubble(); },
  };
  const base = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#f6f8fb' } }).png().toBuffer();
  try {
    const art = createStoryArt({ mode: 'generate', cacheDir, ai });
    const first = await art.decorate(storyDesignData('dormitory'), layout, base);
    assert.equal(first.report.status, 'applied');
    assert.equal(images, 2); assert.equal(selections, 1);
    const cached = await createStoryArt({ mode: 'cache', cacheDir }).decorate(storyDesignData('teacher'), layout, base);
    assert.equal(cached.report.status, 'applied');
    assert.equal(cached.report.cacheHits, 3); assert.equal(cached.report.imageCalls, 0);
    assert.deepEqual(cached.image, first.image);
    const selectionFile = join(cacheDir, 'selections', (await readdir(join(cacheDir, 'selections')))[0]!);
    await writeFile(selectionFile, JSON.stringify({ ...choice, dinner: null }));
    const incomplete = await createStoryArt({ mode: 'cache', cacheDir }).decorate(storyDesignData('dormitory'), layout, base);
    assert.equal(incomplete.report.reason, 'selection-cache-miss');
    const repaired = await art.decorate(storyDesignData('dormitory'), layout, base);
    assert.equal(repaired.report.status, 'applied');
    assert.deepEqual(Object.keys(repaired.report.placement!.bubbles), ['lunch', 'dinner']);
    assert.equal(images, 2); assert.equal(selections, 2);
    const one = await art.decorate(storyDesignData('dormitory', 'normal', 'lunch'), {
      ...layout, meals: { lunch: { x: 32, y: 800, width: 1016, height: 1088 } },
    }, base);
    assert.equal(one.report.status, 'applied');
    assert.equal(Object.keys(one.report.placement!.bubbles).length, 1);
    assert.equal(images, 2); assert.equal(selections, 3);
    const different = storyDesignData('dormitory');
    different.sections[1]!.items = ['닭갈비'];
    const miss = await createStoryArt({ mode: 'cache', cacheDir, ai }).decorate(different, layout, base);
    assert.equal(miss.report.reason, 'selection-cache-miss');
    assert.equal(images, 2); assert.equal(selections, 3);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('Cloudflare errors and invalid selection fail decoration without producing a replacement image', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'story-art-failure-'));
  try {
    for (const select of [async () => { throw new Error('Cloudflare timeout'); }, async () => ({ lunch: { index: 99, description: 'Invented dish' } })]) {
      const art = createStoryArt({ mode: 'generate', cacheDir, ai: { select, image: async () => { throw new Error('must not generate'); } } });
      const result = await art.decorate(storyDesignData('dormitory'), layout, Buffer.from('base'));
      assert.equal(result.report.status, 'failed'); assert.equal(result.image, undefined); assert.equal(result.report.imageCalls, 0);
    }
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('missing mascot fails decoration before any AI call, without an unhandled rejection', async () => {
  const art = createStoryArt({ mode: 'generate', characterPath: '/missing-kmou-character.png', ai: {
    select: async () => { throw new Error('must not select'); }, image: async () => { throw new Error('must not generate'); },
  } });
  const result = await art.decorate(storyDesignData('dormitory'), layout, Buffer.from('base'));
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.selectionCalls + result.report.imageCalls, 0);
});

test('Cloudflare sends authenticated JSON selection and 512px multipart FLUX requests, without the mascot', async () => {
  assert.equal(FOOD_IMAGE_MODEL, '@cf/black-forest-labs/flux-2-klein-9b');
  const requests: { url: string; init: RequestInit }[] = [];
  const bytes = await bubble();
  const ai = createFoodAi({ accountId: 'a'.repeat(32), apiToken: 'test-token' }, async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return Response.json({ success: true, result: String(url).endsWith(FOOD_IMAGE_MODEL) ? { image: bytes.toString('base64') } : { response: choice } });
  });
  assert.deepEqual(await ai.select({ lunch: ['닭갈비'], dinner: ['밥', '갈비'] }), choice);
  assert.deepEqual(await ai.image('Food only', 512, 42), bytes);
  assert.ok(requests[0]!.url.endsWith(FOOD_SELECTION_MODEL));
  const selectionBody = JSON.parse(requests[0]!.init.body as string);
  assert.equal(selectionBody.response_format.type, 'json_schema');
  assert.deepEqual(selectionBody.response_format.json_schema.required, ['lunch', 'dinner']);
  assert.deepEqual(selectionBody.response_format.json_schema.properties.lunch.properties.index.enum, [0]);
  assert.deepEqual(selectionBody.response_format.json_schema.properties.dinner.properties.index.enum, [0, 1]);
  const imageRequest = requests[1]!;
  const body = imageRequest.init.body as FormData;
  assert.equal(body.get('width'), '512'); assert.equal(body.get('height'), '512');
  assert.deepEqual([...body.keys()].sort(), ['height', 'prompt', 'seed', 'width']);
  assert.equal(new Headers(imageRequest.init.headers).get('Authorization'), 'Bearer test-token');
  assert.equal(new Headers(imageRequest.init.headers).get('Content-Type'), null);
  const failing = createFoodAi({ accountId: 'a'.repeat(32), apiToken: 'secret' }, async () => new Response('secret', { status: 429 }));
  await assert.rejects(failing.image('food', 512, 42), /HTTP 429/);
});

test('CLI validates art modes, configuration is optional, and Cloudflare token is redacted', () => {
  assert.equal(artMode(undefined, 'cache'), 'cache');
  const options = parseCliOptions(['story', '--preview', '--art', 'generate']);
  assert.equal(options.command === 'story' && options.art, 'generate');
  assert.throws(() => parseCliOptions(['story', '--art', 'bad']));
  assert.throws(() => parseCliOptions(['feed', '--art', 'off']));
  assert.equal(cloudflareConfig({}), undefined);
  assert.throws(() => cloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: 'bad', CLOUDFLARE_API_TOKEN: 'test' }));
  assert.equal(safeError(new Error('oops secret-token'), { CLOUDFLARE_API_TOKEN: 'secret-token' }), 'oops [REDACTED]');
});

test('a decoration failure still returns the unchanged publishable Story', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'story-art-render-'));
  const normal = createStoryRenderer();
  const failed = createStoryRenderer({ art: { decorate: async () => { throw new Error('optional AI failed'); } } });
  try {
    const data = storyDesignData('dormitory');
    const before = await normal.render(data, join(dir, 'base'));
    const after = await failed.render(data, join(dir, 'failed'));
    assert.deepEqual(await readFile(before), await readFile(after));
  } finally { await normal.close(); await failed.close(); await rm(dir, { recursive: true, force: true }); }
});
