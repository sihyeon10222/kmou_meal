import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InstagramPublisher, InstagramApiError } from '../src/publish-instagram.js';
import type { PublishConfig } from '../src/config.js';

const config: PublishConfig = {
  igAccessToken: 'test-token', igUserId: '123',
  supabaseUrl: 'https://example.supabase.co', supabaseKey: 'test-key', supabaseBucket: 'stories',
};

for (const scenario of ['recover', 'exhaust', 'other', 'network'] as const) {
  test(`게시 복구: ${scenario}`, async (t) => {
    let containers = 0;
    let publishes = 0;
    const ids: string[] = [];
    const sleeps: number[] = [];
    t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
      if (url.pathname === '/123/media') return Response.json({ id: `c${++containers}` });
      if (url.pathname === '/123/media_publish') {
        publishes++;
        assert.equal((init.body as URLSearchParams).get('creation_id'), `c${publishes}`);
        if (scenario === 'network') throw new Error('Connection reset');
        if (scenario === 'recover' && publishes === 2) return Response.json({ id: 'm1' });
        return Response.json({ error: { code: scenario === 'other' ? 190 : 24, error_subcode: 2207006 } }, { status: 400 });
      }
      return Response.json({ status_code: 'FINISHED' });
    });
    const publisher = new InstagramPublisher(config, async (ms) => { sleeps.push(ms); });
    const result = publisher.publishStory('https://example.com/story.jpg', async (id) => { ids.push(id); });
    if (scenario === 'recover') assert.equal(await result, 'm1');
    else await assert.rejects(result, scenario === 'network' ? /Connection reset/ : InstagramApiError);
    const retry = scenario === 'recover' || scenario === 'exhaust';
    assert.equal(publishes, retry ? 2 : 1);
    assert.equal(containers, publishes);
    assert.deepEqual(ids, retry ? ['c1', 'c2'] : ['c1']);
    assert.deepEqual(sleeps, retry ? [5000, 10000, 5000] : [5000]);
  });
}

test('Instagram Login Story 생성, 상태 확인, 게시, 활성 Story 검증', async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, 'https://graph.instagram.com');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-token');
    requests.push(url.pathname);
    switch (url.pathname) {
      case '/me': return Response.json({ id: '123', username: 'kmou_meal' });
      case '/123/media':
        assert.equal((init.body as URLSearchParams).get('media_type'), 'STORIES');
        return Response.json({ id: 'container' });
      case '/container': return Response.json({ status_code: 'FINISHED' });
      case '/123/media_publish':
        assert.equal((init.body as URLSearchParams).get('creation_id'), 'container');
        return Response.json({ id: 'media' });
      case '/media': return Response.json({ id: 'media', media_type: 'IMAGE', timestamp: '2026-09-16T13:00:00Z' });
      case '/123/stories': return Response.json({ data: [{ id: 'media' }] });
      default: throw new Error('Unexpected URL');
    }
  });
  const publisher = new InstagramPublisher(config);
  await publisher.checkAccount();
  const container = await publisher.createContainer('https://example.supabase.co/image.jpg');
  await publisher.waitUntilReady(container);
  const media = await publisher.publish(container);
  assert.equal((await publisher.verifyStory(media)).id, 'media');
  assert.deepEqual(requests, ['/me', '/123/media', '/container', '/123/media_publish', '/media', '/123/stories']);
});

test('다른 계정과 처리 실패는 게시를 중단한다', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: '456', username: 'other' }));
  const publisher = new InstagramPublisher(config);
  await assert.rejects(publisher.checkAccount(), /다릅니다/);
  fetchMock.mock.mockImplementation(async () => Response.json({ status_code: 'ERROR' }));
  await assert.rejects(publisher.waitUntilReady('container'), /ERROR/);
});

test('게시 POST 응답 유실 시 자동 재전송하지 않는다', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Connection reset'); });
  await assert.rejects(new InstagramPublisher(config).publish('container'), /Connection reset/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const failure of ['network', 'timeout', '503', '429', 'auth', 'invalid', 'exhaust'] as const) {
  test(`Instagram GET 재시도 범위: ${failure}`, async t => {
    let calls = 0;
    const waits: number[] = [];
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (calls > 1 && failure !== 'exhaust') return Response.json({ status_code: 'FINISHED' });
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      if (failure === 'invalid') return Response.json([]);
      return Response.json({ error: { code: failure === 'auth' ? 190 : 2 } }, {
        status: failure === 'auth' ? 400 : failure === '429' ? 429 : 503,
      });
    });
    const result = new InstagramPublisher(config, async ms => { waits.push(ms); }).containerStatus('c1');
    if (['auth', 'invalid', 'exhaust'].includes(failure)) await assert.rejects(result);
    else assert.equal(await result, 'FINISHED');
    assert.equal(calls, failure === 'exhaust' ? 3 : ['auth', 'invalid'].includes(failure) ? 1 : 2);
    assert.deepEqual(waits, failure === 'exhaust' ? [1000, 2000] : ['auth', 'invalid'].includes(failure) ? [] : [1000]);
  });
}

