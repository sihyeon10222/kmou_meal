import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { safeError, type PublishConfig } from './config.js';
import type { StoryMode } from './story-modes.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_ATTEMPTS = 3;

function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('status' in error && typeof error.status === 'number') {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if ('originalError' in error) return isTransient(error.originalError);
  return error instanceof TypeError || error instanceof SyntaxError || ['TimeoutError', 'AbortError'].includes(error.name);
}

function isDuplicate(error: Error): boolean {
  return ('status' in error && error.status === 409)
    || ('statusCode' in error && String(error.statusCode) === '409')
    || ('code' in error && error.code === 'ResourceAlreadyExists');
}

/** Keep useful diagnostics even when the service only returns message: "<none>". */
function uploadError(error: Error): Error {
  const details = ['status', 'statusCode', 'code'].flatMap(key => {
    const value = (error as unknown as Record<string, unknown>)[key];
    return (typeof value === 'string' || typeof value === 'number') && /^[\w-]+$/.test(String(value))
      ? [`${key}=${value}`] : [];
  });
  if ('originalError' in error && error.originalError instanceof Error) details.push(`cause=${error.originalError.name}`);
  return new Error(`Supabase 이미지 업로드 실패: ${error.message} (${details.join(', ') || error.name})`, { cause: error });
}

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
  private readonly client;
  private readonly bucket;

  constructor(private readonly config: PublishConfig, private readonly sleep: (ms: number) => Promise<unknown> = delay) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
          const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
          return fetch(input, { ...init, signal });
        },
      },
    });
    this.bucket = this.client.storage.from(config.supabaseBucket);
  }

  async checkBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.config.supabaseBucket);
    if (error || !data) throw new Error('Supabase 버킷 조회 실패. 프로젝트 URL, 서버 키, 버킷 이름을 확인하세요.');
    if (!data.public) throw new Error('Instagram이 이미지를 읽을 수 있도록 설정된 버킷이 Public이어야 합니다.');
  }

  async uploadImage(path: string, objectPath: string): Promise<string> {
    const bytes = await readFile(path);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Story JPEG가 8MB를 초과합니다.');
    for (let attempt = 1; ; attempt++) {
      const { error } = await this.bucket.upload(objectPath, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      // A lost response can leave the object stored. Never overwrite it: verify its bytes below.
      if (!error || isDuplicate(error)) break;
      if (attempt >= IMAGE_ATTEMPTS || !isTransient(error)) throw uploadError(error);
      console.warn(`Supabase 이미지 업로드 재시도 ${attempt}/${IMAGE_ATTEMPTS - 1}: ${safeError(uploadError(error))}`);
      await this.sleep(1_000 * 2 ** (attempt - 1));
    }
    const { data } = this.bucket.getPublicUrl(objectPath);
    // Retry the read separately so a transient public URL failure never repeats a successful upload.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.verifyImage(data.publicUrl, bytes);
        return data.publicUrl;
      } catch (error) {
        const notReady = error instanceof Error && 'status' in error && error.status === 404;
        if (attempt >= IMAGE_ATTEMPTS || (!notReady && !isTransient(error))) throw error;
        await this.sleep(1_000 * 2 ** (attempt - 1));
      }
    }
  }

  private async verifyImage(url: string, bytes: Buffer): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`업로드 이미지의 공개 URL 검증에 실패했습니다: HTTP ${response.status}`), { status: response.status });
    }
    if (contentType !== 'image/jpeg') {
      await response.body?.cancel();
      throw new Error('업로드 이미지의 공개 URL 검증에 실패했습니다: JPEG가 아닙니다.');
    }
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (!downloaded.equals(bytes)) {
      throw new Error('업로드 이미지의 공개 URL 검증에 실패했습니다.');
    }
  }

  async writeRecord(record: PostRecord): Promise<void> {
    const { error } = await this.bucket.upload(`_posts/${record.date}/${record.mode}/${record.runId}.json`, JSON.stringify(record, null, 2), {
      contentType: 'application/json', upsert: true, cacheControl: '0',
    });
    if (error) throw new Error(`게시 기록 저장 실패: ${error.message}`);
  }

  async readWeeklyJson(path: string): Promise<unknown | undefined> {
    const { data, error } = await this.bucket.download(`_weekly/${path}`);
    if (error) {
      const code = 'statusCode' in error ? String(error.statusCode) : '';
      if (code === '404' || ('code' in error && error.code === 'NoSuchKey')) return undefined;
      throw new Error(`주간 게시 기록 조회 실패: ${error.message}`);
    }
    if (!data) throw new Error('주간 게시 기록 본문이 없습니다.');
    return JSON.parse(await data.text()) as unknown;
  }

  async writeWeeklyJson(path: string, record: unknown, upsert = true): Promise<void> {
    const { error } = await this.bucket.upload(`_weekly/${path}`, JSON.stringify(record, null, 2), {
      contentType: 'application/json', upsert, cacheControl: '0',
    });
    if (error) throw new Error(`주간 게시 기록/잠금 저장 실패 (${path}): ${error.message}`);
  }

  async removeWeeklyLock(path: string): Promise<void> {
    const { error } = await this.bucket.remove([`_weekly/${path}/lock.json`]);
    if (error) throw new Error(`주간 게시 잠금 해제 실패: ${error.message}`);
  }
}
