import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCoopDailyMenu, parseCoopMenu } from '../src/fetch-coop-menu.js';
import { coopHtml, emptyCoopHtml } from './fixtures.js';

test('학식 POST 날짜/요청 본문과 7개 카테고리', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /coop\/dv\/dietView\/selectDietDateView.do\?mi=1189/);
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.fromEntries(init.body as URLSearchParams), { sys_id: 'coop', sch_date: '2026/09/18', gbn: '', streFileNm: '' });
    assert.ok(init.signal);
    return new Response(coopHtml);
  });
  const menu = await fetchCoopDailyMenu('2026-09-18');
  assert.equal(menu.date, '2026-09-18');
  assert.deepEqual(Object.values(menu.snackCorner).map(x => x.length), [8, 3, 1, 6]);
  assert.deepEqual(Object.values(menu.staffRestaurant).map(x => x.length), [1, 7, 7]);
  assert.equal(menu.snackCorner.western[0], '돈까스');
  assert.equal(menu.staffRestaurant.breakfast[0], '명란두부찌개');
});

test('표 순서와 무관한 식별, 공백/br 정리, 가격 제거, 부분 빈 칸', () => {
  const html = coopHtml.replace('메밀소바+유부초밥', '').replace('돈까스<br>', ' 돈까스&nbsp;  (5,000원)<BR/>\r\n 6,000원 <br>');
  const menu = parseCoopMenu(html, '2026-09-18');
  assert.deepEqual(menu.snackCorner.snack, []);
  assert.equal(menu.snackCorner.western[0], '돈까스');
  assert.equal(menu.snackCorner.western.length, 8);
  const tables = html.match(/<table[\s\S]*?<\/table>/g)!;
  assert.deepEqual(parseCoopMenu(tables.reverse().join(''), '2026-09-18'), menu);
});

test('날짜만 있는 colspan 행은 빈 메뉴, 없는 표는 구조 오류', () => {
  const menu = parseCoopMenu(emptyCoopHtml, '2026-09-19');
  assert.ok([...Object.values(menu.snackCorner), ...Object.values(menu.staffRestaurant)].every(x => x.length === 0));
  assert.throws(() => parseCoopMenu('<html>장애 페이지</html>', '2026-09-18'), /구조 오류/);
  assert.throws(() => parseCoopMenu(coopHtml.replace('양식코너', '변경됨'), '2026-09-18'), /구조 오류/);
});

test('잘못된 날짜/HTTP 오류/timeout은 빈 메뉴로 숨기지 않는다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(fetchCoopDailyMenu('2026-02-30'), /존재하지 않는/);
  assert.equal(mock.mock.callCount(), 0);
  await assert.rejects(fetchCoopDailyMenu('2026-09-18'), /HTTP 503/);
  mock.mock.mockImplementation(async () => { throw new DOMException('Timeout', 'TimeoutError'); });
  await assert.rejects(fetchCoopDailyMenu('2026-09-18'), { name: 'TimeoutError' });
});
