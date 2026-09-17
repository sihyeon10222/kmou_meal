import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import type { PublishConfig } from './config.js';
import type { StoryMode } from './render-story.js';

export interface PostRecord {
  runId: string;
  date: string;
  mode: StoryMode;
  status: 'posting' | 'published' | 'failed';
  startedAt: string;
  imagePath: string;
  containerId?: string;
  containerIds?: string[];
  mediaId?: string;
  publishedAt?: string;
  error?: string;
}

export class StoryStorage {
  private client;
  private bucket;

  constructor(private config: PublishConfig) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
    });
    this.bucket = this.client.storage.from(config.supabaseBucket);
  }

  async checkBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.config.supabaseBucket);
    if (error || !data) throw new Error('Supabase 버킷 조회 실패. 프로젝트 URL, 서버 키, 버킷 이름을 확인하세요.');
    if (!data.public) throw new Error('Instagram이 이미지를 읽을 수 있도록 stories 버킷이 Public이어야 합니다.');
  }

  async uploadImage(path: string, objectPath: string): Promise<string> {
    const bytes = await readFile(path);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Story JPEG가 8MB를 초과합니다.');
    const { error } = await this.bucket.upload(objectPath, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (error) throw new Error(`Supabase 이미지 업로드 실패: ${error.message}`);
    const { data } = this.bucket.getPublicUrl(objectPath);
    const response = await fetch(data.publicUrl, { signal: AbortSignal.timeout(30_000) });
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (!response.ok || !response.headers.get('content-type')?.includes('image/jpeg') || !downloaded.equals(bytes)) {
      throw new Error('업로드 이미지의 공개 URL 검증에 실패했습니다.');
    }
    return data.publicUrl;
  }

  async writeRecord(record: PostRecord): Promise<void> {
    const { error } = await this.bucket.upload(`_posts/${record.date}/${record.mode}/${record.runId}.json`, JSON.stringify(record, null, 2), {
      contentType: 'application/json', upsert: true, cacheControl: '0',
    });
    if (error) throw new Error(`게시 기록 저장 실패: ${error.message}`);
  }
}
