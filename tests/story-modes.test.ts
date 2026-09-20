import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_MODES, BATCH_MODES, parseRunMode, resolveStoryRequest, resolveRun, resolveWorkflowMode, resolveBatchMode, resolveManualStoryMode } from '../src/story-modes.js';

test('26개 Story mode의 날짜/식당/끼니가 정확하다', () => {
  assert.equal(STORY_MODES.length, 26);
  for (const mode of STORY_MODES) {
    const r = resolveStoryRequest(mode, '2026-09-17');
    assert.equal(r.targetDate, mode.startsWith('tomorrow') ? '2026-09-18' : '2026-09-17');
    assert.equal(r.restaurant, mode.includes('dormitory') ? 'dormitory' : mode.includes('badaro') ? 'badaro' : mode.includes('teacher') ? 'teacher' : 'snack');
    assert.equal(r.scope, mode.endsWith('breakfast') ? 'breakfast' : mode.endsWith('lunch') ? 'lunch' : mode.endsWith('dinner') ? 'dinner' : 'full');
    assert.equal(r.skip, false);
  }
  assert.equal(resolveStoryRequest('tomorrow_snack', '2026-12-31').targetDate, '2027-01-01');
  assert.throws(() => resolveStoryRequest('tomorrow_snack', '2026-02-30'), /존재하지 않는/);
  assert.throws(() => parseRunMode('invalid'), /지원하지 않는/);
});

const cases = [
  ['today_full_batch', '2026-09-18', ['today_dormitory_full', 'today_snack', 'today_teacher_full', 'today_badaro_full']],
  ['today_full_batch', '2026-09-19', ['today_dormitory_full', 'today_badaro_full']],
  ['today_full_batch', '2026-09-20', ['today_dormitory_full', 'today_badaro_full']],
] as const;
for (const [mode, date, expected] of cases) test(`${date} ${mode}: 대상 날짜 기준 배치 순서`, () => {
  assert.deepEqual(resolveRun(mode, date).filter(r => !r.skip).map(r => r.mode), expected);
});
test('평일 공휴일도 skip하지 않는다; 주말 개별 학식도 skip한다', () => {
  assert.equal(resolveStoryRequest('today_snack', '2026-12-25').skip, false);
  assert.equal(resolveStoryRequest('today_teacher_full', '2026-09-19').skip, true);
  assert.equal(resolveStoryRequest('today_snack', '2026-09-20').skip, true);
});

test('기본 모드와 개별 모드 해석', () => {
  assert.equal(resolveWorkflowMode('today_teacher_full'), 'today_teacher_full');
  assert.equal(resolveWorkflowMode(), 'today_full_batch');
});

test('Manual 선택의 모든 조합은 26개 모드로 해석하고 자동 Batch는 오늘 전체만 허용한다', () => {
  const modes = new Set<string>();
  for (const day of ['today', 'tomorrow']) {
    for (const restaurant of ['dormitory', 'badaro', 'snack', 'teacher']) {
      for (const meal of ['breakfast', 'lunch', 'dinner', 'full']) {
        const mode = resolveManualStoryMode(day, restaurant, meal);
        assert.equal(mode, restaurant === 'snack' ? `${day}_snack` : `${day}_${restaurant}_${meal}`);
        modes.add(mode);
      }
    }
  }
  assert.deepEqual([...modes].sort(), [...STORY_MODES].sort());
  for (const mode of BATCH_MODES) assert.equal(resolveBatchMode(mode), mode);
  for (const mode of STORY_MODES) assert.throws(() => resolveBatchMode(mode), /배치/);
  assert.throws(() => resolveManualStoryMode('yesterday', 'dormitory', 'full'));
  assert.throws(() => resolveManualStoryMode('today', 'other', 'full'));
  assert.throws(() => resolveManualStoryMode('today', 'snack', 'other'));
});

test('조식도 대상일 주말/공휴일 규칙을 따른다', () => {
  assert.equal(resolveStoryRequest('tomorrow_teacher_breakfast', '2026-09-18').skip, true);
  assert.equal(resolveStoryRequest('tomorrow_dormitory_breakfast', '2026-09-18').skip, false);
  assert.equal(resolveStoryRequest('tomorrow_teacher_breakfast', '2026-09-20').skip, false);
  assert.equal(resolveStoryRequest('today_teacher_breakfast', '2026-12-25').skip, false);
});
