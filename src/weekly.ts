import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { StoryStorage } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';
import { createWeeklyFetcher, type WeeklyKind, type WeeklyRange } from './weekly-data.js';
import { renderWeekly } from './render-weekly.js';
import { runWeekly } from './run-weekly.js';
import { postWeekly, publishedWeekly } from './post-weekly.js';

export async function executeWeekly(range: WeeklyRange, kind: WeeklyKind | 'all', preview: boolean, force = false) {
  await mkdir('output', { recursive: true });
  let services: Promise<{ storage: StoryStorage; instagram: InstagramPublisher }> | undefined;
  const getServices = () => services ??= (async () => {
    const config = loadConfig();
    const storage = new StoryStorage(config);
    const instagram = new InstagramPublisher(config);
    await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
    return { storage, instagram };
  })();
  const results = await runWeekly(range, kind, preview, force, {
    fetch: createWeeklyFetcher(),
    render: renderWeekly,
    published: async (week, current) => publishedWeekly((await getServices()).storage, week, current),
    post: async (data, images, forcePublish) => {
      const { storage, instagram } = await getServices();
      return postWeekly(data, images, forcePublish, storage, instagram, async record => {
        await writeFile(`output/${data.week}-${data.kind}-${record.runId}.publish.json`, JSON.stringify(record, null, 2));
      });
    },
  });
  await writeFile(`output/${range.week}-weekly-${randomUUID()}.run.json`, JSON.stringify({ range, kind, preview, force, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  return results;
}
