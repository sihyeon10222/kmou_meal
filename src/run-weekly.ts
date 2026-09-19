import { safeError } from './config.js';
import { WEEKLY_KINDS, type WeeklyKind, type WeeklyRange, type WeeklyData } from './weekly-data.js';

export interface WeeklyImages { images: string[]; master?: string }
export interface WeeklyResult {
  kind: WeeklyKind; week: string; status: 'published' | 'skipped' | 'preview' | 'failed';
  images?: string[]; mediaId?: string; error?: string;
}
export interface WeeklyDependencies {
  fetch: (kind: WeeklyKind, range: WeeklyRange) => Promise<WeeklyData>;
  render: (data: WeeklyData) => Promise<WeeklyImages>;
  published: (week: string, kind: WeeklyKind) => Promise<string | undefined>;
  post: (data: WeeklyData, images: string[], force: boolean) => Promise<{ mediaId: string; skipped: boolean }>;
}
/** Fail fast preserves Teacher → Snack → Dormitory ordering, including partial reruns. */
export async function runWeekly(range: WeeklyRange, kind: WeeklyKind | 'all', preview: boolean, force: boolean, deps: WeeklyDependencies): Promise<WeeklyResult[]> {
  const results: WeeklyResult[] = [];
  for (const current of kind === 'all' ? WEEKLY_KINDS : [kind]) {
    const result: WeeklyResult = { kind: current, week: range.week, status: 'failed' };
    try {
      const existing = !preview && !force ? await deps.published(range.week, current) : undefined;
      if (existing) { result.status = 'skipped'; result.mediaId = existing; }
      else {
        const data = await deps.fetch(current, range);
        result.images = (await deps.render(data)).images;
        if (preview) result.status = 'preview';
        else {
          const posted = await deps.post(data, result.images, force);
          result.mediaId = posted.mediaId;
          result.status = posted.skipped ? 'skipped' : 'published';
        }
      }
    } catch (error) { result.error = safeError(error); }
    results.push(result);
    if (result.status === 'failed') break;
  }
  return results;
}
export function requireWeeklyComplete(results: WeeklyResult[], preview: boolean): void {
  if (results.length !== 3 || results.some((result, index) => result.kind !== WEEKLY_KINDS[index]
    || !(preview ? ['preview'] : ['published', 'skipped']).includes(result.status))) {
    throw new Error('주간 피드 3종이 완료되지 않아 Story 배치를 실행하지 않습니다.');
  }
}
export function needsWeeklyFirst(mode: string, baseDate: string): boolean {
  return mode === 'tomorrow_full_batch' && new Date(`${baseDate}T12:00:00Z`).getUTCDay() === 0;
}
