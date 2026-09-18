import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_MODES, parseRunMode, resolveStoryRequest, resolveRun, resolveWorkflowMode } from '../src/story-modes.js';

test('14개 Story mode의 날짜/식당/끼니가 정확하다', () => {
  assert.equal(STORY_MODES.length, 14);
  for (const mode of STORY_MODES) {
    const r = resolveStoryRequest(mode, '2026-09-17');
    assert.equal(r.targetDate, mode.startsWith('tomorrow') ? '2026-09-18' : '2026-09-17');
    assert.equal(r.restaurant, mode.includes('dormitory') ? 'dormitory' : mode.includes('teacher') ? 'teacher' : 'snack');
    assert.equal(r.scope, mode.endsWith('lunch') ? 'lunch' : mode.endsWith('dinner') ? 'dinner' : 'full');
    assert.equal(r.skip, false);
  }
  assert.equal(resolveStoryRequest('tomorrow_snack', '2026-12-31').targetDate, '2027-01-01');
  assert.throws(() => resolveStoryRequest('tomorrow_snack', '2026-02-30'), /존재하지 않는/);
  assert.throws(() => parseRunMode('invalid'), /지원하지 않는/);
});

const cases = [
  ['today_lunch_batch', '2026-09-18', ['today_dormitory_lunch', 'today_snack', 'today_teacher_lunch']],
  ['today_dinner_batch', '2026-09-18', ['today_dormitory_dinner', 'today_teacher_dinner']],
  ['tomorrow_full_batch', '2026-09-17', ['tomorrow_dormitory_full', 'tomorrow_snack', 'tomorrow_teacher_full']],
  ['today_lunch_batch', '2026-09-19', ['today_dormitory_lunch']],
  ['today_dinner_batch', '2026-09-19', ['today_dormitory_dinner']],
  ['tomorrow_full_batch', '2026-09-18', ['tomorrow_dormitory_full']],
  ['tomorrow_full_batch', '2026-09-20', ['tomorrow_dormitory_full', 'tomorrow_snack', 'tomorrow_teacher_full']],
] as const;
for (const [mode, date, expected] of cases) test(`${date} ${mode}: 대상 날짜 기준 배치 순서`, () => {
  assert.deepEqual(resolveRun(mode, date).filter(r => !r.skip).map(r => r.mode), expected);
});
test('평일 공휴일도 skip하지 않는다; 주말 개별 학식도 skip한다', () => {
  assert.equal(resolveStoryRequest('today_snack', '2026-12-25').skip, false);
  assert.equal(resolveStoryRequest('today_teacher_full', '2026-09-19').skip, true);
  assert.equal(resolveStoryRequest('today_snack', '2026-09-20').skip, true);
});

test('기존 cron 요청은 새 batch로 전환하고 새 개별 모드는 그대로 실행', () => {
  assert.equal(resolveWorkflowMode('today_teacher_full'), 'today_teacher_full');
});
