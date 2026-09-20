import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchDailyMenu, fetchBadaroMenu } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import { createStoryRenderer } from './render-story.js';
import { runStories } from './run-stories.js';
import { createPublishingServices } from './publishing-services.js';
import type { StoryOptions } from './cli-options.js';
import { postStory } from './post-story.js';

export async function executeStories({ mode, baseDate, preview }: StoryOptions) {
  await mkdir('output', { recursive: true });
  // 미리보기·주말 skip에서는 게시 서비스를 초기화하지 않습니다.
  const getServices = createPublishingServices();
  const renderer = createStoryRenderer();
  const results = await runStories(mode, baseDate, preview, {
    fetchDormitory: fetchDailyMenu,
    fetchBadaro: fetchBadaroMenu,
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
  return results;
}
