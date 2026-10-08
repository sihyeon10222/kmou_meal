import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createFoodImagePreparer, foodItems, foodPrompt, generateFood, loadFoodConfig, foodBackground, matchFoodBackground, frameFoodImage, translateFoodMenu, MENU_TRANSLATION_MODEL } from '../src/food-images.js';
import { mealPositions, type FoodDescription } from "../src/food-prompt.js";
import { GENERAL_TRAY, ROUND_TRAY, selectTray, shouldGenerateFoodImage } from '../src/tray-profiles.js';
import { dormitoryStory } from '../src/story-data.js';
import { resolveStoryRequest } from '../src/story-modes.js';
import { safeError } from '../src/config.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

const config = { accountId: 'a'.repeat(32), token: 'private-cloudflare-token' };
const env = { STORY_AI_ENABLED: 'true', CLOUDFLARE_ACCOUNT_ID: config.accountId, CLOUDFLARE_API_TOKEN: config.token };
const generated = await sharp({ create: { width: 1000, height: 712, channels: 3, background: '#a8592e' } }).png().toBuffer();
const ok = () => Response.json({ success: true, result: { image: generated.toString('base64') } });
const translated = (init: RequestInit | undefined) => {
  const body = JSON.parse(String(init!.body));
  const foods = JSON.parse(body.messages[1].content) as string[];
  return Response.json({ success: true, result: { response: JSON.stringify({ foods: foods.map((item, index) => ({ description: item === '불고기' ? 'bulgogi' : `translated dish ${index}`, kind: item === '밥' ? 'rice' : 'side' })) }) } });
};

test('끼니 배경색을 맞춰도 식판과 내부의 비슷한 색 음식은 그대로 유지한다', async () => {
  const pixels = Buffer.alloc(100 * 80 * 3);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) {
    const tray = x >= 10 && x < 90 && y >= 10 && y < 70;
    const rgb = tray ? [248, 228, 92] : [10, 50, 230];
    pixels.set(rgb, (y * 100 + x) * 3);
  }
  // Food matching the original background is enclosed by the tray rim.
  pixels.set([10, 50, 230], (40 * 100 + 50) * 3);
  const input = await sharp(pixels, { raw: { width: 100, height: 80, channels: 3 } }).png().toBuffer();
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const color = foodBackground('full', meal);
    const { data, info } = await sharp(await matchFoodBackground(input, color)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 100); assert.equal(info.height, 80);
    for (const pixel of [0, 99, 79 * 100, 80 * 100 - 1]) assert.deepEqual([...data.subarray(pixel * 3, pixel * 3 + 3)], [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)));
    for (let y = 10; y < 70; y++) for (let x = 10; x < 90; x++) {
      const offset = (y * 100 + x) * 3;
      assert.deepEqual(data.subarray(offset, offset + 3), pixels.subarray(offset, offset + 3));
    }
  }
});

test('식판 바깥 여백만 줄이고 음식 영역의 크기와 픽셀은 바꾸지 않는다', async () => {
  const input = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#f5f1e7' } }).composite([
    { input: await sharp({ create: { width: 400, height: 250, channels: 3, background: '#f8e45c' } }).png().toBuffer(), left: 100, top: 75 },
  ]).png().toBuffer();
  const framed = await frameFoodImage(input, '#f5f1e7');
  const { width, height } = await sharp(framed).metadata();
  assert.equal(width, 424); assert.equal(height, 274);
  assert.deepEqual(await sharp(framed).extract({ left: 12, top: 12, width: 400, height: 250 }).raw().toBuffer(), await sharp(input).extract({ left: 100, top: 75, width: 400, height: 250 }).raw().toBuffer());
});

