import { randomUUID } from 'node:crypto';
import { safeError } from './config.js';
import { InstagramApiError, type InstagramPublisher } from './publish-instagram.js';
import type { StoryStorage } from './upload-supabase.js';
import type { WeeklyData, WeeklyKind } from './weekly-data.js';
import { weeklyMenuHash } from './weekly-snapshot.js';

type Storage = Pick<StoryStorage, 'readWeeklyJson' | 'writeWeeklyJson' | 'removeWeeklyLock' | 'uploadImage'>;
export interface WeeklyRecord {
  week: string; kind: WeeklyKind; runId: string; status: 'preparing' | 'publishing' | 'published' | 'failed';
  startedAt: string; containerIds: string[]; images: string[]; caption: string;
  mediaId?: string; publishedAt?: string; error?: string;
  menuHash?: string;
  supersededMediaIds?: string[];
  pendingNotifications?: WeeklyReplacementNotice[];
  sourceEmptyNotified?: boolean;
}
export interface WeeklyReplacementNotice {
  runId: string; week: string; kind: WeeklyKind; oldMediaId: string; newMediaId?: string;
}
/** A previously published feed cannot be replaced with zero images; ask for manual removal once. */
export async function markWeeklySourceEmpty(storage: Pick<Storage, 'readWeeklyJson' | 'writeWeeklyJson'>,
  week: string, kind: WeeklyKind): Promise<void> {
  const record = await publishedWeekly(storage, week, kind);
  if (!record || record.sourceEmptyNotified) return;
  record.sourceEmptyNotified = true;
  record.pendingNotifications = [...(record.pendingNotifications ?? []), {
    runId: randomUUID(), week, kind, oldMediaId: record.mediaId!,
  }];
  await storage.writeWeeklyJson(`${week}/${kind}/success.json`, record);
}
export async function publishedWeekly(storage: Pick<Storage, 'readWeeklyJson'>, week: string, kind: WeeklyKind): Promise<WeeklyRecord | undefined> {
  const value = await storage.readWeeklyJson(`${week}/${kind}/success.json`);
  if (value === undefined) return undefined;
  const record = value as Partial<WeeklyRecord> | null;
  if (!record || record.week !== week || record.kind !== kind || record.status !== 'published' || typeof record.mediaId !== 'string' || !record.mediaId
    || (record.menuHash !== undefined && !/^[a-f0-9]{64}$/.test(record.menuHash))
    || (record.pendingNotifications !== undefined && !Array.isArray(record.pendingNotifications))) {
    throw new Error('주간 게시 성공 기록이 올바르지 않습니다.');
  }
  return record as WeeklyRecord;
}
export async function postWeekly(data: WeeklyData, images: string[], force: boolean, storage: Storage,
  instagram: Pick<InstagramPublisher, 'publishFeed' | 'verifyFeed'>, saveReceipt: (record: WeeklyRecord) => Promise<void>,
): Promise<{ mediaId: string; skipped: boolean; replacedMediaId?: string }> {
  if (images.length !== (data.kind === 'combined' ? data.pages.length : 2)) throw new Error('주간 게시 이미지 수가 올바르지 않습니다.');
  const path = `${data.week}/${data.kind}`;
  const menuHash = weeklyMenuHash(data);
  const record: WeeklyRecord = { week: data.week, kind: data.kind, runId: randomUUID(), status: 'preparing', startedAt: new Date().toISOString(), containerIds: [], images, caption: data.caption, menuHash };
  // Atomic Storage insert also serializes CLI runs against Actions. Never expire an
  // uncertain publishing lock automatically: Instagram may have accepted the POST.
  await storage.writeWeeklyJson(`${path}/lock.json`, { runId: record.runId, startedAt: record.startedAt }, false);
  let publishAttempted = false;
  let successSaved = false;
  let uncertain = false;
  const persist = async () => {
    const snapshot = structuredClone(record);
    const results = await Promise.allSettled([
      saveReceipt(snapshot), storage.writeWeeklyJson(`${path}/attempts/${record.runId}.json`, snapshot),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  };
  try {
    const existing = await publishedWeekly(storage, data.week, data.kind);
    if (existing && !force && (!existing.menuHash || existing.menuHash === menuHash)) {
      return { mediaId: existing.mediaId!, skipped: true };
    }
    record.supersededMediaIds = existing ? [...new Set([...(existing.supersededMediaIds ?? []), existing.mediaId!])] : [];
    record.pendingNotifications = existing?.pendingNotifications ? [...existing.pendingNotifications] : [];
    await persist();
    const urls: string[] = [];
    for (const [index, image] of images.entries()) {
      urls.push(await storage.uploadImage(image, `weekly/${path}/${record.runId}/${index + 1}.jpg`));
    }
    record.mediaId = await instagram.publishFeed(urls, data.caption, async id => {
      record.containerIds.push(id); await persist();
    }, async () => {
      record.status = 'publishing'; await persist(); publishAttempted = true;
    });
    record.status = 'published'; record.publishedAt = new Date().toISOString();
    if (existing) record.pendingNotifications.push({
      runId: record.runId, week: data.week, kind: data.kind,
      oldMediaId: existing.mediaId!, newMediaId: record.mediaId,
    });
    console.log(`${data.week} ${data.kind} Instagram 게시 성공: ${record.mediaId}`);
    // Commit the deduplication marker immediately after actual publish succeeds.
    await storage.writeWeeklyJson(`${path}/success.json`, record);
    successSaved = true;
    await persist();
    await instagram.verifyFeed(record.mediaId, images.length);
    return { mediaId: record.mediaId, skipped: false, ...(existing ? { replacedMediaId: existing.mediaId! } : {}) };
  } catch (error) {
    uncertain = publishAttempted && (!(error instanceof InstagramApiError) || error.httpStatus >= 500);
    if (!record.mediaId) record.status = uncertain ? 'publishing' : 'failed';
    record.error = safeError(error);
    try { await persist(); } catch (receiptError) { console.error(`주간 실행 기록 저장 실패: ${safeError(receiptError)}`); }
    throw error;
  } finally {
    if (successSaved || (!record.mediaId && !uncertain)) await storage.removeWeeklyLock(path);
    else console.error(`게시 결과가 불확실하여 _weekly/${path}/lock.json을 유지합니다. Instagram과 실행 기록 확인이 필요합니다.`);
  }
}
