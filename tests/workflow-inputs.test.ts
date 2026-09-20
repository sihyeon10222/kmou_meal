import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function resolveWorkflow(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/resolve-workflow-mode.ts'], {
    encoding: 'utf8',
    env: {
      ...process.env, INPUT_KIND: '', INPUT_MODE: '', INPUT_DAY: '', INPUT_RESTAURANT: '',
      INPUT_MEAL: '', INPUT_BASE_DATE: '', ...env,
    },
  });
}

test('daily cron batch resolves to today full without a base date', () => {
  const result = resolveWorkflow({ INPUT_KIND: 'batch', INPUT_MODE: 'today_full_batch' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'today_full_batch');
});

test('manual breakfast and snack selections resolve before any posting work', () => {
  for (const restaurant of ['dormitory', 'teacher', 'snack']) {
    const result = resolveWorkflow({
      INPUT_KIND: 'manual', INPUT_DAY: 'tomorrow', INPUT_RESTAURANT: restaurant,
      INPUT_MEAL: 'breakfast', INPUT_BASE_DATE: '2026-09-18',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), restaurant === 'snack' ? 'tomorrow_snack' : `tomorrow_${restaurant}_breakfast`);
  }
});

test('invalid dates and incompatible workflow inputs fail without an output mode', () => {
  for (const env of [
    { INPUT_KIND: 'batch', INPUT_MODE: 'today_full_batch', INPUT_BASE_DATE: '2026-02-30' },
    { INPUT_KIND: 'batch', INPUT_MODE: 'today_lunch_batch' },
    { INPUT_KIND: 'batch', INPUT_MODE: 'today_teacher_breakfast' },
    { INPUT_KIND: 'manual', INPUT_DAY: 'today', INPUT_RESTAURANT: 'teacher', INPUT_MEAL: 'invalid' },
  ]) {
    const result = resolveWorkflow(env);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});
