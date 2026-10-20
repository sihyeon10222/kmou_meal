import { loadConfig } from '../config/publishing.js';

export async function initializePublishingServices() {
  const config = loadConfig();
  const [{ StoryStorage }, { InstagramPublisher }] = await Promise.all([
    import('../integrations/supabase/storage.js'), import('../integrations/instagram/client.js'),
  ]);
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
