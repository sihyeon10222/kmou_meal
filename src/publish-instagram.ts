import { setTimeout as delay } from 'node:timers/promises';
import type { PublishConfig } from './config.js';

interface GraphData {
  id?: string;
  username?: string;
  status_code?: string;
  media_type?: string;
  timestamp?: string;
  data?: { id: string }[];
  error?: { code?: number; error_subcode?: number };
}

export class InstagramApiError extends Error {
  constructor(readonly httpStatus: number, readonly code?: number, readonly subcode?: number) {
    super(`Instagram API 실패: HTTP ${httpStatus}, code=${code ?? '-'}, subcode=${subcode ?? '-'}`);
    this.name = 'InstagramApiError';
  }
}

export class InstagramPublisher {
  constructor(private config: PublishConfig, private sleep: (ms: number) => Promise<unknown> = delay) {}

  private async request(path: string, method: 'GET' | 'POST', parameters: Record<string, string>): Promise<GraphData> {
    const url = new URL(`https://graph.instagram.com/${path}`);
    const params = new URLSearchParams(parameters);
    if (method === 'GET') url.search = params.toString();
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.config.igAccessToken}` },
      ...(method === 'POST' ? { body: params } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json() as GraphData;
    if (!response.ok || data.error) {
      throw new InstagramApiError(response.status, data.error?.code, data.error?.error_subcode);
    }
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
    if (!data.id) throw new Error('Instagram container ID가 없습니다.');
    return data.id;
  }

  async containerStatus(id: string): Promise<string> {
    const data = await this.request(id, 'GET', { fields: 'status_code' });
    if (!data.status_code) throw new Error('Instagram container 상태가 없습니다.');
    return data.status_code;
  }

  async waitUntilReady(id: string): Promise<void> {
    for (let attempt = 0; attempt < 36; attempt++) {
      const status = await this.containerStatus(id);
      if (status === 'FINISHED') return;
      if (status !== 'IN_PROGRESS') throw new Error(`Instagram container 상태: ${status}`);
      await this.sleep(5_000);
    }
    throw new Error('Instagram 이미지 처리 대기 시간이 초과되었습니다.');
  }

  /** POST를 자동 재시도하지 않습니다. 응답 유실 시 먼저 게시 상태를 확인해야 합니다. */
  async publish(containerId: string): Promise<string> {
    const data = await this.request(`${this.config.igUserId}/media_publish`, 'POST', { creation_id: containerId });
    if (!data.id) throw new Error('Instagram 게시 media ID가 없습니다.');
    return data.id;
  }

  async publishStory(imageUrl: string, onContainer: (id: string) => Promise<void>): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const containerId = await this.createContainer(imageUrl);
      await onContainer(containerId);
      await this.waitUntilReady(containerId);
      await this.sleep(5_000);
      try {
        return await this.publish(containerId);
      } catch (error) {
        if (attempt !== 0 || !(error instanceof InstagramApiError)
          || error.code !== 24 || error.subcode !== 2207006) throw error;
        console.warn('Instagram 24/2207006: 10초 후 새 container로 복구합니다 (복구 1/1).');
        await this.sleep(10_000);
      }
    }
    throw new Error('Instagram 게시 시도 횟수를 초과했습니다.');
  }

  async verifyStory(mediaId: string): Promise<{ id: string; mediaType: string; timestamp: string }> {
    const media = await this.request(mediaId, 'GET', { fields: 'id,media_type,timestamp' });
    if (media.id !== mediaId || media.media_type !== 'IMAGE' || !media.timestamp) throw new Error('게시된 이미지 확인 실패');
    for (let attempt = 0; attempt < 6; attempt++) {
      const stories = await this.request(`${this.config.igUserId}/stories`, 'GET', { fields: 'id', limit: '100' });
      if (stories.data?.some((story) => story.id === mediaId)) {
        return { id: mediaId, mediaType: media.media_type, timestamp: media.timestamp };
      }
      await this.sleep(5_000);
    }
    throw new Error('게시 응답은 성공했지만 활성 Story 목록에서 아직 확인되지 않습니다. 재게시하지 말고 계정을 확인하세요.');
  }
}
