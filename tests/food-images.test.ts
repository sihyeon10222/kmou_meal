import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createFoodImagePreparer, foodItems, foodPrompt, generateFood, loadFoodConfig, foodBackground, translateFoodMenu, MENU_TRANSLATION_MODEL } from '../src/food-images.js';
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
  return Response.json({ success: true, result: { response: JSON.stringify({ foods: foods.map((item, index) => item === '불고기' ? 'bulgogi' : `translated dish ${index}`) }) } });
};

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

test('메뉴와 식판 형태를 전달하고 음식별 좌표나 참고 이미지를 강제하지 않는다', () => {
  assert.deepEqual(foodItems(['*대체공휴일 미운영', '조식 미운영', '휴무', '등록된 식단 없음']), []);
  assert.deepEqual(foodItems(['우유or두유/시리얼', '밥/김치', '토스트&잼']), ['우유', '시리얼', '밥', '김치', '토스트&잼']);
  const items = ['쌀밥', '된장찌개', '불고기', '김치', '사과'];
  const prompt = foodPrompt(GENERAL_TRAY, items, '#2259b1');
  for (const item of items) assert.ok(prompt.includes(`- ${item}`));
  assert.ok(prompt.indexOf('- 쌀밥') < prompt.indexOf('Tray shape:'));
  assert.match(prompt, /Generate the entire tray, all food/);
  assert.match(prompt, /exactly 8 recessed compartments/);
  assert.match(foodPrompt(ROUND_TRAY, ['토마토스파게티']), /exactly 5 recessed compartments/);
  assert.match(foodPrompt(ROUND_TRAY, ['돈가스']), /golden breadcrumb crust/);
  assert.match(prompt, /#2259b1/);
  assert.ok(!prompt.includes('image 0') && !prompt.includes('center ') && !prompt.includes('assigned compartment'));
  assert.equal(foodBackground('full', 'breakfast'), '#ffffff');
  assert.equal(foodBackground('full', 'dinner'), '#2259b1');
  assert.equal(foodBackground('lunch', 'lunch'), '#f5f1e7');
});

test('Cloudflare multipart 입력과 정상 응답', async () => {
  let calls = 0;
  const mock: typeof fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /accounts\/a{32}\/ai\/run\/@cf\/black-forest-labs\/flux-2-klein-4b$/);
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
  const english = ['steamed rice', 'Korean bulgogi beef', 'kimchi'];
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
    assert.ok(english.every(item => prompt.includes(`- ${item}`)));
    assert.ok(!prompt.includes('- 불고기'));
    return ok();
  } });
  for (const response of [null, { foods: ['missing'] }, { foods: ['', 'beef', 'kimchi'] }, { foods: ['밥', 'beef', 'kimchi'] }]) {
    await assert.rejects(translateFoodMenu(config, ['밥', '불고기', '김치'], { fetch: async () => Response.json({ success: true, result: { response } }) }));
  }
});
