import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weeklyRange, weeklyCaption, createWeeklyFetcher, type WeeklyData, type WeeklyKind } from '../src/weekly-data.js';
import { runWeekly, type WeeklyDependencies } from '../src/run-weekly.js';
import { postWeekly as postWeeklyRaw, publishedWeekly, type WeeklyRecord } from '../src/post-weekly.js';
import { coopMenu, emptyCoop } from './fixtures.js';
import { publishableWeekly, weeklyMenuHash, prepareWeekly, hasFutureAddition } from '../src/weekly-snapshot.js';
import { notifyWeeklyReplacements } from '../src/weekly-notifications.js';
import { fastMenuRetries } from './helpers/menu-retries.js';

const today = '2026-09-20';
const range = weeklyRange('2026-09-20');
function data(kind: WeeklyKind = 'combined'): WeeklyData {
  const page = (pageKind: WeeklyData['pages'][number]['kind']) => ({ kind: pageKind, days: [
    { date: range.monday, sections: [{ key: 'lunch', label: 'Lunch', items: ['비빔밥'] }] },
  ] });
  return { kind, week: range.week, monday: range.monday,
    pages: kind === 'combined' ? [page('snack'), page('teacher')] : [page(kind)], caption: 'caption' };
}
async function runWeeklyAt(...args: Parameters<typeof runWeekly>) {
  const [targetRange, kind, preview, force, deps, date = today] = args;
  return runWeekly(targetRange, kind, preview, force, deps, date);
}
async function postWeekly(...args: Parameters<typeof postWeeklyRaw>) {
  const [input, images, force, storage, instagram, receipt] = args;
  const date = args[6] ?? today;
  const old = await publishedWeekly(storage, input.week, input.kind);
  const prepared = prepareWeekly(input, old?.menuSnapshot, date, !!old)!;
  return postWeeklyRaw(prepared, images, force, storage, instagram, receipt, date);
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
  const notice = "학교 측의 식단 업데이트가 늦을 경우, 식단표에 '등록된 식단 없음'으로 표시될 수 있습니다.";
  assert.equal(weeklyCaption('dormitory', range.dates), `2026년 9월 21일 ~ 9월 27일 기숙사 식단입니다.\n\n${notice}\n\n#해양대학교 #해양대기숙사`);
  assert.equal(weeklyCaption('combined', range.dates.slice(0, 5)), `2026년 9월 21일 ~ 9월 25일 학식 및 교직원 식당 식단입니다.\n\n${notice}\n\n#해양대학교 #해양대학식 #해양대교직원식당`);
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
test('주간 기숙사와 승선생활관은 날짜별 메뉴를 보존하면서 각각 한 번만 조회한다', async t => {
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const site = String(url).includes('/badaro/') ? 'badaro' : 'dorm';
    requested.push(site);
    return Response.json(range.dates.map((date, index) => ({
      dietSeq: index, dietDate: date.replaceAll('-', '/'), dietAditCn1: `${site} ${date} 조식`,
      dietAditCn2: `${site} ${date} 중식`, dietAditCn3: `${site} ${date} 석식`,
    })));
  });
  const fetcher = createWeeklyFetcher();
  for (const kind of ['badaro', 'dormitory'] as const) {
    const result = await fetcher(kind, range);
    assert.equal(result.pages[0]!.days.length, 7);
    for (const day of result.pages[0]!.days) {
      assert.equal(day.sections.length, 3);
      assert.ok(day.sections.every(section => section.items[0]!.includes(day.date)));
    }
  }
  assert.deepEqual(requested, ['badaro', 'dorm']);
});

test('학식 조회 실패 Promise는 캐시에 남지 않아 같은 실행에서도 재조회할 수 있다', async () => {
  let calls = 0;
  const fetcher = createWeeklyFetcher({
    badaro: async () => null, dormitory: async () => null,
    coop: async () => { if (++calls === 1) throw new Error('network'); return coopMenu; },
  });
  await assert.rejects(fetcher('combined', range), /network/);
  assert.equal((await fetcher('combined', range)).pages[0]!.days.length, 5);
  assert.equal(calls, 6);
});

