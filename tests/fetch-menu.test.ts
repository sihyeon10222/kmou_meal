import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchDailyMenu, seoulDate } from '../src/fetch-menu.js';

test('UTC 날짜가 전날이어도 한국 날짜로 요청하고 최신 중식/석식만 반환한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal(options.method, 'POST');
    assert.equal((options.body as URLSearchParams).get('sch_date'), '2026-09-16');
    return Response.json([
      { dietSeq: 9, dietDate: '2026/09/15', dietAditCn2: '다른 날' },
      { dietSeq: 2, dietDate: '2026/09/16', dietAditCn2: '최신 중식\r\n \r\n밥 ', dietAditCn3: '국\n김치', dietAditCn1: '조식' },
      { dietSeq: 1, dietDate: '2026/09/16', dietAditCn2: '이전 중식' },
    ]);
  });
  assert.equal(seoulDate(new Date('2026-09-15T15:00:00Z')), '2026-09-16');
  assert.deepEqual(await fetchDailyMenu(new Date('2026-09-15T22:10:00Z')), {
    date: '2026/09/16', lunch: ['최신 중식', '밥'], dinner: ['국', '김치'],
  });
});

test('식단 없음과 비어 있는 끼니를 구분한다', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.equal(await fetchDailyMenu('2026-09-16'), null);
  mock.mock.mockImplementation(async () => Response.json([
    { dietSeq: 1, dietDate: '2026/09/16', dietAditCn2: null },
  ]));
  assert.deepEqual(await fetchDailyMenu('2026-09-16'), { date: '2026/09/16', lunch: [], dinner: [] });
});

test('잘못된 날짜, 응답 구조와 HTTP 실패는 정상 skip으로 숨기지 않는다', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'unexpected' }));
  await assert.rejects(fetchDailyMenu('2026-02-30'), /존재하지 않는/);
  await assert.rejects(fetchDailyMenu('09-16-2026'), /YYYY-MM-DD/);
  assert.equal(mock.mock.callCount(), 0);
  await assert.rejects(fetchDailyMenu('2026-09-16'), /응답 구조/);
  mock.mock.mockImplementation(async () => new Response('', { status: 403 }));
  await assert.rejects(fetchDailyMenu('2026-09-16'), /HTTP 403/);
});

test('일시적인 서버 오류는 재시도한다', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 503 }) : Response.json([]);
  });
  assert.equal(await fetchDailyMenu('2026-09-16'), null);
  assert.equal(calls, 2);
});
