import { parseArgs } from 'node:util';
import { safeError } from './config.js';
import { seoulDate } from './dates.js';
import { WEEKLY_KINDS, weeklyRange, type WeeklyKind } from './weekly-data.js';
import { executeWeekly } from './weekly.js';

async function main() {
  const { values } = parseArgs({ options: {
    preview: { type: 'boolean', default: false }, force: { type: 'boolean', default: false },
    kind: { type: 'string' }, 'base-date': { type: 'string' }, week: { type: 'string' },
  } });
  const kind = values.kind || process.env.WEEKLY_KIND || 'all';
  if (kind !== 'all' && !WEEKLY_KINDS.includes(kind as WeeklyKind)) throw new Error('게시물 종류: teacher / snack / dormitory / all');
  const baseDate = values['base-date'] || process.env.BASE_DATE?.trim() || seoulDate();
  const week = values.week || process.env.TARGET_WEEK?.trim();
  const range = weeklyRange(baseDate, week);
  const preview = values.preview || process.env.PREVIEW_ONLY === 'true';
  const force = values.force || process.env.FORCE_PUBLISH === 'true';
  const results = await executeWeekly(range, kind as WeeklyKind | 'all', preview, force);
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
