import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchDailyMenu, fetchBadaroMenu, createResidenceMenuFetcher, seoulDate } from '../src/fetch-menu.js';
import { fastMenuRetries } from './helpers/menu-retries.js';

test('여러 날짜의 동일 순번·부분 수정·공백 메뉴는 기존 안정 정렬과 같은 값을 선택한다', async t => {
  let seed = 1729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const dates = Array.from({ length: 31 }, (_, day) => `2026/10/${String(day + 1).padStart(2, '0')}`);
  const values = [null, undefined, '', ' \r\n\t ', ' 밥\r\n국\n김치 ', '수정 메뉴\r반찬'];
  const rows = Array.from({ length: 600 }, () => ({
    dietSeq: random() % 10 - 5, dietDate: dates[random() % dates.length]!,
    dietAditCn1: values[random() % values.length],
    dietAditCn2: values[random() % values.length],
    dietAditCn3: values[random() % values.length],
  }));
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
  const fetcher = createResidenceMenuFetcher('dorm');
  const clean = (value: string | null | undefined) => (value ?? '').split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
  for (const date of dates) {
    const sorted = rows.filter(row => row.dietDate === date).sort((a, b) => b.dietSeq - a.dietSeq);
    const latest = (key: 'dietAditCn1' | 'dietAditCn2' | 'dietAditCn3') => clean(sorted.find(row => clean(row[key]).length)?.[key]);
    assert.deepEqual(await fetcher(date.replaceAll('/', '-')), {
      date, breakfast: latest('dietAditCn1'), lunch: latest('dietAditCn2'), dinner: latest('dietAditCn3'),
    });
  }
  assert.equal(mock.mock.callCount(), 1);
});

test('같은 순번은 먼저 나온 유효한 끼니를 유지하고 비표준 응답 날짜는 사용하지 않는다', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { dietSeq: 7, dietDate: '2026/10/05', dietAditCn1: '첫 조식', dietAditCn2: ' \n ' },
    { dietSeq: 7, dietDate: '2026/10/05', dietAditCn1: '두 번째 조식', dietAditCn2: '첫 유효 중식' },
    { dietSeq: 8, dietDate: '2026-10-05', dietAditCn1: '다른 날짜 형식' },
    { dietSeq: 8, dietDate: '2026-10-06', dietAditCn1: '다른 날짜 형식' },
  ]));
  const fetcher = createResidenceMenuFetcher('dorm');
  const expected = { date: '2026/10/05', breakfast: ['첫 조식'], lunch: ['첫 유효 중식'], dinner: [] };
  assert.deepEqual(await fetcher('2026-10-05'), expected);
  assert.deepEqual(await fetchDailyMenu('2026-10-05'), expected);
  assert.equal(await fetcher('2026-10-06'), null);
});

test('승선생활관은 badaro API와 sys_id로 세 끼를 조회한다', async t => {
  t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
    assert.equal(url, 'https://www.kmou.ac.kr/badaro/di/diet/selectDietList.do');
    assert.equal((options.body as URLSearchParams).get('sys_id'), 'badaro');
    assert.equal((options.body as URLSearchParams).get('sch_date'), '2026-09-21');
    return Response.json([{ dietSeq: 1, dietDate: '2026/09/21', dietAditCn1: '밥\n국', dietAditCn2: '중식', dietAditCn3: '석식' }]);
  });
  assert.deepEqual(await fetchBadaroMenu('2026-09-21'), { date: '2026/09/21', breakfast: ['밥', '국'], lunch: ['중식'], dinner: ['석식'] });
});

test('최신 행에 석식만 있을 때 조식과 중식은 이전 행에서 가져온다', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { dietSeq: 25238, dietDate: '2026/09/30', dietAditCn1: '밥\n얼큰소고기국', dietAditCn2: '김가루주먹밥', dietAditCn3: '비빔막국수' },
    { dietSeq: 25239, dietDate: '2026/09/30', dietAditCn3: '비빔칼국수' },
  ]));
  assert.deepEqual(await fetchBadaroMenu('2026-09-30'), {
    date: '2026/09/30', breakfast: ['밥', '얼큰소고기국'], lunch: ['김가루주먹밥'], dinner: ['비빔칼국수'],
  });
});

test('UTC 날짜가 전날이어도 한국 날짜로 요청하고 최신 조식/중식/석식을 반환한다', async (t) => {
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
    date: '2026/09/16', breakfast: ['조식'], lunch: ['최신 중식', '밥'], dinner: ['국', '김치'],
  });
});

