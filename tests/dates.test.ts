import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seoulDate, validateDate } from '../src/dates.js';

test('한국 날짜 변환은 자정과 연도 경계를 처리한다', () => {
  assert.equal(seoulDate(new Date('2026-12-31T14:59:59Z')), '2026-12-31');
  assert.equal(seoulDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.throws(() => seoulDate(new Date(NaN)), /유효하지 않은 날짜/);
});

test('날짜 검증은 윤년을 허용하고 날짜 자동 보정을 거부한다', () => {
  assert.equal(validateDate('2028-02-29'), '2028-02-29');
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    assert.throws(() => validateDate(value), /존재하지 않는 날짜/);
  }
  for (const value of ['2026-9-18', '2026/09/18', '2026-09-18T00:00:00Z']) {
    assert.throws(() => validateDate(value), /YYYY-MM-DD/);
  }
});
