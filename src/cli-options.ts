import { parseArgs } from 'node:util';
import { seoulDate, validateDate } from './dates.js';
import { resolveManualStoryMode, type RunMode } from './story-modes.js';
import { WEEKLY_KINDS, weeklyRange, type WeeklyKind } from './weekly-data.js';

export interface StoryOptions { mode: RunMode; baseDate: string; preview: boolean }

export function parseCliOptions(args: string[]) {
  const [command, ...options] = args;
  if (command !== 'story' && command !== 'feed') throw new Error('실행 명령: story 또는 feed');
  const { values } = parseArgs({ args: options, options: {
    restaurant: { type: 'string', default: 'all' },
    date: { type: 'string' }, preview: { type: 'boolean', default: false },
    meal: { type: 'string' }, week: { type: 'string' }, force: { type: 'boolean' },
  } });
  const restaurant = values.restaurant;
  const date = validateDate(values.date || seoulDate());
  if (command === 'feed') {
    if (!['all', ...WEEKLY_KINDS].includes(restaurant)) throw new Error('feed restaurant: all / combined / badaro / dormitory');
    if (values.meal !== undefined) throw new Error('--meal은 story 전용입니다.');
    if (values.date && values.week) throw new Error('--date와 --week는 하나만 지정하세요.');
    return { command, restaurant: restaurant as WeeklyKind | 'all', range: weeklyRange(date, values.week), preview: values.preview, force: values.force ?? false } as const;
  }
  if (!['all', 'dormitory', 'badaro', 'snack', 'teacher'].includes(restaurant)) throw new Error('story restaurant: all / dormitory / badaro / snack / teacher');
  if (values.week !== undefined || values.force !== undefined) throw new Error('--week와 --force는 feed 전용입니다.');
  const meal = values.meal ?? 'full';
  if (!['breakfast', 'lunch', 'dinner', 'full'].includes(meal)) throw new Error('meal: breakfast / lunch / dinner / full');
  if (restaurant === 'all' && meal !== 'full') throw new Error('--meal은 --restaurant로 식당을 지정한 뒤 사용하세요.');
  const mode = restaurant === 'all' ? 'today_full_batch' : resolveManualStoryMode('today', restaurant, meal);
  return { command, mode, baseDate: date, preview: values.preview } as const;
}
