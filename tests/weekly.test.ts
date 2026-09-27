import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyRange, weeklyCaption, createWeeklyFetcher, type WeeklyData, type WeeklyKind } from '../src/weekly-data.js';
import { runWeekly, type WeeklyDependencies } from '../src/run-weekly.js';
import { postWeekly, publishedWeekly, type WeeklyRecord } from '../src/post-weekly.js';
import { coopMenu, emptyCoop } from './fixtures.js';

const range = weeklyRange('2026-09-20');
function data(kind: WeeklyKind = 'combined'): WeeklyData { return { kind, week: range.week, monday: range.monday, pages: [], caption: 'caption' }; }
test('following calendar week and ISO year/week boundaries', () => {
  assert.equal(range.monday, '2026-09-21'); assert.equal(range.week, '2026-W39');
  assert.equal(range.dates.at(-1), '2026-09-27');
  assert.equal(weeklyRange('2026-09-21').monday, '2026-09-28');
  assert.equal(weeklyRange('2026-12-27').week, '2026-W53');
  assert.equal(weeklyRange('2027-01-03').week, '2027-W01');
  assert.equal(weeklyRange('2026-01-01', '2026-W01').monday, '2025-12-29');
  for (const week of ['2025-W53', '2026-W00', '2026-W54', '2026-W1']) assert.throws(() => weeklyRange('2026-01-01', week));
  assert.throws(() => weeklyRange('2026-02-30'));
});
test('captions use actual ranges, kind hashtags and year rollover', () => {
  assert.equal(weeklyCaption('dormitory', range.dates), '2026년 9월 21일 ~ 9월 27일 기숙사 식단입니다.\n\n#해양대학교 #해양대기숙사');
  assert.equal(weeklyCaption('combined', range.dates.slice(0, 5)), '2026년 9월 21일 ~ 9월 25일 학식 및 교직원 식당 식단입니다.\n\n#해양대학교 #해양대학식 #해양대교직원식당');
  assert.match(weeklyCaption('badaro', range.dates), /#해양대승선생활관$/);
  assert.match(weeklyCaption('dormitory', weeklyRange('2026-12-27').dates), /2026년 12월 28일 ~ 2027년 1월 3일/);
});
test('weekly fetch preserves all cells, uses 5/7 days and shares coop responses', async () => {
  const calls: string[] = [];
  const fetcher = createWeeklyFetcher({
    dormitory: async date => { calls.push(`d:${date}`); return null; },
    badaro: async date => { calls.push(`b:${date}`); return { date: String(date), breakfast: ['승선 조식'], lunch: ['승선 중식'], dinner: ['승선 석식'] }; },
    coop: async date => { calls.push(`c:${date}`); return date === range.monday ? emptyCoop : coopMenu; },
  });
  const combined = await fetcher('combined', range);
  const [snack, teacher] = combined.pages;
  const dorm = (await fetcher('dormitory', range)).pages[0]!;
  const badaro = (await fetcher('badaro', range)).pages[0]!;
  assert.equal(calls.filter(call => call.startsWith('c:')).length, 5);
  assert.equal(calls.filter(call => call.startsWith('d:')).length, 7);
  assert.equal(calls.filter(call => call.startsWith('b:')).length, 7);
  assert.deepEqual(combined.pages.map(page => page.kind), ['snack', 'teacher']);
  assert.equal(teacher!.days.length, 5); assert.equal(dorm.days.length, 7);
  assert.deepEqual(teacher!.days[0]!.sections.map(section => section.label), ['Breakfast', 'Lunch', 'Dinner']);
  assert.deepEqual(snack!.days[0]!.sections.map(section => section.key), ['snack', 'set-meal']);
  assert.deepEqual(badaro.days[0]!.sections[0]!.items, ['승선 조식']);
  assert.ok(dorm.days.every(day => day.sections.length === 3 && day.sections.every(section => !section.items.length)));
});
test('API errors propagate instead of becoming empty menu data', async () => {
  const fetcher = createWeeklyFetcher({ badaro: async () => { throw new Error('badaro network'); }, dormitory: async () => { throw new Error('network'); }, coop: async () => { throw new Error('parser'); } });
  await assert.rejects(fetcher('combined', range), /parser/);
  await assert.rejects(fetcher('badaro', range), /badaro network/);
  await assert.rejects(fetcher('dormitory', range), /network/);
});
function runDeps(events: string[]): WeeklyDependencies {
  return {
    fetch: async kind => { events.push(`fetch:${kind}`); return data(kind); },
    render: async value => { events.push(`render:${value.kind}`); return { images: ['image.jpg'] }; },
    published: async (_, kind) => { events.push(`lookup:${kind}`); return undefined; },
    post: async value => { events.push(`post:${value.kind}`); return { mediaId: 'id', skipped: false }; },
  };
}
test('sequential feed order, normal dedup and force override', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.published = async (_, kind) => kind === 'combined' ? 'old' : undefined;
  const results = await runWeekly(range, 'all', false, false, deps);
  assert.deepEqual(results.map(result => result.status), ['skipped', 'published', 'published']);
  assert.deepEqual(events.filter(value => value.startsWith('post:')), ['post:badaro', 'post:dormitory']);
  events.length = 0;
  await runWeekly(range, 'combined', false, true, deps);
  assert.deepEqual(events, ['fetch:combined', 'render:combined', 'post:combined']);
});
test('preview never initializes posting or dedup storage, even with force', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.published = deps.post = async () => { throw new Error('must not call'); };
  const results = await runWeekly(range, 'all', true, true, deps);
  assert.equal(results.length, 3);
});
test('failed feed stops later feeds', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.post = async value => { events.push(`post:${value.kind}`); if (value.kind === 'badaro') throw new Error('failed'); return { mediaId: 'id', skipped: false }; };
  const results = await runWeekly(range, 'all', false, false, deps);
  assert.deepEqual(results.map(result => result.status), ['published', 'failed']);
  assert.ok(!events.some(event => event.includes('dormitory')));
});

