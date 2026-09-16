import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadConfig, safeError } from './config.js';
import { fetchDailyMenu, seoulDate } from './fetch-menu.js';
import { renderStory } from './render-story.js';
import { StoryStorage, type PostRecord } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preview = args[0] === '--preview';
  if (args.length > (preview ? 2 : 0)) throw new Error('사용법: npm start 또는 npm run preview -- [YYYY-MM-DD]');
  const date = preview ? args[1] ?? seoulDate() : seoulDate();
  const menu = await fetchDailyMenu(date);
  if (!menu || (!menu.lunch.length && !menu.dinner.length)) {
    console.log(`${date}: 등록된 중식·석식이 없어 게시를 건너뜁니다.`);
    return;
  }
  const imagePath = await renderStory(menu);
  await writeFile(`output/${date}.menu.json`, JSON.stringify(menu, null, 2));
  console.log(`Story 이미지: ${imagePath}`);
  if (preview) return;

  const config = loadConfig();
  const storage = new StoryStorage(config);
  const instagram = new InstagramPublisher(config);
  await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
  const existing = await storage.readRecord(date);
  if (existing?.status === 'published') {
    console.log(`${date}: 이미 게시됨 (media ID ${existing.mediaId}). 중복 게시를 건너뜁니다.`);
    return;
  }
  if (existing) {
    throw new Error(`${date}: 진행 중이거나 결과 확인이 필요한 게시 기록이 있습니다. _posts/${date}.json을 확인하세요. 자동 재게시하지 않습니다.`);
  }

  const objectPath = `${date}/${randomUUID()}.jpg`;
  const imageUrl = await storage.uploadImage(imagePath, objectPath);
  const record: PostRecord = { date, status: 'posting', startedAt: new Date().toISOString(), imagePath: objectPath };
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

main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
