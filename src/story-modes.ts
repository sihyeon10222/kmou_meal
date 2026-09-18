import { seoulDate, validateDate } from './fetch-menu.js';

export const STORY_MODES = [
  'today_dormitory_lunch', 'today_dormitory_dinner', 'today_dormitory_full',
  'tomorrow_dormitory_lunch', 'tomorrow_dormitory_dinner', 'tomorrow_dormitory_full',
  'today_snack', 'tomorrow_snack',
  'today_teacher_lunch', 'today_teacher_dinner', 'today_teacher_full',
  'tomorrow_teacher_lunch', 'tomorrow_teacher_dinner', 'tomorrow_teacher_full',
] as const;
export type StoryMode = typeof STORY_MODES[number];
export const BATCH_MODES = ['today_lunch_batch', 'today_dinner_batch', 'tomorrow_full_batch'] as const;
export type BatchMode = typeof BATCH_MODES[number];
export type RunMode = StoryMode | BatchMode;
export type Restaurant = 'dormitory' | 'snack' | 'teacher';
export type MealScope = 'lunch' | 'dinner' | 'full';
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

/** 전환 중 기존 cron 요청도 해당 시간대의 새 batch로 실행합니다. */
export function resolveWorkflowMode(input?: string, legacy?: string): RunMode {
  if (legacy) {
    const aliases: Record<string, BatchMode> = { today_lunch: 'today_lunch_batch', today_dinner: 'today_dinner_batch', tomorrow_full: 'tomorrow_full_batch' };
    const mode = Object.hasOwn(aliases, legacy) ? aliases[legacy] : undefined;
    if (!mode) throw new Error(`지원하지 않는 이전 실행 모드: ${legacy}`);
    return mode;
  }
  return parseRunMode(input || 'tomorrow_full_batch');
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
  today_lunch_batch: ['today_dormitory_lunch', 'today_snack', 'today_teacher_lunch'],
  today_dinner_batch: ['today_dormitory_dinner', 'today_teacher_dinner'],
  tomorrow_full_batch: ['tomorrow_dormitory_full', 'tomorrow_snack', 'tomorrow_teacher_full'],
};

export function resolveRun(mode: RunMode, baseDate = seoulDate()): StoryRequest[] {
  const modes = mode in batches ? batches[mode as BatchMode] : [mode as StoryMode];
  return modes.map(story => resolveStoryRequest(story, baseDate));
}
