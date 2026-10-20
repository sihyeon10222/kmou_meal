import '../config/env.js';
import { loadConfig } from '../config/publishing.js';
import { safeError } from '../support/safe-error.js';
import { InstagramPublisher } from '../integrations/instagram/client.js';
import { StoryStorage } from '../integrations/supabase/storage.js';

try {
  const config = loadConfig();
  await new InstagramPublisher(config).checkAccount();
  console.log('Instagram: @kmou_meal 계정과 토큰 확인 완료');
  await new StoryStorage(config).checkBucket();
  console.log('Supabase: stories Public 버킷 및 서버 키 확인 완료');
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
