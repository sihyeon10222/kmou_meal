import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig, safeError } from './config.js';
import { fetchDailyMenu, seoulDate, validateDate } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import { createStoryRenderer } from './render-story.js';
import { parseRunMode } from './story-modes.js';
import { runStories } from './run-stories.js';
import { StoryStorage } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';
import { postStory } from './post-story.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preview = args[0] === '--preview';
  if (preview) args.shift();
  if (args.length > 2) throw new Error('사용법: npm start -- <run_mode> [기준일 YYYY-MM-DD]');
  const mode = parseRunMode(args[0] || process.env.RUN_MODE || 'tomorrow_full_batch');
  const baseDate = validateDate(args[1] || process.env.BASE_DATE?.trim() || seoulDate());
  await mkdir('output', { recursive: true });
  // 미리보기·주말 skip에서는 게시 서비스를 초기화하지 않습니다.
  let services: Promise<{ storage: StoryStorage; instagram: InstagramPublisher }> | undefined;
  const getServices = () => services ??= (async () => {
    const config = loadConfig();
    const storage = new StoryStorage(config);
    const instagram = new InstagramPublisher(config);
    await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
    return { storage, instagram };
  })();
  const renderer = createStoryRenderer();
  const results = await runStories(mode, baseDate, preview, {
    fetchDormitory: fetchDailyMenu,
    fetchCoop: fetchCoopDailyMenu,
    render: async data => {
      const image = await renderer.render(data);
      await writeFile(`output/${data.request.targetDate}-${data.request.mode}.menu.json`, JSON.stringify(data, null, 2));
      console.log(`Story 이미지: ${image}`);
      return image;
    },
    publish: async (data, image) => {
      const { storage, instagram } = await getServices();
      const { targetDate, mode: storyMode } = data.request;
      return postStory(targetDate, storyMode, image, storage, instagram, async record => {
        await writeFile(`output/${targetDate}-${storyMode}-${record.runId}.publish.json`, JSON.stringify(record, null, 2));
      });
    },
  }).finally(() => renderer.close());
  await writeFile(`output/${baseDate}-${mode}-${randomUUID()}.run.json`, JSON.stringify({ mode, baseDate, preview, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
