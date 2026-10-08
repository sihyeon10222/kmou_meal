import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createFoodImagePreparer, foodItems, foodPrompt, generateFood, loadFoodConfig, planFood } from '../src/food-images.js';
import { compositeTray, GENERAL_TRAY, ROUND_TRAY, selectTray, trayReference, traySvg } from '../src/tray-profiles.js';
import { dormitoryStory } from '../src/story-data.js';
import { resolveStoryRequest } from '../src/story-modes.js';
import { safeError } from '../src/config.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

const config = { accountId: 'a'.repeat(32), token: 'private-cloudflare-token' };
const env = { STORY_AI_ENABLED: 'true', CLOUDFLARE_ACCOUNT_ID: config.accountId, CLOUDFLARE_API_TOKEN: config.token };
const generated = await sharp({ create: { width: 1000, height: 712, channels: 3, background: '#a8592e' } }).png().toBuffer();
const ok = () => Response.json({ success: true, result: { image: generated.toString('base64') } });

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

test('메뉴 안내 제외, 선택 메뉴, 밥/김치, 고정 칸 배치', () => {
  assert.deepEqual(foodItems(['*대체공휴일 미운영', '조식 미운영', '휴무', '등록된 식단 없음']), []);
  assert.deepEqual(foodItems(['우유or두유/시리얼', '밥/김치', '토스트&잼']), ['우유', '시리얼', '밥', '김치', '토스트&잼']);
  const items = ['쌀밥', '된장찌개', '불고기', '김치', '사과'];
  const plan = planFood(GENERAL_TRAY, items);
  assert.deepEqual(plan.flatMap(entry => entry.items).sort(), [...items].sort());
  assert.deepEqual(plan.find(entry => entry.slot === 'bottom-left')?.items, ['쌀밥', '불고기']);
  assert.deepEqual(plan.find(entry => entry.slot === 'bottom-right')?.items, ['된장찌개']);
  assert.ok(!plan.some(entry => entry.slot === 'utensils'));
  assert.match(foodPrompt(ROUND_TRAY, ['돈가스']), /main .*돈가스/);
  const lunch = planFood(GENERAL_TRAY, ['들깨미역국', '닭갈비', '단호박콘치즈찜', '밥/김치']);
  assert.deepEqual(lunch.find(entry => entry.slot === 'bottom-left')?.items, ['닭갈비', '밥']);
  assert.ok(lunch.find(entry => entry.slot === 'upper-left')?.items.includes('단호박콘치즈찜'));
  const breakfast = planFood(ROUND_TRAY, ['우유or두유/시리얼', '토스트', '사과']);
  assert.deepEqual(breakfast.find(entry => entry.slot === 'lower-right')?.items, ['우유', '시리얼']);
  assert.deepEqual(breakfast.find(entry => entry.slot === 'middle-right')?.items, ['사과']);
  const staffLunch = planFood(GENERAL_TRAY, ['백미밥/흑미밥', '매콤돈낙새볶음', '순대튀김', '모듬어묵국']);
  assert.deepEqual(staffLunch.find(entry => entry.slot === 'bottom-left')?.items, ['백미밥', '흑미밥', '매콤돈낙새볶음', '순대튀김']);
  assert.deepEqual(planFood(GENERAL_TRAY, ['후리가케밥', '잔치국수']).find(entry => entry.slot === 'bottom-left')?.items, ['후리가케밥', '잔치국수']);
  assert.deepEqual(planFood(ROUND_TRAY, ['토마토스파게티', '마늘빵', '그린샐러드', '오이피클']).find(entry => entry.slot === 'main')?.items, ['토마토스파게티']);
  assert.match(foodPrompt(ROUND_TRAY, ['돈가스']), /golden breadcrumb crust/);
});

test('참고 이미지 크기와 합성의 투명 외곽·칸막이·수저 칸 보존', async () => {
  for (const profile of [GENERAL_TRAY, ROUND_TRAY]) {
    const reference = await sharp(await trayReference(profile)).metadata();
    assert.ok(reference.width! < 512 && reference.height! < 512);
    const occupied = profile.slots.filter(slot => !slot.utensil).map(slot => slot.id);
    const image = await compositeTray(profile, generated, occupied);
    const original = await sharp(traySvg(profile)).ensureAlpha().raw().toBuffer();
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.equal(pixel(data, 0, 0)[3], 0);
    for (const [x, y] of [[500, 12], [900, 200]]) assert.deepEqual(pixel(data, x!, y!), pixel(original, x!, y!));
    const slot = profile.slots[0]!;
    assert.notDeepEqual(pixel(data, slot.x + slot.width / 2, slot.y + slot.height / 2), pixel(original, slot.x + slot.width / 2, slot.y + slot.height / 2));
  }
});

test('Cloudflare multipart 입력과 정상 응답', async () => {
  let calls = 0;
  const mock: typeof fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /accounts\/a{32}\/ai\/run\/@cf\/black-forest-labs\/flux-2-klein-4b$/);
    assert.equal((init!.headers as Record<string, string>).Authorization, `Bearer ${config.token}`);
    assert.ok(!('Content-Type' in (init!.headers as Record<string, string>)));
    const form = init!.body as FormData;
    assert.ok(form.get('input_image_0') instanceof Blob);
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
  const prepare = createFoodImagePreparer({ env, cacheDir, client: { fetch: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return ok();
  } } });
  try {
    const data = dormitoryStory(resolveStoryRequest('today_dormitory_full', '2026-10-08'), {
      date: '2026/10/08', breakfast: ['우유', '토스트'], lunch: ['불고기', '밥'], dinner: ['된장찌개', '밥'],
    });
    const first = await prepare(data);
    assert.equal(calls, 3); assert.equal(peak, 2);
    assert.ok(first.sections.every(section => section.image));
    assert.ok(data.sections.every(section => !section.image));
    assert.ok(first.aiImages?.every(image => image.status === 'generated'));
    const second = await prepare({ ...data, request: resolveStoryRequest('today_dormitory_lunch', '2026-10-08'), sections: [data.sections[1]!] });
    assert.equal(second.aiImages?.[0]?.status, 'cached'); assert.equal(calls, 3);
    await writeFile(first.aiImages![1]!.imagePath!, 'broken');
    await prepare(data); assert.equal(calls, 4);
    data.sections[1]!.items.push('김치'); await prepare(data); assert.equal(calls, 5);
    const png = await readFile(first.aiImages![0]!.imagePath!); assert.ok((await sharp(png).metadata()).hasAlpha);
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
    const mixedData = { ...data, sections: data.sections.map(section => section.key === 'breakfast' ? { ...section, items: ['토스트'] } : section) };
    const mixed = await createFoodImagePreparer({ env, cacheDir, client: { fetch: async (_url, init) =>
      String((init!.body as FormData).get('prompt')).includes('불고기') ? new Response('', { status: 403 }) : ok(),
    } })(mixedData);
    assert.deepEqual(mixed.aiImages?.map(image => image.status), ['generated', 'failed', 'skipped']);
    assert.ok(mixed.sections[0]!.image);
    assert.ok(!mixed.sections[1]!.image);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});
