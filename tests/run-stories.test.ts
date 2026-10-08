import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStories, type RunDependencies } from '../src/run-stories.js';
import { emptyCoop } from './fixtures.js';
import { PublishedStoryError } from '../src/post-story.js';
import { createFoodImagePreparer } from '../src/food-images.js';

test('AI 실패 끼니는 텍스트로 게시하며 게시 성공·종료 조건을 유지한다', async () => {
  let renders = 0, publishes = 0;
  const results = await runStories('today_badaro_full', '2026-10-08', false, {
    fetchDormitory: async () => assert.fail('다른 식당 조회 금지'),
    fetchCoop: async () => assert.fail('다른 식당 조회 금지'),
    fetchBadaro: async () => ({ date: '2026/10/08', breakfast: [], lunch: ['불고기'], dinner: [] }),
    prepareImages: createFoodImagePreparer({ env: { STORY_AI_ENABLED: 'true' } }),
    render: async data => { renders++; assert.equal(data.sections[1]!.items[0], '불고기'); assert.ok(!data.sections[1]!.image); return 'text.jpg'; },
    publish: async () => { publishes++; return { mediaId: 'successful-post' }; },
  });
  assert.equal(renders, 1); assert.equal(publishes, 1);
  assert.equal(results[0]!.status, 'published');
  assert.equal(results[0]!.warning, undefined);
  assert.equal(results[0]!.aiImages?.[1]?.status, 'failed');
  assert.equal(results[0]!.mediaId, 'successful-post');
});

test('승선생활관은 주말에도 전용 API의 세 끼를 렌더하고 게시한다', async () => {
  const fail = async (): Promise<never> => assert.fail('다른 식당 조회 금지');
  const results = await runStories('today_badaro_full', '2026-09-20', false, {
    fetchDormitory: fail, fetchCoop: fail,
    fetchBadaro: async date => {
      assert.equal(date, '2026-09-20');
      return { date: String(date), breakfast: ['승선 아침'], lunch: ['승선 점심'], dinner: ['승선 저녁'] };
    },
    render: async data => {
      assert.equal(data.request.title, '승선생활관 식단');
      assert.deepEqual(data.sections.map(section => section.items), [['승선 아침'], ['승선 점심'], ['승선 저녁']]);
      return 'badaro.jpg';
    },
    publish: async (data, image) => { assert.equal(image, 'badaro.jpg'); assert.equal(data.request.mode, 'today_badaro_full'); },
  });
  assert.equal(results[0]!.status, 'published');
});

