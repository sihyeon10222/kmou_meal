import { seoulDate, validateDate } from '../../../shared/dates.js';
import { STORY_MODES, BATCH_MODES, type StoryMode, type BatchMode, type RunMode, type Restaurant, type MealScope, type StoryRequest } from '../../../shared/contracts/story.js';

export function parseRunMode(value: string): RunMode {
  if (![...STORY_MODES, ...BATCH_MODES].includes(value as RunMode)) throw new Error(`지원하지 않는 실행 모드: ${value}`);
  return value as RunMode;
}

export function resolveWorkflowMode(input?: string): RunMode {
  return parseRunMode(input || 'today_full_batch');
}

export function resolveBatchMode(input = 'today_full_batch'): BatchMode {
  const mode = BATCH_MODES.find(mode => mode === input);
  if (!mode) throw new Error(`지원하지 않는 배치 모드: ${input}`);
  return mode;
}

/** Snack has no meal-specific Stories; every valid meal selection resolves to one Story. */
export function resolveManualStoryMode(day: string, restaurant: string, meal: string): StoryMode {
  if (day !== 'today' && day !== 'tomorrow') throw new Error('날짜 선택은 today 또는 tomorrow여야 합니다.');
  if (!['dormitory', 'badaro', 'snack', 'teacher'].includes(restaurant)) throw new Error('지원하지 않는 식당입니다.');
  if (!['breakfast', 'lunch', 'dinner', 'full'].includes(meal)) throw new Error('지원하지 않는 끼니입니다.');
  const value = restaurant === 'snack' ? `${day}_snack` : `${day}_${restaurant}_${meal}`;
  const mode = STORY_MODES.find(mode => mode === value);
  if (!mode) throw new Error(`지원하지 않는 Story 모드: ${value}`);
  return mode;
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${validateDate(date)}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function resolveStoryRequest(mode: StoryMode, baseDate = seoulDate()): StoryRequest {
  if (!STORY_MODES.includes(mode)) throw new Error(`지원하지 않는 Story 모드: ${mode}`);
  const date = new Date(`${validateDate(baseDate)}T12:00:00Z`);
  if (mode.startsWith('tomorrow_')) date.setUTCDate(date.getUTCDate() + 1);
  const targetDate = date.toISOString().slice(0, 10);
  const restaurant = mode.split('_')[1] as Restaurant;
  const scope = (mode.split('_')[2] ?? 'full') as MealScope;
  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(date);
  const dateLabel = `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${weekday}`;
  const title = { dormitory: '기숙사 식단', badaro: '승선생활관 식단', snack: '학식 식단', teacher: '교직원 식당 식단' }[restaurant];
  return { mode, targetDate, restaurant, scope, dateLabel, title, skip: (restaurant === 'snack' || restaurant === 'teacher') && isWeekend(targetDate) };
}

const batches: Record<BatchMode, readonly StoryMode[]> = {
  today_full_batch: ['today_dormitory_full', 'today_badaro_full', 'today_snack', 'today_teacher_full'],
};

export function resolveRun(mode: RunMode, baseDate = seoulDate()): StoryRequest[] {
  const modes = Object.hasOwn(batches, mode) ? batches[mode as BatchMode] : [mode as StoryMode];
  return modes.map(story => resolveStoryRequest(story, baseDate));
}
