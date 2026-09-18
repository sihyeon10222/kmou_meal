import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStories, type RunDependencies } from '../src/run-stories.js';
import { emptyCoop } from './fixtures.js';

test('순차 게시와 중간 실패 후 계속 처리, 학식은 한 번만 조회', async () => {
  const events: string[] = [];
  let coopCalls = 0;
  const deps: RunDependencies = {
    fetchDormitory: async () => null,
    fetchCoop: async () => { coopCalls++; return emptyCoop; },
    render: async data => { events.push(`render:${data.request.mode}`); return 'image.jpg'; },
    publish: async data => {
      events.push(`start:${data.request.mode}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      events.push(`end:${data.request.mode}`);
      if (data.request.restaurant === 'snack') throw new Error('snack 실패');
    },
  };
  const results = await runStories('today_lunch_batch', '2026-09-18', false, deps);
  assert.deepEqual(results.map(r => r.status), ['published', 'failed', 'published']);
  assert.equal(coopCalls, 1);
  assert.deepEqual(events, ['today_dormitory_lunch', 'today_snack', 'today_teacher_lunch'].flatMap(mode => [`render:${mode}`, `start:${mode}`, `end:${mode}`]));
});

test('preview는 평일 empty도 렌더하며 publish를 호출하지 않는다', async () => {
  const sections: number[] = [];
  const results = await runStories('tomorrow_full_batch', '2026-12-24', true, {
    fetchDormitory: async () => null, fetchCoop: async () => emptyCoop,
    render: async data => { sections.push(data.sections.length); assert.ok(data.sections.every(s => !s.items.length)); return 'image.jpg'; },
    publish: async () => { assert.fail('미리보기 게시 금지'); },
  });
  assert.deepEqual(sections, [2, 4, 3]);
  assert.ok(results.every(r => r.status === 'preview'));
});

test('주말 학식은 개별/배치 모두 조회·렌더·게시 전 skip', async () => {
  const fail = async (): Promise<never> => { assert.fail('주말 학식 호출 금지'); };
  const results = await runStories('today_snack', '2026-09-19', false, { fetchDormitory: fail, fetchCoop: fail, render: fail, publish: fail });
  assert.equal(results[0]?.status, 'skipped');
  const batch = await runStories('tomorrow_full_batch', '2026-09-18', true, {
    fetchDormitory: async () => null, fetchCoop: fail, render: async () => 'dorm.jpg', publish: fail,
  });
  assert.deepEqual(batch.map(r => r.status), ['preview', 'skipped', 'skipped']);
});

test('학식 조회 실패는 메뉴 없음 Story로 게시하지 않는다', async () => {
  const results = await runStories('today_lunch_batch', '2026-09-18', true, {
    fetchDormitory: async () => null, fetchCoop: async () => { throw new Error('HTTP 500'); },
    render: async data => { assert.equal(data.request.restaurant, 'dormitory'); return 'image.jpg'; },
    publish: async () => { assert.fail('preview'); },
  });
  assert.deepEqual(results.map(r => r.status), ['preview', 'failed', 'failed']);
});
