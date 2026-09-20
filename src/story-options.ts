import { seoulDate, validateDate } from './dates.js';
import { resolveWorkflowMode, type RunMode } from './story-modes.js';

export interface StoryOptions { mode: RunMode; baseDate: string; preview: boolean }

export function parseStoryOptions(args: readonly string[], env: NodeJS.ProcessEnv = process.env): StoryOptions {
  const positional = [...args];
  const preview = positional[0] === '--preview';
  if (preview) positional.shift();
  if (positional.length > 2) throw new Error('사용법: npm start -- <run_mode> [기준일 YYYY-MM-DD]');
  return {
    mode: resolveWorkflowMode(positional[0] || env.RUN_MODE),
    baseDate: validateDate(positional[1] || env.BASE_DATE?.trim() || seoulDate()),
    preview,
  };
}
