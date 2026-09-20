import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStoryOptions } from '../src/story-options.js';
import { createPublishingServices } from '../src/publishing-services.js';

test('CLI values override environment while preview remains explicit', () => {
  const env = { RUN_MODE: 'today_snack', BASE_DATE: '2026-09-21' };
  const args = ['--preview', 'today_dormitory_full', '2026-09-18'];
  assert.deepEqual(parseStoryOptions(args, env), {
    mode: 'today_dormitory_full', baseDate: '2026-09-18', preview: true,
  });
  assert.equal(args[0], '--preview');
  assert.deepEqual(parseStoryOptions([], env), { mode: 'today_snack', baseDate: '2026-09-21', preview: false });
  assert.equal(parseStoryOptions([], { BASE_DATE: '2026-09-21' }).mode, 'today_full_batch');
  assert.throws(() => parseStoryOptions(['today_full_batch', '2026-02-30'], {}));
  assert.throws(() => parseStoryOptions(['today_full_batch', '2026-09-21', 'extra'], {}));
  assert.throws(() => parseStoryOptions(['today_lunch_batch'], {}));
});

test('publishing initialization is lazy and its failure is shared across callers', async () => {
  let calls = 0;
  const error = new Error('account blocked');
  const getServices = createPublishingServices(async () => { calls++; throw error; });
  assert.equal(calls, 0);
  const first = getServices();
  const second = getServices();
  assert.equal(first, second);
  await assert.rejects(first, e => e === error);
  await assert.rejects(getServices(), e => e === error);
  assert.equal(calls, 1);
});
