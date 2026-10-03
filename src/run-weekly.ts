import { seoulDate } from './dates.js';
import { safeError } from './config.js';
import { WEEKLY_KINDS, type WeeklyKind, type WeeklyRange, type WeeklyData } from './weekly-data.js';
import { prepareWeekly, hasFutureAddition } from './weekly-snapshot.js';
import type { WeeklyRecord } from './post-weekly.js';

export interface WeeklyImages { images: string[]; master?: string }
export interface WeeklyResult {
  kind: WeeklyKind; week: string; status: 'published' | 'replaced' | 'skipped' | 'deferred' | 'preview' | 'failed';
  images?: string[]; mediaId?: string; replacedMediaId?: string; error?: string;
}
export interface WeeklyDependencies {
  fetch: (kind: WeeklyKind, range: WeeklyRange) => Promise<WeeklyData>;
  render: (data: WeeklyData) => Promise<WeeklyImages>;
  published: (week: string, kind: WeeklyKind) => Promise<WeeklyRecord | undefined>;
  post: (data: WeeklyData, images: string[], force: boolean) => Promise<{ mediaId: string; skipped: boolean; replacedMediaId?: string }>;
}
/** Process each feed independently so a failed kind can be retried after the others publish. */
export async function runWeekly(range: WeeklyRange, kind: WeeklyKind | 'all', preview: boolean, force: boolean, deps: WeeklyDependencies, today = seoulDate()): Promise<WeeklyResult[]> {
  const results: WeeklyResult[] = [];
  for (const current of kind === 'all' ? WEEKLY_KINDS : [kind]) {
    const result: WeeklyResult = { kind: current, week: range.week, status: 'failed' };
    try {
      const existing = !preview ? await deps.published(range.week, current) : undefined;
      if (existing && !force && !existing.menuSnapshot) { result.status = 'skipped'; result.mediaId = existing.mediaId!; }
      else {
        const fetched = await deps.fetch(current, range);
        if (!preview && !force && !hasFutureAddition(fetched, existing?.menuSnapshot ?? [], today)) {
          result.status = existing ? 'skipped' : 'deferred';
          if (existing) result.mediaId = existing.mediaId!;
          results.push(result); continue;
        }
        const data = prepareWeekly(fetched, existing?.menuSnapshot, today, !!existing);
        if (!data) {
          result.status = 'deferred';
          if (existing) result.mediaId = existing.mediaId!;
          results.push(result); continue;
        }
        result.images = (await deps.render(data)).images;
        if (preview) result.status = 'preview';
        else {
          const posted = await deps.post(data, result.images, force);
          result.mediaId = posted.mediaId;
          if (posted.replacedMediaId) result.replacedMediaId = posted.replacedMediaId;
          result.status = posted.skipped ? 'skipped' : posted.replacedMediaId ? 'replaced' : 'published';
        }
      }
    } catch (error) { result.error = safeError(error); }
    results.push(result);
  }
  return results;
}