test('식단 없음과 비어 있는 끼니를 구분한다', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.equal(await fetchDailyMenu('2026-09-16'), null);
  mock.mock.mockImplementation(async () => Response.json([
    { dietSeq: 1, dietDate: '2026/09/16', dietAditCn2: null },
  ]));
  assert.deepEqual(await fetchDailyMenu('2026-09-16'), { date: '2026/09/16', breakfast: [], lunch: [], dinner: [] });
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
  fastMenuRetries(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 503 }) : Response.json([]);
  });
  assert.equal(await fetchDailyMenu('2026-09-16'), null);
  assert.equal(calls, 2);
});

test('잘못된 JSON은 통신 오류로 재시도하지 않는다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>점검 중</html>'));
  await assert.rejects(fetchDailyMenu('2026-09-18'), /응답 JSON/);
  assert.equal(mock.mock.callCount(), 1);
});

test('기숙사 응답 본문 수신 실패는 재시도 후 복구한다', async t => {
  fastMenuRetries(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) {
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error('socket closed')); } }));
    }
    return Response.json([{ dietSeq: 1, dietDate: '2026/09/18', dietAditCn2: '밥' }]);
  });
  assert.deepEqual(await fetchDailyMenu('2026-09-18'), { date: '2026/09/18', breakfast: [], lunch: ['밥'], dinner: [] });
  assert.equal(calls, 2);
});

test('한 응답의 여러 날짜와 끼니별 최신 행을 재사용하며 실행 간 캐시는 공유하지 않는다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json([
    { dietSeq: 1, dietDate: '2026/09/30', dietAditCn1: '밥', dietAditCn2: '국', dietAditCn3: '기존 석식' },
    { dietSeq: 2, dietDate: '2026/09/30', dietAditCn3: '수정 석식' },
    { dietSeq: 3, dietDate: '2026/10/01', dietAditCn2: '다음 날 중식' },
  ]));
  const fetcher = createResidenceMenuFetcher('dorm');
  assert.deepEqual(await fetcher('2026-09-30'), {
    date: '2026/09/30', breakfast: ['밥'], lunch: ['국'], dinner: ['수정 석식'],
  });
  const next = await fetcher('2026-10-01');
  assert.deepEqual(next?.lunch, ['다음 날 중식']);
  next!.lunch.push('외부 수정');
  assert.deepEqual((await fetcher('2026-10-01'))?.lunch, ['다음 날 중식']);
  assert.equal(mock.mock.callCount(), 1);
  await createResidenceMenuFetcher('dorm')('2026-10-01');
  assert.equal(mock.mock.callCount(), 2);
});

test('응답에 없는 날짜는 별도 조회하고 실제로 빈 날짜만 캐시한다', async t => {
  const dates: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const date = (init.body as URLSearchParams).get('sch_date')!;
    dates.push(date);
    return Response.json(date === '2026-10-02' ? [] : [
      { dietSeq: 1, dietDate: date.replaceAll('-', '/'), dietAditCn2: date },
    ]);
  });
  const fetcher = createResidenceMenuFetcher('badaro');
  await fetcher('2026-09-30');
  assert.deepEqual((await fetcher('2026-10-01'))?.lunch, ['2026-10-01']);
  assert.equal(await fetcher('2026-10-02'), null);
  assert.equal(await fetcher('2026-10-02'), null);
  assert.deepEqual(dates, ['2026-09-30', '2026-10-01', '2026-10-02']);
});

test('조회 실패는 빈 식단으로 캐시하지 않고 식당과 날짜를 알린다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const fetcher = createResidenceMenuFetcher('badaro');
  await assert.rejects(fetcher('2026-10-01'), /승선생활관.*badaro, 2026-10-01.*HTTP 403/);
  mock.mock.mockImplementation(async () => Response.json([{ dietSeq: 1, dietDate: '2026/10/01', dietAditCn2: '복구 식단' }]));
  assert.deepEqual((await fetcher('2026-10-01'))?.lunch, ['복구 식단']);
  assert.equal(mock.mock.callCount(), 2);
});

test('조식 줄바꿈 정리와 잘못된 조식 응답 검증', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json([
    { dietSeq: 1, dietDate: '2026/09/18', dietAditCn1: ' 밥\r\n국\n \n김치 ' },
  ]));
  assert.deepEqual((await fetchDailyMenu('2026-09-18'))?.breakfast, ['밥', '국', '김치']);
  mock.mock.mockImplementation(async () => Response.json([
    { dietSeq: 1, dietDate: '2026/09/18', dietAditCn1: 123 },
  ]));
  await assert.rejects(fetchDailyMenu('2026-09-18'), /응답 구조/);
});
