import { seoulDate, validateDate } from './dates.js';

export const STORY_MODES = [
  'today_dormitory_breakfast', 'tomorrow_dormitory_breakfast',
  'today_dormitory_lunch', 'today_dormitory_dinner', 'today_dormitory_full',
  'tomorrow_dormitory_lunch', 'tomorrow_dormitory_dinner', 'tomorrow_dormitory_full',
  'today_snack', 'tomorrow_snack',
  'today_teacher_breakfast', 'tomorrow_teacher_breakfast',
  'today_teacher_lunch', 'today_teacher_dinner', 'today_teacher_full',
  'tomorrow_teacher_lunch', 'tomorrow_teacher_dinner', 'tomorrow_teacher_full',
] as const;
export type StoryMode = typeof STORY_MODES[number];
export const BATCH_MODES = ['today_full_batch'] as const;
export type BatchMode = typeof BATCH_MODES[number];
export type RunMode = StoryMode | BatchMode;
export type Restaurant = 'dormitory' | 'snack' | 'teacher';
export type MealScope = 'breakfast' | 'lunch' | 'dinner' | 'full';
export interface StoryRequest {
  mode: StoryMode;
  targetDate: string;
  restaurant: Restaurant;
  scope: MealScope;
  dateLabel: string;
  title: string;
  skip: boolean;
}

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
  if (restaurant !== 'dormitory' && restaurant !== 'snack' && restaurant !== 'teacher') throw new Error('지원하지 않는 식당입니다.');
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
  const title = { dormitory: '기숙사 식단', snack: '학식 식단', teacher: '교직원 식당 식단' }[restaurant];
  return { mode, targetDate, restaurant, scope, dateLabel, title, skip: restaurant !== 'dormitory' && isWeekend(targetDate) };
}

const batches: Record<BatchMode, readonly StoryMode[]> = {
  today_full_batch: ['today_dormitory_full', 'today_snack', 'today_teacher_full'],
};

export function resolveRun(mode: RunMode, baseDate = seoulDate()): StoryRequest[] {
  const modes = Object.hasOwn(batches, mode) ? batches[mode as BatchMode] : [mode as StoryMode];
  return modes.map(story => resolveStoryRequest(story, baseDate));
}