test('학교 연결 장애가 지속되면 실패로 남기고 빈 메뉴나 이전 캐시로 게시하지 않는다', async t => {
  fastMenuRetries(t);
  const requests = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
  });
  const deps = runDeps([]);
  deps.fetch = createWeeklyFetcher();
  deps.render = async () => assert.fail('조회 실패 후 렌더 금지');
  deps.post = async () => assert.fail('조회 실패 후 게시 금지');
  const results = await runWeeklyAt(range, 'all', false, false, deps);
  assert.deepEqual(results.map(result => result.status), ['failed', 'failed', 'failed']);
  assert.ok(results.every(result => /2026-09-21.*UND_ERR_CONNECT_TIMEOUT.*총 5회/.test(result.error!)));
  assert.equal(requests.mock.callCount(), 15);
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
  const results = await runWeeklyAt(range, 'all', false, false, deps);
  assert.deepEqual(results.map(result => result.status), ['skipped', 'published', 'published']);
  assert.deepEqual(events.filter(value => value.startsWith('post:')), ['post:badaro', 'post:dormitory']);
  events.length = 0;
  await runWeeklyAt(range, 'combined', false, true, deps);
  assert.deepEqual(events, ['fetch:combined', 'render:combined', 'post:combined']);
});
test('preview never initializes posting or dedup storage, even with force', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.published = deps.post = async () => { throw new Error('must not call'); };
  const results = await runWeeklyAt(range, 'all', true, true, deps);
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
    published.set(value.kind, { ...oldRecord(value.kind, 'id'), menuHash: weeklyMenuHash(value), menuSnapshot: structuredClone(value.pages) });
    return { mediaId: 'id', skipped: false };
  };
  const first = await runWeeklyAt(range, 'all', false, false, deps);
  assert.deepEqual(first.map(result => result.status), ['published', 'failed', 'published']);
  events.length = 0;
  badaroReady = true;
  const second = await runWeeklyAt(range, 'all', false, false, deps);
  assert.deepEqual(second.map(result => result.status), ['skipped', 'published', 'skipped']);
  assert.deepEqual(events, ['fetch:combined', 'fetch:badaro', 'render:badaro', 'post:badaro', 'fetch:dormitory']);
});