test('일일 무료 한도 소진은 같은 이미지 재시도와 남은 끼니 호출을 중단한다', async () => {
  const limited = () => Response.json({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }, { status: 429 });
  let calls = 0;
  await assert.rejects(generateFood(config, GENERAL_TRAY, ['밥'], { fetch: async () => { calls++; return limited(); }, sleep: async () => assert.fail('daily quota must not retry') }), /일일 무료 한도/);
  assert.equal(calls, 1);
  calls = 0;
  const cacheDir = await mkdtemp(join(tmpdir(), 'kmou-food-quota-'));
  try {
    const data = dormitoryStory(resolveStoryRequest('today_badaro_full', '2026-10-08'), { date: '2026/10/08', breakfast: ['밥'], lunch: ['국'], dinner: ['불고기'] });
    const prepared = await createFoodImagePreparer({ env, cacheDir, client: { fetch: async () => { calls++; return limited(); } } })(data);
    assert.ok(calls >= 1 && calls <= 2, 'only requests already in flight may hit the quota');
    assert.ok(prepared.aiImages!.every(image => image.status === 'failed' && image.error?.includes('일일 무료 한도')));
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('식당별 식판 선택과 기본 비활성화/인증 설정', () => {
  assert.equal(loadFoodConfig({}), undefined);
  assert.throws(() => loadFoodConfig({ STORY_AI_ENABLED: 'true' }), /CLOUDFLARE/);
  assert.deepEqual(loadFoodConfig(env), config);
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    for (const restaurant of ['badaro', 'teacher'] as const) assert.equal(selectTray(restaurant, meal, ['돈까스']).id, GENERAL_TRAY.id);
  }
  assert.equal(selectTray('dormitory', 'breakfast', ['밥']).id, ROUND_TRAY.id);
  for (const item of ['돈가스', '치즈돈까스', '커틀릿', '파스타', '스파게티']) assert.equal(selectTray('dormitory', 'lunch', [item]).id, ROUND_TRAY.id);
  assert.equal(selectTray('dormitory', 'dinner', ['돈육장조림']).id, GENERAL_TRAY.id);
  assert.equal(safeError(new Error(`failed ${config.token}`), env), 'failed [REDACTED]');
});

test("메뉴 정리와 위치 지정은 모든 음식을 보존하며 없는 밥과 국을 추가하지 않는다", () => {
  assert.deepEqual(foodItems(["조식 미운영", "휴무", "등록된 식단 없음"]), []);
  assert.deepEqual(foodItems(["우유or두유/시리얼", "밥/김치", "토스트&잼"]), ["우유", "시리얼", "밥", "김치", "토스트&잼"]);
  for (const item of ["밥/잡곡밥", "밥/작곡밥", "쌀밥 / 흑미밥"]) assert.deepEqual(foodItems([item]), ["밥"]);
  const foods: FoodDescription[] = [
    { description: "plain steamed white rice", kind: "rice" }, { description: "seaweed soup", kind: "soup" },
    { description: "spicy chicken", kind: "main" }, { description: "pumpkin and sweetcorn", kind: "side" },
    { description: "perilla leaves", kind: "side" }, { description: "garlic stems", kind: "side" },
    { description: "napa kimchi", kind: "kimchi" }, { description: "orange wedges", kind: "dessert" },
  ];
  const positions = mealPositions(GENERAL_TRAY, foods);
  for (const food of foods) assert.equal(positions.filter(line => line.includes(food.description)).length, 1);
  assert.ok(positions.find(line => line.includes("white rice"))!.startsWith("BOTTOM LEFT"));
  assert.ok(positions.find(line => line.includes("seaweed soup"))!.startsWith("BOTTOM RIGHT"));
  assert.ok(positions.find(line => line.includes("napa kimchi"))!.startsWith("TOP RIGHT"));
  const pasta: FoodDescription[] = [{ description: "tomato spaghetti", kind: "main" }, { description: "garlic bread", kind: "side" }, { description: "green salad", kind: "side" }, { description: "cucumber pickles", kind: "side" }];
  const round = mealPositions(ROUND_TRAY, pasta);
  assert.ok(round[0]!.startsWith("LEFT large circular"));
  assert.ok(round.some(line => line.includes("NO rice")) && round.some(line => line.includes("NO soup bowl")));
  assert.ok(round.find(line => line.includes("pickles"))!.startsWith("LOWER RIGHT"));
  for (const meal of ["breakfast", "lunch", "dinner"] as const) {
    const background = foodBackground("full", meal);
    const prompt = foodPrompt(GENERAL_TRAY, [], background, foods);
    assert.ok(foods.every(food => prompt.includes(food.description)));
    assert.ok(prompt.includes(background));
    assert.ok(prompt.indexOf("spicy chicken") < prompt.indexOf("Tray shape:"));
    assert.ok(prompt.length < 2600, "normal meals should keep the prompt concise");
    assert.equal(foodBackground(meal, meal), background);
  }
});

test('Cloudflare multipart 입력과 정상 응답', async () => {
  let calls = 0;
  const mock: typeof fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /accounts\/a{32}\/ai\/run\/@cf\/black-forest-labs\/flux-2-klein-9b$/);
    assert.equal((init!.headers as Record<string, string>).Authorization, `Bearer ${config.token}`);
    assert.ok(!('Content-Type' in (init!.headers as Record<string, string>)));
    const form = init!.body as FormData;
    assert.ok(![...form.keys()].some(key => key.startsWith('input_image')));
    assert.equal(form.get('width'), '1024');
    assert.match(String(form.get('prompt')), /불고기/);
    return ok();
  };
  assert.deepEqual(await generateFood(config, GENERAL_TRAY, ['불고기'], { fetch: mock }), generated);
  assert.equal(calls, 1);
});

