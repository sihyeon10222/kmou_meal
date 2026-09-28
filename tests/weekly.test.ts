import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyRange, weeklyCaption, createWeeklyFetcher, type WeeklyData, type WeeklyKind } from '../src/weekly-data.js';
import { runWeekly, type WeeklyDependencies } from '../src/run-weekly.js';
import { markWeeklySourceEmpty, postWeekly, publishedWeekly, type WeeklyRecord } from '../src/post-weekly.js';
import { coopMenu, emptyCoop } from './fixtures.js';
import { publishableWeekly, weeklyMenuHash } from '../src/weekly-snapshot.js';
import { notifyWeeklyReplacements } from '../src/weekly-notifications.js';

const range = weeklyRange('2026-09-20');
function data(kind: WeeklyKind = 'combined'): WeeklyData {
  const page = (pageKind: WeeklyData['pages'][number]['kind']) => ({ kind: pageKind, days: [
    { date: range.monday, sections: [{ key: 'lunch', label: 'Lunch', items: ['비빔밥'] }] },
  ] });
  return { kind, week: range.week, monday: range.monday,
    pages: kind === 'combined' ? [page('snack'), page('teacher')] : [page(kind)], caption: 'caption' };
}
function oldRecord(kind: WeeklyKind, mediaId = 'old'): WeeklyRecord {
  return { week: range.week, kind, runId: 'legacy', status: 'published', startedAt: '2026-09-20T00:00:00Z',
    containerIds: [], images: [], caption: 'caption', mediaId };
}
test('current week Monday–Saturday, following week Sunday, and ISO boundaries', () => {
  assert.equal(range.monday, '2026-09-21'); assert.equal(range.week, '2026-W39');
  assert.equal(range.dates.at(-1), '2026-09-27');
  for (const date of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) {
    assert.equal(weeklyRange(date).monday, '2026-09-21');
  }
  assert.equal(weeklyRange('2026-09-27').monday, '2026-09-28');
  assert.equal(weeklyRange('2026-09-28').monday, '2026-09-28');
  assert.equal(weeklyRange('2026-12-31').week, '2026-W53');
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
  deps.published = async (_, kind) => kind === 'combined' ? oldRecord(kind) : undefined;
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
test('failed feed does not stop later feeds; rerun skips published kinds', async () => {
  const events: string[] = []; const deps = runDeps(events);
  const published = new Map<WeeklyKind, WeeklyRecord>();
  let badaroReady = false;
  deps.published = async (_, kind) => published.get(kind);
  deps.post = async value => {
    events.push(`post:${value.kind}`);
    if (value.kind === 'badaro' && !badaroReady) throw new Error('failed');
    published.set(value.kind, { ...oldRecord(value.kind, 'id'), menuHash: weeklyMenuHash(value) });
    return { mediaId: 'id', skipped: false };
  };
  const first = await runWeekly(range, 'all', false, false, deps);
  assert.deepEqual(first.map(result => result.status), ['published', 'failed', 'published']);
  events.length = 0;
  badaroReady = true;
  const second = await runWeekly(range, 'all', false, false, deps);
  assert.deepEqual(second.map(result => result.status), ['skipped', 'published', 'skipped']);
  assert.deepEqual(events, ['fetch:combined', 'fetch:badaro', 'render:badaro', 'post:badaro', 'fetch:dormitory']);
});

test('메뉴가 전혀 없으면 해당 게시물만 대기한다', async () => {
  const deps = runDeps([]);
  deps.fetch = async kind => ({ ...data(kind), pages: [{ kind: 'badaro', days: [
    { date: range.monday, sections: [{ key: 'breakfast', label: 'Breakfast', items: [] }] },
  ] }] });
  deps.render = async () => assert.fail('빈 주간 식단 렌더 금지');
  const result = await runWeekly(range, 'badaro', false, false, deps);
  assert.equal(result[0]?.status, 'deferred');
});
test('통합 게시물은 메뉴 있는 식당 한 장만 올리고 다른 두 게시물도 처리한다', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.fetch = async kind => kind === 'combined'
    ? { ...data(kind), pages: [
      { kind: 'snack', days: [{ date: '2026-10-02', sections: [{ key: 'snack', label: '분식코너', items: [] }] }] },
      { kind: 'teacher', days: [{ date: '2026-10-02', sections: [{ key: 'lunch', label: '중식', items: ['백반'] }] }] },
    ] } : data(kind);
  const result = await runWeekly(range, 'all', false, false, deps);
  assert.deepEqual(result.map(item => item.status), ['published', 'published', 'published']);
  assert.deepEqual(events.filter(event => event.startsWith('post:')), ['post:combined', 'post:badaro', 'post:dormitory']);
  const prepared = publishableWeekly(await deps.fetch('combined', range));
  assert.deepEqual(prepared?.pages.map(page => page.kind), ['teacher']);
  assert.match(prepared?.caption ?? '', /교직원 식당 식단/);
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
  assert.equal((await publishedWeekly(s.storage, range.week, 'combined'))?.mediaId, 'media');
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

test('normalized menu changes trigger replacement but whitespace does not', async () => {
  const s = services(); let next = 0;
  s.instagram.publishFeed = async (_urls, _caption, onContainer, beforePublish) => {
    await onContainer('container'); await beforePublish(); return `media-${++next}`;
  };
  const first = data('combined');
  const firstResult = await postWeekly(first, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  assert.equal(firstResult.mediaId, 'media-1');
  const whitespace = structuredClone(first);
  whitespace.pages[0]!.days[0]!.sections[0]!.items[0] = ' 비빔밥  ';
  assert.equal(weeklyMenuHash(first), weeklyMenuHash(whitespace));
  assert.equal((await postWeekly(whitespace, ['a', 'b'], false, s.storage, s.instagram, async () => {})).skipped, true);
  const added = structuredClone(first);
  added.pages[0]!.days[0]!.sections[0]!.items.push('국');
  const second = await postWeekly(added, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  assert.equal(second.replacedMediaId, 'media-1');
  const edited = structuredClone(added);
  edited.pages[0]!.days[0]!.sections[0]!.items[0] = '볶음밥';
  await postWeekly(edited, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  const removed = structuredClone(edited);
  removed.pages[0]!.days[0]!.sections[0]!.items.pop();
  await postWeekly(removed, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  const saved = await publishedWeekly(s.storage, range.week, 'combined');
  assert.equal(saved?.mediaId, 'media-4');
  assert.deepEqual(saved?.supersededMediaIds, ['media-1', 'media-2', 'media-3']);
  assert.equal(saved?.pendingNotifications?.length, 3);
});

test('single restaurant feed is replaced by two-page carousel when other restaurant appears', async () => {
  const s = services(); let next = 0;
  s.instagram.publishFeed = async (urls, _caption, onContainer, beforePublish) => {
    assert.equal(urls.length, ++next);
    await onContainer('container'); await beforePublish(); return `media-${next}`;
  };
  const one = publishableWeekly({ ...data('combined'), pages: [
    data('combined').pages[0]!,
    { kind: 'teacher', days: [{ date: range.monday, sections: [{ key: 'lunch', label: 'Lunch', items: [] }] }] },
  ] })!;
  assert.equal(one.pages.length, 1);
  await postWeekly(one, ['a'], false, s.storage, s.instagram, async () => {});
  const two = publishableWeekly(data('combined'))!;
  const result = await postWeekly(two, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  assert.equal(result.replacedMediaId, 'media-1');
  assert.equal(result.mediaId, 'media-2');
});

test('replacement notification retries without reposting or duplicating issue comment', async () => {
  const s = services();
  const notice = { runId: 'revision-2', week: range.week, kind: 'combined' as const, oldMediaId: 'old', newMediaId: 'new' };
  s.records.set(`${range.week}/combined/success.json`, { ...oldRecord('combined', 'new'), pendingNotifications: [notice] });
  const original = globalThis.fetch;
  const comments: string[] = []; let failComment = true;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/issues?')) return Response.json([{ number: 7, title: 'KMOU 주간 게시물 교체 알림' }]);
    if (url.includes('/issues/7/comments') && method === 'GET') return Response.json(comments.map(body => ({ body })));
    if (url.includes('/issues/7/comments') && method === 'POST') {
      if (failComment) { failComment = false; return Response.json({}, { status: 503 }); }
      comments.push(JSON.parse(String(init?.body)).body); return Response.json({ id: 1 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  try {
    await assert.rejects(notifyWeeklyReplacements(s.storage, range.week, ['combined'], 'token', 'owner/repo'));
    assert.equal((await publishedWeekly(s.storage, range.week, 'combined'))?.pendingNotifications?.length, 1);
    await notifyWeeklyReplacements(s.storage, range.week, ['combined'], 'token', 'owner/repo');
    assert.equal(comments.length, 1);
    assert.match(comments[0]!, /@sihyeon10222/);
    assert.equal((await publishedWeekly(s.storage, range.week, 'combined'))?.pendingNotifications?.length, 0);
    await notifyWeeklyReplacements(s.storage, range.week, ['combined'], 'token', 'owner/repo');
    assert.equal(comments.length, 1);
  } finally { globalThis.fetch = original; }
});

test('all menus removed after publication queues one manual removal notice', async () => {
  const s = services();
  await postWeekly(data('badaro'), ['a', 'b'], false, s.storage, s.instagram, async () => {});
  await markWeeklySourceEmpty(s.storage, range.week, 'badaro');
  await markWeeklySourceEmpty(s.storage, range.week, 'badaro');
  const saved = await publishedWeekly(s.storage, range.week, 'badaro');
  assert.equal(saved?.sourceEmptyNotified, true);
  assert.equal(saved?.pendingNotifications?.length, 1);
  assert.equal(saved?.pendingNotifications?.[0]?.newMediaId, undefined);
});