test('메뉴가 전혀 없으면 해당 게시물만 대기한다', async () => {
  const deps = runDeps([]);
  deps.fetch = async kind => ({ ...data(kind), pages: [{ kind: 'badaro', days: [
    { date: range.monday, sections: [{ key: 'breakfast', label: 'Breakfast', items: [] }] },
  ] }] });
  deps.render = async () => assert.fail('빈 주간 식단 렌더 금지');
  const result = await runWeeklyAt(range, 'badaro', false, false, deps);
  assert.equal(result[0]?.status, 'deferred');
});
test('통합 게시물은 메뉴 있는 식당 한 장만 올리고 다른 두 게시물도 처리한다', async () => {
  const events: string[] = []; const deps = runDeps(events);
  deps.fetch = async kind => kind === 'combined'
    ? { ...data(kind), pages: [
      { kind: 'snack', days: [{ date: '2026-10-02', sections: [{ key: 'snack', label: '분식코너', items: [] }] }] },
      { kind: 'teacher', days: [{ date: '2026-10-02', sections: [{ key: 'lunch', label: '중식', items: ['백반'] }] }] },
    ] } : data(kind);
  const result = await runWeeklyAt(range, 'all', false, false, deps);
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

test('existing meal edits, additions within a meal and removals never replace', async () => {
  const s = services();
  const first = data();
  await postWeekly(first, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  for (const items of [[' 비빔밥  '], ['비빔밥', '국'], ['볶음밥'], []]) {
    const edited = structuredClone(first);
    edited.pages[0]!.days[0]!.sections[0]!.items = items;
    assert.equal((await postWeekly(edited, ['a', 'b'], false, s.storage, s.instagram, async () => {})).skipped, true);
  }
  assert.equal(s.events.filter(event => event === 'publish').length, 1);
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

test('all menus removed do not post or queue deletion notices', async () => {
  const s = services();
  const original = data('badaro');
  await postWeekly(original, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  const deps = runDeps([]);
  deps.published = async () => publishedWeekly(s.storage, range.week, 'badaro');
  deps.fetch = async () => ({ ...original, pages: original.pages.map(page => ({ ...page, days: page.days.map(day => ({ ...day, sections: day.sections.map(section => ({ ...section, items: [] })) })) })) });
  deps.render = async () => assert.fail('must not render');
  assert.equal((await runWeeklyAt(range, 'badaro', false, false, deps))[0]!.status, 'skipped');
  assert.deepEqual((await publishedWeekly(s.storage, range.week, 'badaro'))?.pendingNotifications, []);
});

function fullWeek(): WeeklyData {
  return { ...data('dormitory'), pages: [{ kind: 'dormitory', days: range.dates.map((date, i) => ({ date,
    sections: ['breakfast', 'lunch', 'dinner'].map(key => ({ key, label: key, items: i < 5 ? ['기존 메뉴'] : [] })) })) }] };
}
test('Wednesday weekend addition replaces, freezes elapsed days and refreshes future menus', async () => {
  const old = fullWeek();
  const next = structuredClone(old);
  next.pages[0]!.days.forEach(day => day.sections.forEach(section => { section.items = ['새 메뉴']; }));
  assert.equal(hasFutureAddition(next, old.pages, '2026-09-23'), true);
  const prepared = prepareWeekly(next, old.pages, '2026-09-23', true)!;
  assert.equal(prepared.updatedOn, '2026-09-23');
  assert.ok(prepared.pages[0]!.days.slice(0, 3).every(day => day.sections[0]!.items[0] === '기존 메뉴'));
  assert.ok(prepared.pages[0]!.days.slice(3).every(day => day.sections[0]!.items[0] === '새 메뉴'));
  assert.match(prepared.caption, /9\/23 수요일에 학교 측의 식단 업데이트로 인해 다시 올라온 게시물입니다\.\n\n학교 측/);
  assert.equal(hasFutureAddition(next, prepared.pages, '2026-09-23'), false);
});
test('Friday additions through Friday are ignored, but through Sunday warrant a post', () => {
  const old = fullWeek();
  old.pages[0]!.days.slice(3).forEach(day => day.sections.forEach(section => { section.items = []; }));
  const next = fullWeek();
  assert.equal(hasFutureAddition(next, old.pages, '2026-09-25'), false);
  next.pages[0]!.days[6]!.sections[2]!.items = ['석식'];
  assert.equal(hasFutureAddition(next, old.pages, '2026-09-25'), true);
  assert.equal(hasFutureAddition(next, old.pages, '2026-09-27'), false);
});
test('individual future meal and corner additions qualify even when the date already has menus', () => {
  const old = fullWeek(); old.pages[0]!.days[4]!.sections[1]!.items = [];
  assert.equal(hasFutureAddition(fullWeek(), old.pages, '2026-09-23'), true);
  const previous = data(); previous.pages[0]!.days[0]!.sections = [
    { key: 'snack', label: '분식', items: ['메뉴'] }, { key: 'set-meal', label: '정식', items: [] }];
  const next = structuredClone(previous); next.pages[0]!.days[0]!.sections[1]!.items = ['정식'];
  assert.equal(hasFutureAddition(next, previous.pages, today), true);
});
test('initial publication with only elapsed menus is deferred', async () => {
  const deps = runDeps([]); deps.render = async () => assert.fail('must not render');
  assert.equal((await runWeeklyAt(range, 'combined', false, false, deps, range.monday))[0]!.status, 'deferred');
});
test('lock recheck skips a future addition that another execution already published', async () => {
  const s = services(); const next = fullWeek(); next.pages[0]!.days[6]!.sections[0]!.items = ['신규'];
  const prepared = prepareWeekly(next, fullWeek().pages, today, true)!;
  s.records.set(`${range.week}/dormitory/success.json`, { ...oldRecord('dormitory'), menuSnapshot: prepared.pages });
  const result = await postWeeklyRaw(prepared, ['a', 'b'], false, s.storage, s.instagram, async () => {}, today);
  assert.equal(result.skipped, true); assert.ok(!s.events.includes('publish'));
});

test('automatic replacement saves exactly the frozen rendered snapshot, then skips next run', async () => {
  const s = services(); const old = fullWeek();
  await postWeekly(old, ['a', 'b'], false, s.storage, s.instagram, async () => {});
  const latest = structuredClone(old);
  latest.pages[0]!.days.forEach(day => day.sections.forEach(section => { section.items = ['최신 식단']; }));
  let rendered: WeeklyData | undefined;
  const deps: WeeklyDependencies = {
    published: async (week, kind) => publishedWeekly(s.storage, week, kind),
    fetch: async () => latest,
    render: async value => { rendered = structuredClone(value); return { images: ['a', 'b'] }; },
    post: async (value, images, force) => postWeeklyRaw(value, images, force, s.storage, s.instagram, async () => {}, '2026-09-23'),
  };
  assert.equal((await runWeeklyAt(range, 'dormitory', false, false, deps, '2026-09-23'))[0]!.status, 'replaced');
  const saved = (await publishedWeekly(s.storage, range.week, 'dormitory'))!;
  assert.deepEqual(saved.menuSnapshot, rendered!.pages);
  assert.equal(saved.caption, rendered!.caption);
  assert.equal(saved.menuSnapshot![0]!.days[0]!.sections[0]!.items[0], '기존 메뉴');
  assert.equal(saved.pendingNotifications!.length, 1);
  assert.equal((await runWeeklyAt(range, 'dormitory', false, false, deps, '2026-09-24'))[0]!.status, 'skipped');
});
test('force replacement renders the update notice even for a legacy record', async () => {
  const deps = runDeps([]);
  deps.published = async () => oldRecord('combined');
  deps.render = async value => {
    assert.equal(value.updatedOn, today);
    assert.match(value.caption, /다시 올라온 게시물/);
    return { images: ['a', 'b'] };
  };
  assert.equal((await runWeeklyAt(range, 'combined', false, true, deps))[0]!.status, 'published');
});
test('omitted restaurant keeps past cells empty while adding future menus', () => {
  const next = data();
  next.pages[1]!.days.push({ date: '2026-09-25', sections: [{ key: 'lunch', label: 'Lunch', items: ['새 식단'] }] });
  const old = [next.pages[0]!];
  const prepared = prepareWeekly(next, old, '2026-09-23', true)!;
  assert.deepEqual(prepared.pages[1]!.days[0]!.sections[0]!.items, []);
  assert.deepEqual(prepared.pages[1]!.days[1]!.sections[0]!.items, ['새 식단']);
});
test('malformed stored snapshots fail before any automatic publication', async () => {
  const s = services();
  s.records.set(`${range.week}/combined/success.json`, { ...oldRecord('combined'), menuSnapshot: [{ kind: 'snack', days: 'bad' }] });
  await assert.rejects(publishedWeekly(s.storage, range.week, 'combined'), /올바르지/);
});