test('통신·429·5xx는 한 번 재시도, 인증·잘못된 응답은 즉시 실패', async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    await generateFood(config, GENERAL_TRAY, ['밥'], { fetch: async () => ++calls === 1 ? new Response('', { status }) : ok(), sleep: async () => {} });
    assert.equal(calls, 2);
  }
  for (const status of [401, 403, 400]) {
    let calls = 0;
    await assert.rejects(generateFood(config, GENERAL_TRAY, ['밥'], { fetch: async () => { calls++; return new Response('', { status }); } }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
  for (const error of [new TypeError('network'), new DOMException('timed out', 'TimeoutError')]) {
    let calls = 0;
    await assert.rejects(generateFood(config, GENERAL_TRAY, ['밥'], { fetch: async () => { calls++; throw error; }, sleep: async () => {} }));
    assert.equal(calls, 2);
  }
  for (const body of [{ success: false }, { success: true, result: { image: 'invalid!' } }]) {
    let calls = 0;
    await assert.rejects(generateFood(config, GENERAL_TRAY, ['밥'], { fetch: async () => { calls++; return Response.json(body); } }));
    assert.equal(calls, 1);
  }
});

test('실제 요청 제한 시간이 멈춘 소켓을 중단하고 한 번만 재시도한다', async () => {
  const server = createServer(() => { /* Response deliberately never completes. */ });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let calls = 0;
  try {
    const address = server.address() as { port: number };
    await assert.rejects(generateFood(config, GENERAL_TRAY, ['밥'], {
      timeoutMs: 30, sleep: async () => {}, fetch: async (_url, init) => {
        calls++;
        return fetch(`http://127.0.0.1:${address.port}`, init);
      },
    }), { name: 'TimeoutError' });
    assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('캐시 재사용·메뉴 변경·손상 복구와 두 요청 동시 제한', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'kmou-food-'));
  let calls = 0, active = 0, peak = 0;
  const prepare = createFoodImagePreparer({ env, cacheDir, client: { fetch: async (url, init) => {
    if (String(url).endsWith(MENU_TRANSLATION_MODEL)) return translated(init);
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return ok();
  } } });
  try {
    const data = dormitoryStory(resolveStoryRequest('today_badaro_full', '2026-10-08'), {
      date: '2026/10/08', breakfast: ['우유', '토스트'], lunch: ['불고기', '밥'], dinner: ['된장찌개', '밥'],
    });
    const first = await prepare(data);
    assert.equal(calls, 3); assert.equal(peak, 2);
    assert.ok(first.sections.every(section => section.image));
    assert.ok(data.sections.every(section => !section.image));
    assert.ok(first.aiImages?.every(image => image.status === 'generated'));
    const second = await prepare({ ...data, request: resolveStoryRequest('today_badaro_lunch', '2026-10-08'), sections: [data.sections[1]!] });
    assert.equal(second.aiImages?.[0]?.status, 'cached'); assert.equal(calls, 3);
    await writeFile(first.aiImages![1]!.imagePath!, 'broken');
    await prepare(data); assert.equal(calls, 4);
    data.sections[1]!.items.push('김치'); await prepare(data); assert.equal(calls, 5);
    const png = await readFile(first.aiImages![0]!.imagePath!);
    assert.deepEqual(await sharp(png).raw().toBuffer(), await sharp(generated).raw().toBuffer(), '생성 이미지의 모든 픽셀을 보존해야 합니다.');
    assert.equal(first.sections[0]!.image!.width, 1000);
    assert.equal(first.sections[0]!.image!.height, 712);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('학식·비활성화·빈 끼니 호출 제외, 일부 오류는 해당 사진만 제외', async () => {
  const data = dormitoryStory(resolveStoryRequest('today_dormitory_full', '2026-10-08'), {
    date: '2026/10/08', breakfast: ['조식 미운영'], lunch: ['불고기'], dinner: [],
  });
  const never: typeof fetch = async () => assert.fail('호출 금지');
  assert.equal(await createFoodImagePreparer({ env: {}, client: { fetch: never } })(data), data);
  const snack = { ...data, request: resolveStoryRequest('today_snack', '2026-10-08') };
  assert.equal(await createFoodImagePreparer({ env, client: { fetch: never } })(snack), snack);
  const cacheDir = await mkdtemp(join(tmpdir(), 'kmou-food-fail-'));
  try {
    const prepared = await createFoodImagePreparer({ env, cacheDir, client: { fetch: async () => new Response('', { status: 401 }) } })(data);
    assert.deepEqual(prepared.aiImages?.map(image => image.status), ['skipped', 'failed', 'skipped']);
    assert.ok(prepared.sections.every(section => !section.image));
    const missing = await createFoodImagePreparer({ env: { STORY_AI_ENABLED: 'true' }, cacheDir })(data);
    assert.equal(missing.aiImages?.[1]?.status, 'failed');
    const mixedData = { ...data, request: resolveStoryRequest('today_badaro_full', '2026-10-08'), sections: data.sections.map(section => section.key === 'breakfast' ? { ...section, items: ['토스트'] } : section) };
    const mixed = await createFoodImagePreparer({ env, cacheDir, client: { fetch: async (url, init) =>
      String(url).endsWith(MENU_TRANSLATION_MODEL) ? translated(init) : String((init!.body as FormData).get('prompt')).includes('bulgogi') ? new Response('', { status: 403 }) : ok(),
    } })(mixedData);
    assert.deepEqual(mixed.aiImages?.map(image => image.status), ['generated', 'failed', 'skipped']);
    assert.ok(mixed.sections[0]!.image);
    assert.ok(!mixed.sections[1]!.image);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('승선생활관만 아침 생성: 다른 식당은 캐시 조회·API 호출·사진 표시를 모두 제외한다', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'kmou-breakfast-policy-'));
  try {
    let calls = 0;
    const prepare = createFoodImagePreparer({ env, cacheDir, client: { fetch: async (url, init) => { calls++; return String(url).endsWith(MENU_TRANSLATION_MODEL) ? translated(init) : ok(); } } });
    for (const restaurant of ['dormitory', 'teacher', 'badaro'] as const) {
      assert.equal(shouldGenerateFoodImage(restaurant, 'breakfast'), restaurant === 'badaro');
      const request = resolveStoryRequest(`today_${restaurant}_breakfast`, '2026-10-08');
      const data = dormitoryStory(request, { date: request.targetDate, breakfast: ['밥', '국'], lunch: [], dinner: [] });
      // Legacy images must be removed even when the caller provides them.
      data.sections[0]!.image = { dataUrl: `data:image/png;base64,${generated.toString('base64')}`, width: 1000, height: 712 };
      const prepared = await prepare(data);
      assert.equal(prepared.aiImages![0]!.status, restaurant === 'badaro' ? 'generated' : 'skipped');
      assert.equal(Boolean(prepared.sections[0]!.image), restaurant === 'badaro');
      for (const meal of ['lunch', 'dinner']) assert.ok(shouldGenerateFoodImage(restaurant, meal));
    }
    assert.equal(calls, 2);
    assert.equal(shouldGenerateFoodImage('snack', 'breakfast'), false);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('영어 메뉴 번역은 원문별 항목 수를 보존하고 이미지 프롬프트에 사용한다', async () => {
  const english: FoodDescription[] = [{ description: 'plain steamed white rice', kind: 'rice' }, { description: 'Korean bulgogi beef', kind: 'main' }, { description: 'kimchi', kind: 'kimchi' }];
  const foods = await translateFoodMenu(config, ['밥', '불고기', '김치'], { fetch: async (url, init) => {
    assert.ok(String(url).endsWith(MENU_TRANSLATION_MODEL));
    const body = JSON.parse(String(init!.body));
    assert.equal(body.temperature, 0);
    assert.deepEqual(JSON.parse(body.messages[1].content), ['밥', '불고기', '김치']);
    return Response.json({ success: true, result: { response: JSON.stringify({ foods: english }) } });
  } });
  assert.deepEqual(foods, english);
  await generateFood(config, GENERAL_TRAY, ['밥', '불고기', '김치'], { englishFoods: foods, fetch: async (_url, init) => {
    const prompt = String((init!.body as FormData).get('prompt'));
    assert.ok(english.every(item => prompt.includes(item.description)));
    assert.ok(!prompt.includes('- 불고기'));
    return ok();
  } });
  for (const response of [null, { foods: ['missing'] }, { foods: ['', 'beef', 'kimchi'] }, { foods: ['밥', 'beef', 'kimchi'] },
    ...[{ description: '', kind: 'rice' }, { description: '밥', kind: 'rice' }, { description: 'rice', kind: 'unknown' }, { description: 'x'.repeat(201), kind: 'rice' }]
      .map(item => ({ foods: [item, ...english.slice(1)] }))]) {
    await assert.rejects(translateFoodMenu(config, ['밥', '불고기', '김치'], { fetch: async () => Response.json({ success: true, result: { response } }) }));
  }
});


test('밥 선택지는 번역 모델이 잡곡으로 응답해도 흰밥 한 종류로 고정한다', async () => {
  const foods = await translateFoodMenu(config, ['밥/잡곡밥'], { fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    assert.deepEqual(JSON.parse(body.messages[1].content), ['밥']);
    return Response.json({ success: true, result: { response: { foods: [{ description: 'mixed grain rice and white rice', kind: 'side' }] } } });
  } });
  assert.deepEqual(foods, [{ description: 'plain steamed white rice', kind: 'rice' }]);
  const prompt = foodPrompt(GENERAL_TRAY, ['밥/잡곡밥'], '#f5f1e7', foods);
  assert.match(prompt, /BOTTOM LEFT large well, directly on the tray, one portion only: plain steamed white rice/);
  assert.ok(!prompt.includes('mixed grain'));
});
