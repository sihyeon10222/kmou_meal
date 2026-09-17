import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postStory } from '../src/post-story.js';
import { StoryStorage, type PostRecord } from '../src/upload-supabase.js';

test('동일 날짜/모드 재게시, legacy 기록 무시, run별 Storage 경로', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.method, 'POST'); // legacy 기록 GET은 허용하지 않음
    assert.equal(request.headers.get('x-upsert'), 'true');
    paths.push(new URL(request.url).pathname);
    return Response.json({ Key: 'ok' });
  });
  const storage = new StoryStorage({ igAccessToken: 'test', igUserId: '123', supabaseUrl: 'https://example.supabase.co', supabaseKey: 'test', supabaseBucket: 'stories' });
  let publishes = 0;
  const instagram = {
    async publishStory(_url: string, callback: (id: string) => Promise<void>) {
      await callback(`c${++publishes}`);
      return `m${publishes}`;
    },
    async verifyStory(id: string) { return { id, mediaType: 'IMAGE', timestamp: 'now' }; },
  };
  const run = () => postStory('2026-09-17', 'today_lunch', 'image.jpg', {
    uploadImage: async (_path, objectPath) => `https://example.com/${objectPath}`,
    writeRecord: (record) => storage.writeRecord(record),
  }, instagram, async () => {});
  const a = await run();
  const b = await run();
  assert.equal(publishes, 2);
  assert.notEqual(a.runId, b.runId);
  for (const record of [a, b]) {
    assert.equal(record.status, 'published');
    assert.equal(record.imagePath, `2026-09-17/today_lunch/${record.runId}.jpg`);
    assert.equal(paths.filter(p => p.endsWith(`/_posts/2026-09-17/today_lunch/${record.runId}.json`)).length, 3);
  }
});

test('실패 기록이 다음 실행을 막지 않고 게시 후 검증 실패는 published를 유지', async () => {
  const records: PostRecord[] = [];
  let failPublish = true;
  const storage = { uploadImage: async () => 'https://example.com/a.jpg', writeRecord: async (r: PostRecord) => { records.push(structuredClone(r)); } };
  const instagram = {
    async publishStory() { if (failPublish) throw new Error('publish error'); return 'm1'; },
    async verifyStory(): Promise<never> { throw new Error('verify error'); },
  };
  const run = () => postStory('2026-09-17', 'today_lunch', 'image.jpg', storage, instagram, async () => {});
  await assert.rejects(run(), /publish error/);
  const failed = records.at(-1)!;
  assert.equal(failed.status, 'failed');
  failPublish = false;
  await assert.rejects(run(), /verify error/);
  const published = records.at(-1)!;
  assert.notEqual(failed.runId, published.runId);
  assert.equal(published.status, 'published');
  assert.equal(published.mediaId, 'm1');
});
