import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { fetchDailyMenu, fetchBadaroMenu } from '../../integrations/kmou/residence.js';
import { fetchCoopDailyMenu } from '../../integrations/kmou/coop.js';
import { createStoryRenderer } from '../../rendering/story-renderer.js';
import { runStories } from './run.js';
import { createPublishingServices } from '../../bootstrap/publishing-services.js';
import type { StoryOptions } from '../../../shared/contracts/story.js';
import { postStory } from './post.js';
import { storySummary } from './summary.js';
import { artMode } from '../../../shared/contracts/art.js';
import { createStoryArt } from '../../rendering/art/decorate.js';

export async function executeStories({ mode, baseDate, preview, art }: StoryOptions) {
  await mkdir('output', { recursive: true });
  // 미리보기·주말 skip에서는 게시 서비스를 초기화하지 않습니다.
  const getServices = createPublishingServices();
  const renderer = createStoryRenderer({ art: createStoryArt({
    mode: artMode(art ?? process.env.STORY_ART_MODE, preview ? 'cache' : 'generate'),
  }) });
  const results = await runStories(mode, baseDate, preview, {
    fetchDormitory: fetchDailyMenu,
    fetchBadaro: fetchBadaroMenu,
    fetchCoop: fetchCoopDailyMenu,
    render: async data => {
      const image = await renderer.render(data);
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
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, storySummary(results));
  }
  return results;
}
