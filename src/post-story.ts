import { randomUUID } from 'node:crypto';
import { safeError } from './config.js';
import type { StoryMode } from './story-modes.js';
import type { StoryStorage, PostRecord } from './upload-supabase.js';
import type { InstagramPublisher } from './publish-instagram.js';

/** 새 호출은 항상 새 게시 실행입니다. 이전 날짜별 기록을 읽거나 잠그지 않습니다. */
export async function postStory(
  date: string, mode: StoryMode, imagePath: string,
  storage: Pick<StoryStorage, 'uploadImage' | 'writeRecord'>,
  instagram: Pick<InstagramPublisher, 'publishStory' | 'verifyStory'>,
  saveReceipt: (record: PostRecord) => Promise<void>,
): Promise<PostRecord> {
  const runId = randomUUID();
  const containerIds: string[] = [];
  const record: PostRecord = {
    runId, date, mode, status: 'posting', startedAt: new Date().toISOString(),
    imagePath: `${date}/${mode}/${runId}.jpg`, containerIds,
  };
  const persist = async () => {
    const snapshot = structuredClone(record);
    // 한 저장소의 실패가 다른 저장소에 게시 상태를 남기는 것까지 막지 않게 합니다.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => saveReceipt(snapshot)),
      Promise.resolve().then(() => storage.writeRecord(snapshot)),
    ]);
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `게시 기록 저장 실패: ${errors.map(error => safeError(error)).join('; ')}`);
    }
  };
  try {
    await persist();
    const imageUrl = await storage.uploadImage(imagePath, record.imagePath);
    console.log(`Supabase 이미지 공개 URL 확인 완료: ${imageUrl}`);
    record.mediaId = await instagram.publishStory(imageUrl, async (id) => {
      record.containerId = id;
      containerIds.push(id);
      await persist();
    });
    record.status = 'published';
    record.publishedAt = new Date().toISOString();
    await persist();
    console.log(`Instagram 게시 성공: ${record.mediaId}`);
    const verified = await instagram.verifyStory(record.mediaId);
    console.log(`활성 Story 확인 완료: ${JSON.stringify(verified)}`);
    return record;
  } catch (error) {
    // 게시 성공 후 저장/조회 실패를 게시 실패로 덮어쓰지 않습니다.
    if (!record.mediaId) record.status = 'failed';
    record.error = safeError(error);
    try { await persist(); } catch (receiptError) {
      console.error(`게시 기록 저장 실패: ${safeError(receiptError)}`);
    }
    throw error;
  }
}
