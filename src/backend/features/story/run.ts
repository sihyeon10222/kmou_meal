import { safeError } from '../../support/safe-error.js';
import { fetchDailyMenu } from '../../integrations/kmou/residence.js';
import { fetchCoopDailyMenu } from '../../integrations/kmou/coop.js';
import { resolveRun } from './modes.js';
import type { RunMode, StoryMode, StoryRenderData } from '../../../shared/contracts/story.js';
import { dormitoryStory, coopStory } from './data.js';
import { PublishedStoryError } from './post.js';
import type { StoryArtReport } from '../../rendering/art/decorate.js';

export interface RunResult {
  mode: StoryMode;
  targetDate: string;
  status: 'published' | 'preview' | 'skipped' | 'failed';
  imagePath?: string;
  error?: string;
  warning?: string;
  mediaId?: string;
  emptyMenu?: boolean;
  art?: StoryArtReport;
  stage?: 'fetch' | 'render' | 'publish';
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
      result.stage = 'fetch';
      const data = request.restaurant === 'dormitory' || request.restaurant === 'badaro'
        ? dormitoryStory(request, await (request.restaurant === 'dormitory'
          ? deps.fetchDormitory(request.targetDate) : deps.fetchBadaro(request.targetDate)))
        : coopStory(request, await (coop ??= deps.fetchCoop(request.targetDate).catch(error => {
          coop = undefined;
          throw error;
        })));
      result.emptyMenu = data.sections.every(section => section.items.length === 0);
      if (result.emptyMenu) {
        console.info(`${request.targetDate} ${request.restaurant}: 정상 조회, 등록된 식단 없음 안내를 생성합니다.`);
      }
      result.stage = 'render';
      result.imagePath = await deps.render(data);
      if (!preview) {
        result.stage = 'publish';
        const posted = await deps.publish(data, result.imagePath);
        if (typeof posted === 'object' && posted !== null && 'mediaId' in posted && typeof posted.mediaId === 'string') {
          result.mediaId = posted.mediaId;
        }
      }
      result.status = preview ? 'preview' : 'published';
      delete result.stage;
    } catch (error) {
      if (error instanceof PublishedStoryError) {
        result.status = 'published';
        result.mediaId = error.mediaId;
        result.warning = safeError(error);
        delete result.stage;
        console.warn(`${request.mode}: ${result.warning}`);
      } else {
        result.status = 'failed';
        result.error = safeError(error);
        console.error(`${request.mode} (${result.stage}): ${result.error}`);
      }
    }
    results.push(result);
  }
  return results;
}
