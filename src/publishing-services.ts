import { loadConfig } from './config.js';
import { StoryStorage } from './upload-supabase.js';
import { InstagramPublisher } from './publish-instagram.js';

export async function initializePublishingServices() {
  const config = loadConfig();
  const storage = new StoryStorage(config);
  const instagram = new InstagramPublisher(config);
  await Promise.all([storage.checkBucket(), instagram.checkAccount()]);
  return { storage, instagram };
}

/** Preview/skip never initializes services. Both success and failure are shared within a run. */
export function createPublishingServices(initialize = initializePublishingServices) {
  let services: ReturnType<typeof initialize> | undefined;
  return () => services ??= Promise.resolve().then(initialize);
}
