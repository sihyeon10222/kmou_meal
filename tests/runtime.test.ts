import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliOptions } from '../src/cli-options.js';
import { createPublishingServices } from '../src/publishing-services.js';

test('simple CLI resolves exact date and restaurant without exposing Story mode names', () => {
  assert.deepEqual(parseCliOptions(['story', '--preview', '--restaurant', 'dormitory', '--date', '2026-09-18']), {
    command: 'story', mode: 'today_dormitory_full', baseDate: '2026-09-18', preview: true,
  });
  const batch = parseCliOptions(['story', '--date', '2026-09-21']);
  assert.equal(batch.command === 'story' && batch.mode, 'today_full_batch');
  assert.equal(batch.preview, false);
  const feed = parseCliOptions(['feed', '--preview', '--date', '2026-09-20']);
  assert.equal(feed.command === 'feed' && feed.range.monday, '2026-09-21');
  assert.equal(feed.command === 'feed' && feed.restaurant, 'all');
  for (const restaurant of ['combined', 'badaro', 'dormitory']) {
    const selected = parseCliOptions(['feed', '--restaurant', restaurant, '--preview', '--week', '2026-W39', '--force']);
    assert.equal(selected.command === 'feed' && selected.restaurant, restaurant);
    assert.equal(selected.command === 'feed' && selected.force, true);
  }
  for (const args of [
    ['story', '--date', '2026-02-30'], ['story', 'today_full_batch'],
    ['story', '--meal', 'lunch'], ['story', '--force'], ['feed', '--meal', 'lunch'],
    ['feed', '--date', '2026-09-20', '--week', '2026-W39'],
    ['feed', '--restaurant', 'teacher'], ['feed', '--restaurant', 'snack'],
    ['story', '--restaurant', 'badaro'], ['story', '--restaurant', 'combined'],
  ]) assert.throws(() => parseCliOptions(args));
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