test('순차 게시와 중간 실패 후 계속 처리, 학식은 한 번만 조회', async () => {
  const events: string[] = [];
  let coopCalls = 0;
  const deps: RunDependencies = {
    fetchBadaro: async date => ({ date: String(date), breakfast: ['조식'], lunch: [], dinner: [] }),
    fetchDormitory: async date => ({ date: String(date), breakfast: ['조식'], lunch: [], dinner: [] }),
    fetchCoop: async () => { coopCalls++; return {
      ...emptyCoop,
      snackCorner: { ...emptyCoop.snackCorner, snack: ['분식'] },
      staffRestaurant: { ...emptyCoop.staffRestaurant, lunch: ['중식'] },
    }; },
    render: async data => { events.push(`render:${data.request.mode}`); return 'image.jpg'; },
    publish: async data => {
      events.push(`start:${data.request.mode}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      events.push(`end:${data.request.mode}`);
      if (data.request.restaurant === 'snack') throw new Error('snack 실패');
    },
  };
  const results = await runStories('today_full_batch', '2026-09-18', false, deps);
  assert.deepEqual(results.map(r => r.status), ['published', 'published', 'failed', 'published']);
  assert.equal(coopCalls, 1);
  assert.deepEqual(events, ['today_dormitory_full', 'today_badaro_full', 'today_snack', 'today_teacher_full'].flatMap(mode => [`render:${mode}`, `start:${mode}`, `end:${mode}`]));
});

test('preview는 평일 empty도 렌더하며 publish를 호출하지 않는다', async () => {
  const sections: number[] = [];
  const results = await runStories('today_full_batch', '2026-12-25', true, {
    fetchBadaro: async () => null, fetchDormitory: async () => null, fetchCoop: async () => emptyCoop,
    render: async data => { sections.push(data.sections.length); assert.ok(data.sections.every(s => !s.items.length)); return 'image.jpg'; },
    publish: async () => { assert.fail('미리보기 게시 금지'); },
  });
  assert.deepEqual(sections, [3, 3, 4, 3]);
  assert.ok(results.every(r => r.status === 'preview'));
});

test('주말 학식은 개별/배치 모두 조회·렌더·게시 전 skip', async () => {
  const fail = async (): Promise<never> => { assert.fail('주말 학식 호출 금지'); };
  const results = await runStories('today_snack', '2026-09-19', false, { fetchBadaro: async () => null, fetchDormitory: fail, fetchCoop: fail, render: fail, publish: fail });
  assert.equal(results[0]?.status, 'skipped');
  const batch = await runStories('today_full_batch', '2026-09-19', true, {
    fetchBadaro: async () => null, fetchDormitory: async () => null, fetchCoop: fail, render: async () => 'dorm.jpg', publish: fail,
  });
  assert.deepEqual(batch.map(r => r.status), ['preview', 'preview', 'skipped', 'skipped']);
});

test('학식 조회 실패는 등록된 식단 없음 Story로 게시하지 않는다', async () => {
  const results = await runStories('today_full_batch', '2026-09-18', true, {
    fetchBadaro: async () => null, fetchDormitory: async () => null, fetchCoop: async () => { throw new Error('HTTP 500'); },
    render: async data => { assert.ok(['dormitory', 'badaro'].includes(data.request.restaurant)); return 'image.jpg'; },
    publish: async () => { assert.fail('preview'); },
  });
  assert.deepEqual(results.map(r => r.status), ['preview', 'preview', 'failed', 'failed']);
});

test('실제 게시도 정상 조회의 빈 식단은 네 식당 모두 안내 이미지로 게시한다', async () => {
  const rendered: string[] = [];
  const posted: string[] = [];
  const results = await runStories('today_full_batch', '2026-10-05', false, {
    fetchBadaro: async () => null, fetchDormitory: async () => null, fetchCoop: async () => emptyCoop,
    render: async data => {
      assert.ok(data.sections.every(s => s.items.length === 0));
      rendered.push(data.request.restaurant);
      return 'image.jpg';
    },
    publish: async data => { posted.push(data.request.restaurant); return { mediaId: data.request.restaurant }; },
  });
  assert.deepEqual(posted, ['dormitory', 'badaro', 'snack', 'teacher']);
  assert.deepEqual(rendered, posted);
  assert.ok(results.every(r => r.status === 'published' && r.emptyMenu && !r.stage));
  assert.deepEqual(results.map(r => r.mediaId), posted);
});

test('조회 오류는 실제 게시에서도 빈 식단 안내로 바꾸지 않는다', async () => {
  const fail = async (): Promise<never> => { throw new Error('응답 구조 오류'); };
  const results = await runStories('today_teacher_full', '2026-10-05', false, {
    fetchBadaro: fail, fetchDormitory: fail, fetchCoop: fail,
    render: async () => assert.fail('조회 실패 이미지 생성 금지'),
    publish: async () => assert.fail('조회 실패 게시 금지'),
  });
  assert.equal(results[0]?.status, 'failed');
  assert.equal(results[0]?.stage, 'fetch');
});

test('학식 조회 실패 Promise를 재사용하지 않아 다음 교직원 조회는 복구할 수 있다', async () => {
  let calls = 0;
  const results = await runStories('today_full_batch', '2026-10-05', false, {
    fetchBadaro: async () => null, fetchDormitory: async () => null,
    fetchCoop: async () => { if (++calls === 1) throw new Error('네트워크 장애'); return emptyCoop; },
    render: async () => 'image.jpg', publish: async () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(results.map(r => r.status), ['published', 'published', 'failed', 'published']);
});

test('게시 성공 후 확인 오류는 media ID가 있는 published 경고로 남는다', async () => {
  const results = await runStories('today_teacher_full', '2026-10-05', false, {
    fetchBadaro: async () => null, fetchDormitory: async () => null, fetchCoop: async () => emptyCoop,
    render: async () => 'image.jpg',
    publish: async () => { throw new PublishedStoryError('m1', new Error('verify error')); },
  });
  assert.equal(results[0]?.status, 'published');
  assert.equal(results[0]?.mediaId, 'm1');
  assert.match(results[0]?.warning ?? '', /재게시하지 말고/);
  assert.equal(results[0]?.error, undefined);
});
