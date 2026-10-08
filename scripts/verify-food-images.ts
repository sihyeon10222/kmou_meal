import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFoodImagePreparer, FOOD_MODEL, loadFoodConfig } from '../src/food-images.js';
import { createStoryRenderer } from '../src/render-story.js';
import { resolveStoryRequest, type StoryMode } from '../src/story-modes.js';
import type { StoryRenderData } from '../src/story-data.js';

// Six samples cover the requested restaurants, tray shapes, colors and rice alternatives.
// Running this file without --live never calls Cloudflare or Instagram.
const cases: { name: string; mode: StoryMode; meal: string; items: string[] }[] = [
  { name: 'dormitory-lunch', mode: 'today_dormitory_lunch', meal: 'lunch', items: ['들깨미역국', '닭갈비', '단호박콘치즈찜', '깻잎무쌈/마늘쫑지무침', '밥/김치', '오렌지'] },
  { name: 'dormitory-dinner', mode: 'today_dormitory_dinner', meal: 'dinner', items: ['어묵매운탕', '순살고등어양념구이', '수제미트볼케찹조림', '미나리숙주나물', '밥/김치'] },
  { name: 'badaro-breakfast', mode: 'today_badaro_breakfast', meal: 'breakfast', items: ['밥/잡곡밥', '대구맑은탕', '소고기채장조림', '팝콘치킨&머스타드', '취나물무침', '포기김치', '우유/시리얼'] },
  { name: 'teacher-lunch', mode: 'today_teacher_lunch', meal: 'lunch', items: ['백미밥/흑미밥', '모듬어묵국', '매콤돈낙새볶음', '순대튀김', '콩나물김가루무침', '깍두기', '냉우동샐러드'] },
  { name: 'round-cutlet', mode: 'today_dormitory_lunch', meal: 'lunch', items: ['돈가스&소스', '쌀밥', '양배추샐러드', '옥수수스프', '김치'] },
  { name: 'round-pasta', mode: 'today_dormitory_dinner', meal: 'dinner', items: ['토마토스파게티', '마늘빵', '그린샐러드', '오이피클'] },
];

if (!process.argv.includes('--live')) {
  console.log('실제 Cloudflare 생성 6건을 검증하려면 npm run verify-food-images -- --live 를 실행하세요. 이미지 업로드는 하지 않습니다.');
  process.exit(0);
}
assert.ok(loadFoodConfig(), 'STORY_AI_ENABLED=true와 Cloudflare 인증을 .env에 설정하세요.');
const output = resolve('output/food-quality-live');
await mkdir(output, { recursive: true });
const renderer = createStoryRenderer();
const results: unknown[] = [];
const completed: StoryRenderData[] = [];
try {
  for (const sample of cases) {
    let prompt: string | undefined;
    const prepare = createFoodImagePreparer({ cacheDir: `${output}/cache`, client: { fetch: async (url, init) => {
      if (init?.body instanceof FormData) prompt = String(init.body.get('prompt'));
      return fetch(url, init);
    } } });
    const request = resolveStoryRequest(sample.mode, '2026-10-08');
    const data: StoryRenderData = { request, sections: [{ key: sample.meal, label: sample.meal[0]!.toUpperCase() + sample.meal.slice(1), items: sample.items }] };
    const prepared = await prepare(data);
    const status = prepared.aiImages![0]!;
    const entry = { name: sample.name, model: FOOD_MODEL, status, items: sample.items, prompt };
    results.push(entry);
    await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
    assert.ok(status.status === 'generated' || status.status === 'cached', `${sample.name}: ${status.error ?? status.status}`);
    const image = await renderer.render(prepared, `${output}/${sample.name}`);
    completed.push(prepared);
    console.log(`${sample.name}: ${status.status}, ${image}`);
  }
  const dormitory: StoryRenderData = {
    request: resolveStoryRequest('today_dormitory_full', '2026-10-08'),
    sections: [{ key: 'breakfast', label: 'Breakfast', items: ['우유or두유/시리얼', '셀프토스트&버터/딸기잼', '계란후라이', '야채샐러드&소스', '사과'] }, completed[0]!.sections[0]!, completed[1]!.sections[0]!],
  };
  await renderer.render(dormitory, output);
  console.log('생성·렌더링 완료. report.json의 음식 목록과 실제 이미지를 시각 검토해야 품질 검증이 완료됩니다.');
} finally { await renderer.close(); }
