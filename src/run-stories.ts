import { safeError } from './config.js';
import { fetchDailyMenu } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import { resolveRun, type RunMode, type StoryMode } from './story-modes.js';
import { dormitoryStory, coopStory, type StoryRenderData, type FoodImageResult } from './story-data.js';
import { PublishedStoryError } from './post-story.js';
import { shouldGenerateFoodImage } from './tray-profiles.js';

export interface RunResult {
  mode: StoryMode;
  targetDate: string;
  status: 'published' | 'preview' | 'skipped' | 'failed';
  imagePath?: string;
  error?: string;
  warning?: string;
  mediaId?: string;
  emptyMenu?: boolean;
  aiImages?: FoodImageResult[];
  stage?: 'fetch' | 'render' | 'publish';
}
export interface RunDependencies {
  fetchDormitory: typeof fetchDailyMenu;
  fetchBadaro: typeof fetchDailyMenu;
  fetchCoop: typeof fetchCoopDailyMenu;
  prepareImages?: (data: StoryRenderData) => Promise<StoryRenderData>;
  render: (data: StoryRenderData) => Promise<string>;
  publish: (data: StoryRenderData, imagePath: string) => Promise<unknown>;
}

function withoutFoodImages(original: StoryRenderData, attempted: StoryRenderData, error: unknown): StoryRenderData {
  const message = safeError(error);
  console.warn(`${original.request.mode}: AI 사진을 제외하고 식단표를 생성합니다. ${message}`);
  return {
    ...structuredClone(original),
    aiImages: original.sections.map(section => {
      const previous = attempted.aiImages?.find(image => image.meal === section.key);
      if (previous?.status === 'failed' || previous?.status === 'skipped') return previous;
      return { meal: section.key, status: section.items.length && shouldGenerateFoodImage(original.request.restaurant, section.key)
        ? 'failed' : 'skipped', error: message };
    }),
  };
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
      let data = request.restaurant === 'dormitory' || request.restaurant === 'badaro'
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
      // Keep the fetched menu intact even if an optional preparer mutates its input before failing.
      const original = structuredClone(data);
      if (deps.prepareImages) {
        try {
          data = await deps.prepareImages(data);
        } catch (error) {
          data = withoutFoodImages(original, data, error);
        }
      }
      if (data.aiImages) result.aiImages = data.aiImages;
      try {
        result.imagePath = await deps.render(data);
      } catch (error) {
        if (!data.sections.some(section => section.image)) throw error;
        data = withoutFoodImages(original, data, error);
        if (data.aiImages) result.aiImages = data.aiImages;
        result.imagePath = await deps.render(data);
      }
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
