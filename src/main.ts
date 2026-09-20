import { safeError } from './config.js';
import { parseStoryOptions } from './story-options.js';
import { executeStories } from './stories.js';

try {
  const results = await executeStories(parseStoryOptions(process.argv.slice(2)));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
