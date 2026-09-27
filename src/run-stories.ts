import { safeError } from './config.js';
import { fetchDailyMenu } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import { resolveRun, type RunMode, type StoryMode } from './story-modes.js';
import { dormitoryStory, coopStory, type StoryRenderData } from './story-data.js';

export interface RunResult {
  mode: StoryMode;
  targetDate: string;
  status: 'published' | 'preview' | 'skipped' | 'failed';
  imagePath?: string;
  error?: string;
}
export interface RunDependencies {
  fetchDormitory: typeof fetchDailyMenu;
  fetchBadaro: typeof fetchDailyMenu;
  fetchCoop: typeof fetchCoopDailyMenu;
  render: (data: StoryRenderData) => Promise<string>;
  publish: (data: StoryRenderData, imagePath: string) => Promise<unknown>;
}

/** 한 Story의 실패는 다음 Story를 막지 않습니다. 호출자는 결과를 기록하고 실패 종료합니다. */
export async function runStories(mode: RunMode, baseDate: string, preview: boolean, deps: RunDependencies): Promise<RunResult[]> {
  const requests = resolveRun(mode, baseDate);
  const results: RunResult[] = [];
  let coop: ReturnType<typeof fetchCoopDailyMenu> | undefined;
  for (const request of requests) {
    const result: RunResult = { mode: request.mode, targetDate: request.targetDate, status: 'skipped' };
    if (request.skip) {
      console.log(`${request.targetDate} ${request.mode}: 주말 학식 skip`);
      results.push(result);
      continue;
    }
    try {
      const data = request.restaurant === 'dormitory' || request.restaurant === 'badaro'
        ? dormitoryStory(request, await (request.restaurant === 'dormitory'
          ? deps.fetchDormitory(request.targetDate) : deps.fetchBadaro(request.targetDate)))
        : coopStory(request, await (coop ??= deps.fetchCoop(request.targetDate)));
      if (!preview && data.sections.every(section => section.items.length === 0)) {
        throw new Error(`${request.targetDate} ${request.restaurant}: 게시할 식단이 없습니다.`);
      }
      result.imagePath = await deps.render(data);
      if (!preview) await deps.publish(data, result.imagePath);
      result.status = preview ? 'preview' : 'published';
    } catch (error) {
      result.status = 'failed';
      result.error = safeError(error);
      console.error(`${request.mode}: ${result.error}`);
    }
    results.push(result);
  }
  return results;
}
