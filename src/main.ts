import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadConfig, safeError } from './config.js';
import { fetchDailyMenu, seoulDate } from './fetch-menu.js';
import { renderStory, type StoryMode } from './render-story.js';
import { StoryStorage, type PostRecord } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preview = args[0] === '--preview';
  const modeArg = preview ? args[1] : args[0];
  const dateArg = preview ? args[2] : args[1];
  const mode = (modeArg || process.env.STORY_MODE || 'tomorrow_full') as StoryMode;
  if (!['today_lunch', 'today_dinner', 'tomorrow_full'].includes(mode)) throw new Error('Story mode가 올바르지 않습니다.');
  if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const today = dateArg ?? seoulDate();
  const date = mode === 'tomorrow_full' ? addDays(today, 1) : today;
  const menu = await fetchDailyMenu(date);
  const lunch = mode === 'today_dinner' ? [] : menu?.lunch ?? [];
  const dinner = mode === 'today_lunch' ? [] : menu?.dinner ?? [];
  if (!menu || (!lunch.length && !dinner.length)) {
    console.log(`${date} (${mode}): 게시할 식단이 없어 건너뜁니다.`);
    return;
  }
  const title = mode === 'tomorrow_full' ? '내일의 기숙사 식단' : '오늘의 기숙사 식단';
  const imagePath = await renderStory({ mode, date: menu.date, title, lunch, dinner });
  await writeFile(`output/${date}-${mode}.menu.json`, JSON.stringify({ mode, date: menu.date, title, lunch, dinner }, null, 2));
  console.log(`Story 이미지: ${imagePath}`);
  if (preview) return;

  const config = loadConfig();
  const storage = new StoryStorage(config);
  const instagram = new InstagramPublisher(config);
  await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
  const existing = await storage.readRecord(date, mode);
  if (existing?.status === 'published') {
    console.log(`${date} (${mode}): 이미 게시됨 (media ID ${existing.mediaId}). 중복 게시를 건너뜁니다.`);
    return;
  }
  if (existing) {
    throw new Error(`${date} (${mode}): 진행 중이거나 결과 확인이 필요한 게시 기록이 있습니다. 자동 재게시하지 않습니다.`);
  }

  const objectPath = `${date}/${mode}/${randomUUID()}.jpg`;
  const imageUrl = await storage.uploadImage(imagePath, objectPath);
  const record: PostRecord = { date, mode, status: 'posting', startedAt: new Date().toISOString(), imagePath: objectPath };
  await storage.writeRecord(record, true);
  console.log(`Supabase 이미지 공개 URL 확인 완료: ${imageUrl}`);

  record.containerId = await instagram.createContainer(imageUrl);
  await storage.writeRecord(record);
  await instagram.waitUntilReady(record.containerId);
  record.mediaId = await instagram.publish(record.containerId);
  record.status = 'published';
  record.publishedAt = new Date().toISOString();
  // 외부 조회 검증보다 먼저 게시 성공을 기록하여 재시도 시 중복 게시를 방지합니다.
  await writeFile(`output/${date}.publish.json`, JSON.stringify(record, null, 2));
  await storage.writeRecord(record);
  console.log(`Instagram 게시 성공: ${record.mediaId}`);
  const verified = await instagram.verifyStory(record.mediaId);
  console.log(`활성 Story 확인 완료: ${JSON.stringify(verified)}`);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
