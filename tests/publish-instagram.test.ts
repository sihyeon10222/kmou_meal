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
