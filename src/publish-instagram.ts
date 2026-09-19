import { setTimeout as delay } from 'node:timers/promises';
import type { PublishConfig } from './config.js';

const GRAPH_API_URL = 'https://graph.instagram.com/';
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const CONTAINER_POLL_ATTEMPTS = 36;
const STORY_POLL_ATTEMPTS = 6;
const RECOVERY_DELAY_MS = 10_000;

type GraphData = Record<string, unknown>;

function isGraphData(value: unknown): value is GraphData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(data: GraphData, field: string, message: string): string {
  const value = data[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value;
}

function errorCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export class InstagramApiError extends Error {
  constructor(readonly httpStatus: number, readonly code?: number, readonly subcode?: number) {
    super(`Instagram API 실패: HTTP ${httpStatus}, code=${code ?? '-'}, subcode=${subcode ?? '-'}`);
    this.name = 'InstagramApiError';
  }
}

export class InstagramPublisher {
  constructor(private readonly config: PublishConfig, private readonly sleep: (ms: number) => Promise<unknown> = delay) {}

  private async request(path: string, method: 'GET' | 'POST', parameters: Record<string, string>): Promise<GraphData> {
    const url = new URL(path, GRAPH_API_URL);
    const params = new URLSearchParams(parameters);
    if (method === 'GET') url.search = params.toString();
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.config.igAccessToken}` },
      ...(method === 'POST' ? { body: params } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 응답 본문은 신뢰하지 않으며 API 오류에 토큰이나 외부 메시지를 포함하지 않습니다.
    const data: unknown = await response.json().catch(() => undefined);
    const apiError = isGraphData(data) ? data.error : undefined;
    if (!response.ok || apiError) {
      const details = isGraphData(apiError) ? apiError : {};
      throw new InstagramApiError(response.status, errorCode(details.code), errorCode(details.error_subcode));
    }
    if (!isGraphData(data)) throw new Error('Instagram API 응답이 올바른 JSON 객체가 아닙니다.');
    return data;
  }

  async checkAccount(): Promise<void> {
    const account = await this.request('me', 'GET', { fields: 'id,username' });
    if (account.id !== this.config.igUserId || account.username !== 'kmou_meal') {
      throw new Error('Instagram 토큰의 계정이 설정된 @kmou_meal과 다릅니다.');
    }
  }

  async createContainer(imageUrl: string): Promise<string> {
    const data = await this.request(`${this.config.igUserId}/media`, 'POST', { media_type: 'STORIES', image_url: imageUrl });
    return requiredString(data, 'id', 'Instagram container ID가 없습니다.');
  }

  async containerStatus(id: string): Promise<string> {
    const data = await this.request(id, 'GET', { fields: 'status_code' });
    return requiredString(data, 'status_code', 'Instagram container 상태가 없습니다.');
  }

  async waitUntilReady(id: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
      const status = await this.containerStatus(id);
      if (status === 'FINISHED') return;
      if (status !== 'IN_PROGRESS') throw new Error(`Instagram container 상태: ${status}`);
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error('Instagram 이미지 처리 대기 시간이 초과되었습니다.');
  }

  /** POST를 자동 재시도하지 않습니다. 응답 유실 시 먼저 게시 상태를 확인해야 합니다. */
  async publish(containerId: string): Promise<string> {
    const data = await this.request(`${this.config.igUserId}/media_publish`, 'POST', { creation_id: containerId });
    return requiredString(data, 'id', 'Instagram 게시 media ID가 없습니다.');
  }

  async publishStory(imageUrl: string, onContainer: (id: string) => Promise<void>): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const containerId = await this.createContainer(imageUrl);
      await onContainer(containerId);
      await this.waitUntilReady(containerId);
      await this.sleep(POLL_INTERVAL_MS);
      try {
        return await this.publish(containerId);
      } catch (error) {
        if (attempt !== 0 || !(error instanceof InstagramApiError)
          || error.code !== 24 || error.subcode !== 2207006) throw error;
        console.warn('Instagram 24/2207006: 10초 후 새 container로 복구합니다 (복구 1/1).');
        await this.sleep(RECOVERY_DELAY_MS);
      }
    }
    throw new Error('Instagram 게시 시도 횟수를 초과했습니다.');
  }

  /** Feed images omit media_type; carousel children are never published alone. */
  async publishFeed(imageUrls: string[], caption: string, onContainer: (id: string) => Promise<void>, beforePublish: () => Promise<void>): Promise<string> {
    if (imageUrls.length !== 1 && imageUrls.length !== 2) throw new Error('주간 피드는 1장 또는 2장이어야 합니다.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const children: string[] = [];
      for (const imageUrl of imageUrls) {
        const parameters: Record<string, string> = { image_url: imageUrl };
        if (imageUrls.length > 1) parameters.is_carousel_item = 'true';
        else parameters.caption = caption;
        const container = await this.request(`${this.config.igUserId}/media`, 'POST', parameters);
        const id = requiredString(container, 'id', 'Instagram feed container ID가 없습니다.');
        await onContainer(id);
        await this.waitUntilReady(id);
        children.push(id);
      }
      let parent = children[0]!;
      if (children.length > 1) {
        const container = await this.request(`${this.config.igUserId}/media`, 'POST', {
          media_type: 'CAROUSEL', children: children.join(','), caption,
        });
        parent = requiredString(container, 'id', 'Instagram carousel container ID가 없습니다.');
        await onContainer(parent);
        await this.waitUntilReady(parent);
      }
      await this.sleep(POLL_INTERVAL_MS);
      await beforePublish();
      try { return await this.publish(parent); }
      catch (error) {
        if (attempt !== 0 || !(error instanceof InstagramApiError) || error.code !== 24 || error.subcode !== 2207006) throw error;
        console.warn('Instagram feed 24/2207006: 10초 후 새 container로 복구합니다 (복구 1/1).');
        await this.sleep(RECOVERY_DELAY_MS);
      }
    }
    throw new Error('Instagram 피드 게시 시도 횟수를 초과했습니다.');
  }

  async verifyFeed(mediaId: string, imageCount: number): Promise<void> {
    const media = await this.request(mediaId, 'GET', { fields: 'id,media_type,children{id}' });
    if (media.id !== mediaId || media.media_type !== (imageCount === 1 ? 'IMAGE' : 'CAROUSEL_ALBUM')) {
      throw new Error('Instagram 피드 게시 결과 확인 실패');
    }
    if (imageCount > 1 && (!isGraphData(media.children) || !Array.isArray(media.children.data) || media.children.data.length !== imageCount)) {
      throw new Error('Instagram 캐러셀 이미지 수 확인 실패');
    }
  }

  async verifyStory(mediaId: string): Promise<{ id: string; mediaType: string; timestamp: string }> {
    const media = await this.request(mediaId, 'GET', { fields: 'id,media_type,timestamp' });
    if (media.id !== mediaId || media.media_type !== 'IMAGE') throw new Error('게시된 이미지 확인 실패');
    const timestamp = requiredString(media, 'timestamp', '게시된 이미지 확인 실패');
    for (let attempt = 0; attempt < STORY_POLL_ATTEMPTS; attempt++) {
      const stories = await this.request(`${this.config.igUserId}/stories`, 'GET', { fields: 'id', limit: '100' });
      if (!Array.isArray(stories.data) || !stories.data.every(story => isGraphData(story) && typeof story.id === 'string')) {
        throw new Error('Instagram 활성 Story 목록 응답 형식이 올바르지 않습니다.');
      }
      if (stories.data.some((story: GraphData) => story.id === mediaId)) {
        return { id: mediaId, mediaType: media.media_type, timestamp };
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error('게시 응답은 성공했지만 활성 Story 목록에서 아직 확인되지 않습니다. 재게시하지 말고 계정을 확인하세요.');
  }
}
