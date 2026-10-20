import type { MenuSection } from './menu.js';
import type { StoryArtMode } from './art.js';

export const STORY_MODES = [
  'today_badaro_breakfast', 'tomorrow_badaro_breakfast',
  'today_badaro_lunch', 'today_badaro_dinner', 'today_badaro_full',
  'tomorrow_badaro_lunch', 'tomorrow_badaro_dinner', 'tomorrow_badaro_full',
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
export type Restaurant = 'dormitory' | 'badaro' | 'snack' | 'teacher';
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

export interface StoryRenderData { request: StoryRequest; sections: MenuSection[] }
export interface StoryOptions { mode: RunMode; baseDate: string; preview: boolean; art?: StoryArtMode }
