import '../config/env.js';
import { safeError } from '../support/safe-error.js';
import { parseCliOptions } from './options.js';
import { executeStories } from '../features/story/execute.js';
import { executeWeekly } from '../features/weekly/execute.js';

try {
  const options = parseCliOptions(process.argv.slice(2));
  const results = options.command === 'story'
    ? await executeStories(options)
    : await executeWeekly(options.range, options.restaurant, options.preview, options.force);
  if (results.some(result => result.status === 'failed' || ('warning' in result && result.warning))) process.exitCode = 1;
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
