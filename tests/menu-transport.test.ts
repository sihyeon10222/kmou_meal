import assert from 'node:assert/strict';
import { createServer, type Server, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { fetchMenuText } from '../src/fetch-menu-text.js';

async function serve(t: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address() as Exclude<ReturnType<Server['address']>, string | null>;
  return { server, url: `http://127.0.0.1:${address.port}/menu` };
}

test('실제 소켓이 끊겨도 새 연결로 동일한 조회 POST를 재전송하고 복구한다', async t => {
  const bodies: string[] = [];
  let connections = 0;
  const { server, url } = await serve(t, (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.connection, 'close');
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      bodies.push(body);
      if (bodies.length === 1) request.socket.destroy();
      else response.end('복구한 식단');
    });
  });
  server.on('connection', () => { connections++; });
  t.mock.method(console, 'warn', () => {});
  const recovered = t.mock.method(console, 'info', () => {});
  const body = new URLSearchParams({ sys_id: 'dorm', sch_date: '2026-10-01' });
  assert.equal(await fetchMenuText(url, { method: 'POST', body }, '기숙사'), '복구한 식단');
  assert.deepEqual(bodies, [body.toString(), body.toString()]);
  assert.equal(connections, 2);
  assert.equal(recovered.mock.callCount(), 1);
});

test('응답 본문이 멈추면 제한 시간에 연결을 닫고 완전한 새 응답만 반환한다', async t => {
  let calls = 0;
  const { url } = await serve(t, (_request, response) => {
    if (++calls === 1) { response.writeHead(200); response.write('불완전한 식단'); }
    else response.end('완전한 식단');
  });
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  let signals = 0;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 45_000);
    return timeout(++signals === 1 ? 100 : 2000);
  });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
  assert.equal(await fetchMenuText(url, {}, '학식'), '완전한 식단');
  assert.equal(calls, 2);
});
