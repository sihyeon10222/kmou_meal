import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storySummary } from '../src/story-summary.js';

test('Actions Summary는 정상 빈 식단, 실패 단계, 게시 성공 후 경고를 구분한다', () => {
  const summary = storySummary([
    { mode: 'today_teacher_full', targetDate: '2026-10-05', status: 'published', emptyMenu: true },
    { mode: 'today_snack', targetDate: '2026-10-05', status: 'failed', stage: 'fetch', error: '<error>|\nHTTP 503' },
    { mode: 'today_badaro_full', targetDate: '2026-10-05', status: 'published', mediaId: 'm1', warning: '게시 성공 (m1), 확인 실패' },
  ]);
  assert.match(summary, /정상 조회: 등록된 식단 없음 안내/);
  assert.match(summary, /fetch: &lt;error&gt;&#124; HTTP 503/);
  assert.match(summary, /published \(경고\)/);
  assert.match(summary, /실패한 식당만/);
});

test('AI 음식 사진 오류는 게시 경고 대신 끼니별 별도 상세로 남는다', () => {
  const summary = storySummary([{ mode: 'today_dormitory_full', targetDate: '2026-10-08', status: 'published', mediaId: 'm1',
    aiImages: [{ meal: 'breakfast', status: 'cached' }, { meal: 'lunch', status: 'generated' },
      { meal: 'dinner', status: 'failed', error: 'HTTP 401' }],
  }]);
  assert.match(summary, /breakfast=cached, lunch=generated, dinner=failed \(HTTP 401\)/);
  assert.ok(!summary.includes('published (경고)'));
});