test('생성/게시 POST는 503이어도 자동 재전송하지 않는다', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 2 } }, { status: 503 }));
  const publisher = new InstagramPublisher(config, async () => assert.fail('POST 재시도 금지'));
  await assert.rejects(publisher.createContainer('https://example.com/a.jpg'), InstagramApiError);
  await assert.rejects(publisher.publish('c1'), InstagramApiError);
  assert.equal(mock.mock.callCount(), 2);
});

test('Instagram 조회는 Retry-After를 지키고 60초 초과는 이번 조회를 중단한다', async t => {
  const waits: number[] = [];
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ error: { code: 2 } }, { status: 429, headers: { 'Retry-After': '7' } })
    : Response.json({ status_code: 'FINISHED' }));
  const publisher = new InstagramPublisher(config, async ms => { waits.push(ms); });
  assert.equal(await publisher.containerStatus('c1'), 'FINISHED');
  assert.deepEqual(waits, [7000]);
  mock.mock.mockImplementation(async () => Response.json({ error: { code: 2 } }, { status: 429, headers: { 'Retry-After': '61' } }));
  await assert.rejects(publisher.containerStatus('c1'), InstagramApiError);
  assert.equal(mock.mock.callCount(), 3);
  assert.deepEqual(waits, [7000]);
});

for (const count of [1, 2]) {
  test(`feed API publishes ${count} image(s), validates containers and retains child order`, async t => {
    const containers: string[] = [];
    const parameters: URLSearchParams[] = [];
    let publishCount = 0;
    let persistedBeforePublish = false;
    t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
      if (url.pathname === '/123/media') {
        parameters.push(new URLSearchParams(init.body as URLSearchParams));
        return Response.json({ id: `c${parameters.length}` });
      }
      if (url.pathname === '/123/media_publish') {
        assert.equal(persistedBeforePublish, true);
        assert.equal((init.body as URLSearchParams).get('creation_id'), count === 1 ? 'c1' : 'c3');
        publishCount++; return Response.json({ id: 'feed' });
      }
      if (url.pathname === '/feed') return Response.json({ id: 'feed', media_type: count === 1 ? 'IMAGE' : 'CAROUSEL_ALBUM', children: { data: [{ id: 'one' }, { id: 'two' }] } });
      return Response.json({ status_code: 'FINISHED' });
    });
    const publisher = new InstagramPublisher(config, async () => {});
    const urls = ['https://example.com/1.jpg', 'https://example.com/2.jpg'].slice(0, count);
    assert.equal(await publisher.publishFeed(urls, 'caption', async id => { containers.push(id); }, async () => { persistedBeforePublish = true; }), 'feed');
    assert.equal(publishCount, 1);
    assert.equal(parameters[0]!.get('image_url'), urls[0]);
    assert.equal(parameters[0]!.get('media_type'), null);
    if (count === 2) {
      assert.equal(parameters[0]!.get('is_carousel_item'), 'true');
      assert.equal(parameters[1]!.get('image_url'), urls[1]);
      assert.equal(parameters[2]!.get('children'), 'c1,c2');
      assert.equal(parameters[2]!.get('media_type'), 'CAROUSEL');
      assert.equal(parameters[2]!.get('caption'), 'caption');
      assert.deepEqual(containers, ['c1', 'c2', 'c3']);
    } else assert.equal(parameters[0]!.get('caption'), 'caption');
    await publisher.verifyFeed('feed', count);
  });
}
for (const scenario of ['recover', 'network', 'auth', 'exhaust'] as const) {
  test(`feed recovery policy: ${scenario}`, async t => {
    let publishes = 0;
    let created = 0;
    t.mock.method(globalThis, 'fetch', async (url: URL) => {
      if (url.pathname === '/123/media') return Response.json({ id: `c${++created}` });
      if (url.pathname === '/123/media_publish') {
        publishes++;
        if (scenario === 'network') throw new Error('connection reset');
        if (scenario === 'recover' && publishes === 2) return Response.json({ id: 'feed' });
        return Response.json({ error: { code: scenario === 'auth' ? 190 : 24, error_subcode: 2207006 } }, { status: 400 });
      }
      return Response.json({ status_code: 'FINISHED' });
    });
    const publisher = new InstagramPublisher(config, async () => {});
    const promise = publisher.publishFeed(['https://example.com/1.jpg'], 'caption', async () => {}, async () => {});
    if (scenario === 'recover') assert.equal(await promise, 'feed');
    else await assert.rejects(promise);
    assert.equal(publishes, ['recover', 'exhaust'].includes(scenario) ? 2 : 1);
  });
}
