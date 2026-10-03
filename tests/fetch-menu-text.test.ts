import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchMenuText } from '../src/fetch-menu-text.js';
import { fastMenuRetries } from './helpers/menu-retries.js';

test('HTTP 408은 새 제한 시간으로 재시도하고 오류 본문을 해제한다', async t => {
  fastMenuRetries(t);
  const signals: (AbortSignal | null | undefined)[] = [];
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signals.push(init.signal);
    if (signals.length === 1) {
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 408 });
    }
    return new Response('식단');
  });
  t.mock.method(console, 'warn', () => {});
  assert.equal(await fetchMenuText('https://example.test', { method: 'POST' }, '식단 조회'), '식단');
  assert.equal(cancelled, true);
  assert.equal(signals.length, 2);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.ok(signals[1] instanceof AbortSignal);
  assert.notEqual(signals[0], signals[1]);
});

test('오류 본문 해제 실패가 영구 HTTP 오류를 가리지 않는다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    cancel() { throw new Error('stream reset'); },
  }), { status: 403 }));
  await assert.rejects(fetchMenuText('https://example.test', {}, '식단 조회'), /HTTP 403.*1회/);
  assert.equal(mock.mock.callCount(), 1);
});

test('연결 오류는 다섯 번까지만 시도하고 진단에 원본 URL이나 메시지를 노출하지 않는다', async t => {
  const { delays, warnings, recoveries } = fastMenuRetries(t);
  const cause = new TypeError('https://example.test?token=secret', { cause: { code: 'ECONNRESET' } });
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw cause; });
  await assert.rejects(fetchMenuText('https://example.test', {}, '식단 조회'), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /ECONNRESET.*총 5회/);
    assert.doesNotMatch(error.message, /secret|https:/);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(mock.mock.callCount(), 5);
  assert.equal(warnings.mock.callCount(), 4);
  assert.equal(recoveries.mock.callCount(), 0);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000]);
  for (const call of warnings.mock.calls) {
    assert.doesNotMatch(String(call.arguments[0]), /secret|https:/);
  }
});

test('기존 세 번 한도를 넘는 연결 타임아웃도 다섯 번째 요청에서 복구한다', async t => {
  const { delays, recoveries, warnings } = fastMenuRetries(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls < 5) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    return new Response('정상 식단');
  });
  assert.equal(await fetchMenuText('https://example.test', {}, '기숙사 2026-10-01'), '정상 식단');
  assert.deepEqual(delays, [2000, 4000, 8000, 16000]);
  assert.match(String(warnings.mock.calls[0]!.arguments[0]), /기숙사 2026-10-01.*UND_ERR_CONNECT_TIMEOUT/);
  assert.match(String(recoveries.mock.calls[0]!.arguments[0]), /기숙사 2026-10-01 복구 성공: 5\/5/);
});

for (const value of ['7', 'Thu, 01 Oct 2026 00:00:07 GMT', 'invalid']) {
  test(`서버 Retry-After 처리: ${value}`, async t => {
    const { delays } = fastMenuRetries(t);
    t.mock.method(Date, 'now', () => Date.parse('2026-10-01T00:00:00Z'));
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? new Response('', { status: 429, headers: { 'Retry-After': value } }) : new Response('식단'));
    assert.equal(await fetchMenuText('https://example.test', {}, '학식'), '식단');
    assert.deepEqual(delays, [value === 'invalid' ? 2000 : 7000]);
  });
}

test('60초를 초과하는 Retry-After는 조기 재요청 없이 명시적으로 실패한다', async t => {
  const { delays } = fastMenuRetries(t);
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503, headers: { 'Retry-After': '120' } }));
  await assert.rejects(fetchMenuText('https://example.test', {}, '학식'), /HTTP 503.*Retry-After.*중단/);
  assert.equal(mock.mock.callCount(), 1);
  assert.deepEqual(delays, []);
});
