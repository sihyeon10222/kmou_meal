import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { StoryStorage } from '../src/upload-supabase.js';
import { postStory } from '../src/post-story.js';

const config = {
  igAccessToken: 'test', igUserId: '123', supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'test', supabaseBucket: 'stories',
};
const bytes = Buffer.from('test JPEG bytes');
const imageResponse = () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'story-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'story.jpg');
  await writeFile(path, bytes);
  const sleeps: number[] = [];
  const storage = new StoryStorage(config, async ms => { sleeps.push(ms); });
  return { path, sleeps, storage };
}

for (const failure of [408, 429, 500, 503, 'network', 'timeout', 'invalid-json'] as const) {
  test(`image upload retries transient ${failure} using the same object without upsert`, async t => {
    const { path, sleeps, storage } = await fixture(t);
    let uploads = 0;
    let reads = 0;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') { reads++; return imageResponse(); }
      assert.ok(request.url.endsWith('/stories/run/image.jpg'));
      assert.equal(request.headers.get('x-upsert'), 'false');
      assert.deepEqual(Buffer.from(await request.arrayBuffer()), bytes);
      if (++uploads === 1) {
        if (failure === 'network') throw new TypeError('fetch failed');
        if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
        if (failure === 'invalid-json') return new Response('broken JSON');
        return Response.json({ message: '<none>' }, { status: failure });
      }
      return Response.json({ Key: 'ok' });
    });
    assert.match(await storage.uploadImage(path, 'run/image.jpg'), /\/object\/public\/stories\/run\/image.jpg$/);
    assert.equal(uploads, 2);
    assert.equal(reads, 1);
    assert.deepEqual(sleeps, [1000]);
  });
}

test('exhausted upload includes HTTP and service codes even for <none>', async t => {
  const { path, sleeps, storage } = await fixture(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ message: '<none>', code: 'InternalError' }, { status: 503 });
  });
  await assert.rejects(storage.uploadImage(path, 'image.jpg'), /<none>.*status=503.*code=InternalError/);
  assert.equal(requests, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

for (const status of [400, 401, 403, 413]) {
  test(`permanent upload HTTP ${status} fails without retry`, async t => {
    const { path, sleeps, storage } = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return Response.json({ message: '<none>' }, { status });
    });
    await assert.rejects(storage.uploadImage(path, 'image.jpg'), new RegExp(`status=${status}`));
    assert.equal(requests, 1);
    assert.deepEqual(sleeps, []);
  });
}

for (const matches of [true, false]) {
  test(`lost upload response then duplicate verifies bytes before publishing: matches=${matches}`, async t => {
    const { path, storage } = await fixture(t);
    let uploads = 0;
    let publishes = 0;
    const paths: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') {
        return matches ? imageResponse() : new Response('other image', { headers: { 'content-type': 'image/jpeg' } });
      }
      if (request.headers.get('content-type') === 'application/json') return Response.json({ Key: 'ok' });
      paths.push(request.url);
      if (++uploads === 1) throw new TypeError('response lost');
      // Storage may report HTTP 400 with the conflict in statusCode.
      return Response.json({ message: 'exists', statusCode: '409' }, { status: 400 });
    });
    const result = postStory('2026-10-13', 'today_snack', path, storage, {
      async publishStory() { publishes++; return 'm1'; },
      async verifyStory(id) { return { id, mediaType: 'IMAGE', timestamp: 'now' }; },
    }, async () => {});
    if (matches) assert.equal((await result).status, 'published');
    else await assert.rejects(result, /공개 URL 검증/);
    assert.equal(uploads, 2);
    assert.equal(new Set(paths).size, 1);
    assert.equal(publishes, matches ? 1 : 0);
  });
}

for (const failure of [404, 503, 'network', 'body', 'wrong-type', 'wrong-bytes'] as const) {
  test(`public image verification handles ${failure} without repeating upload`, async t => {
    const { path, sleeps, storage } = await fixture(t);
    let uploads = 0;
    let reads = 0;
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { uploads++; return Response.json({ Key: 'ok' }); }
      if (++reads > 1) return imageResponse();
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === 'body') return new Response(new ReadableStream({ start(c) { c.error(new TypeError('socket closed')); } }), {
        headers: { 'content-type': 'image/jpeg' },
      });
      if (failure === 'wrong-type') return new Response(bytes, { headers: { 'content-type': 'text/html' } });
      if (failure === 'wrong-bytes') return new Response('corrupt', { headers: { 'content-type': 'image/jpeg' } });
      return new Response('unavailable', { status: failure });
    });
    const permanent = failure === 'wrong-type' || failure === 'wrong-bytes';
    if (permanent) await assert.rejects(storage.uploadImage(path, 'image.jpg'), /공개 URL 검증/);
    else await storage.uploadImage(path, 'image.jpg');
    assert.equal(uploads, 1);
    assert.equal(reads, permanent ? 1 : 2);
    assert.deepEqual(sleeps, permanent ? [] : [1000]);
  });
}

test('public URL failures exhaust after three reads', async t => {
  const { path, sleeps, storage } = await fixture(t);
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ Key: 'ok' });
    reads++;
    return new Response('unavailable', { status: 503 });
  });
  await assert.rejects(storage.uploadImage(path, 'image.jpg'), /HTTP 503/);
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('weekly lock acquisition is not retried on an ambiguous write', async t => {
  const { sleeps, storage } = await fixture(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new TypeError('response lost'); });
  await assert.rejects(storage.writeWeeklyJson('week/lock.json', {}, false));
  assert.equal(requests, 1);
  assert.deepEqual(sleeps, []);
});
