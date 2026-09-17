import { writeFile } from 'node:fs/promises';
import { loadConfig, safeError } from './config.js';
import { fetchDailyMenu, seoulDate } from './fetch-menu.js';
import { renderStory, type StoryMode } from './render-story.js';
import { StoryStorage } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';
import { postStory } from './post-story.js';

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
  const noMenu = !menu || (!lunch.length && !dinner.length);
  const title = mode === 'tomorrow_full' ? '내일의 기숙사 식단' : '오늘의 기숙사 식단';
  const emptyMessage = mode === 'tomorrow_full' ? '내일은 식단이 없습니다.' : '오늘은 식단이 없습니다.';
  const imagePath = await renderStory({ mode, date: menu?.date ?? date.replaceAll('-', '/'), title, lunch, dinner, noMenu, emptyMessage });
  await writeFile(`output/${date}-${mode}.menu.json`, JSON.stringify({ mode, date: menu?.date ?? date.replaceAll('-', '/'), title, lunch, dinner, noMenu }, null, 2));
  console.log(`Story 이미지: ${imagePath}`);
  if (preview) return;

  const config = loadConfig();
  const storage = new StoryStorage(config);
  const instagram = new InstagramPublisher(config);
  await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
  await postStory(date, mode, imagePath, storage, instagram, async (record) => {
    await writeFile(`output/${date}-${mode}-${record.runId}.publish.json`, JSON.stringify(record, null, 2));
  });
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
