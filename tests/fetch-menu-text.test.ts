import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchMenuText } from '../src/fetch-menu-text.js';

test('HTTP 408은 새 제한 시간으로 재시도하고 오류 본문을 해제한다', async t => {
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

test('연결 오류는 세 번까지만 시도하고 진단에 원본 URL이나 메시지를 노출하지 않는다', async t => {
  const cause = new TypeError('https://example.test?token=secret', { cause: { code: 'ECONNRESET' } });
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw cause; });
  const warnings = t.mock.method(console, 'warn', () => {});
  await assert.rejects(fetchMenuText('https://example.test', {}, '식단 조회'), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /ECONNRESET.*총 3회/);
    assert.doesNotMatch(error.message, /secret|https:/);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(mock.mock.callCount(), 3);
  assert.equal(warnings.mock.callCount(), 2);
  for (const call of warnings.mock.calls) {
    assert.doesNotMatch(String(call.arguments[0]), /secret|https:/);
  }
});