test('실제 주간 게시에서 빈 날짜는 렌더와 게시 전에 실패한다', async () => {
  const deps = runDeps([]);
  deps.fetch = async kind => ({ ...data(kind), pages: [{ kind: 'badaro', days: [
    { date: range.monday, sections: [{ key: 'breakfast', label: 'Breakfast', items: [] }] },
  ] }] });
  deps.render = async () => assert.fail('빈 주간 식단 렌더 금지');
  const result = await runWeekly(range, 'badaro', false, false, deps);
  assert.equal(result[0]?.status, 'failed');
  assert.match(result[0]?.error ?? '', /게시할 식단이 없습니다/);
});
function services() {
  const records = new Map<string, unknown>(); const events: string[] = [];
  const storage = {
    readWeeklyJson: async (path: string) => records.get(path),
    writeWeeklyJson: async (path: string, record: unknown, upsert = true) => {
      if (!upsert && records.has(path)) throw new Error('lock conflict');
      records.set(path, structuredClone(record)); events.push(`save:${path}`);
    },
    removeWeeklyLock: async (path: string) => { records.delete(`${path}/lock.json`); },
    uploadImage: async () => 'https://example.com/image.jpg',
  };
  const instagram = {
    publishFeed: async (_urls: string[], _caption: string, onContainer: (id: string) => Promise<void>, beforePublish: () => Promise<void>) => {
      await onContainer('container'); await beforePublish(); events.push('publish'); return 'media';
    },
    verifyFeed: async () => { events.push('verify'); },
  };
  return { records, events, storage, instagram };
}
test('success marker is written after publish; rerun skips; force republishes', async () => {
  const s = services();
  const first = await postWeekly(data(), ['a', 'b'], false, s.storage, s.instagram, async () => {});
  assert.equal(first.mediaId, 'media');
  assert.ok(s.events.indexOf('publish') < s.events.indexOf(`save:${range.week}/combined/success.json`));
  const again = await postWeekly(data(), ['a', 'b'], false, s.storage, s.instagram, async () => {});
  assert.equal(again.skipped, true);
  assert.equal(s.events.filter(event => event === 'publish').length, 1);
  await postWeekly(data(), ['a', 'b'], true, s.storage, s.instagram, async () => {});
  assert.equal(s.events.filter(event => event === 'publish').length, 2);
});
test('concurrent lock prevents duplicate publishing', async () => {
  const s = services(); s.records.set(`${range.week}/combined/lock.json`, { runId: 'another' });
  await assert.rejects(postWeekly(data(), ['a', 'b'], true, s.storage, s.instagram, async () => {}), /lock conflict/);
  assert.ok(!s.events.includes('publish'));
});
test('ambiguous publish failure retains lock and never writes success', async () => {
  const s = services();
  s.instagram.publishFeed = async (_urls, _caption, onContainer, beforePublish) => { await onContainer('id'); await beforePublish(); throw new Error('connection reset'); };
  await assert.rejects(postWeekly(data(), ['a', 'b'], false, s.storage, s.instagram, async () => {}), /connection reset/);
  assert.ok(s.records.has(`${range.week}/combined/lock.json`));
  assert.equal(await publishedWeekly(s.storage, range.week, 'combined'), undefined);
});
test('upload failure releases lock; post-publish verification failure preserves success', async () => {
  const s = services();
  const badUpload = { ...s.storage, uploadImage: async () => { throw new Error('upload'); } };
  await assert.rejects(postWeekly(data(), ['a', 'b'], false, badUpload, s.instagram, async () => {}), /upload/);
  assert.ok(!s.records.has(`${range.week}/combined/lock.json`));
  s.instagram.verifyFeed = async () => { throw new Error('verification'); };
  await assert.rejects(postWeekly(data(), ['a', 'b'], false, s.storage, s.instagram, async () => {}), /verification/);
  assert.equal(await publishedWeekly(s.storage, range.week, 'combined'), 'media');
  assert.ok(!s.records.has(`${range.week}/combined/lock.json`));
});
test('success save failure retains media ID and lock for reconciliation', async () => {
  const s = services(); const saved: WeeklyRecord[] = [];
  const storage = { ...s.storage, writeWeeklyJson: async (path: string, record: unknown, upsert = true) => {
    if (path.endsWith('/success.json')) throw new Error('storage outage');
    await s.storage.writeWeeklyJson(path, record, upsert);
  } };
  await assert.rejects(postWeekly(data(), ['a', 'b'], false, storage, s.instagram, async record => { saved.push(record); }), /storage outage/);
  assert.equal(saved.at(-1)?.mediaId, 'media');
  assert.equal(saved.at(-1)?.status, 'published');
  assert.ok(s.records.has(`${range.week}/combined/lock.json`));
});
test('corrupted success records fail closed', async () => {
  const s = services(); s.records.set(`${range.week}/combined/success.json`, { status: 'failed', mediaId: 'oops' });
  await assert.rejects(publishedWeekly(s.storage, range.week, 'combined'), /올바르지/);
});
