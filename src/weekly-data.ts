import { seoulDate, validateDate } from './dates.js';
import { fetchDailyMenu } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import type { MenuSection } from './story-data.js';

export const WEEKLY_KINDS = ['teacher', 'snack', 'dormitory'] as const;
export type WeeklyKind = typeof WEEKLY_KINDS[number];
export interface WeeklyRange { monday: string; dates: string[]; week: string }
export interface WeeklyData {
  kind: WeeklyKind;
  week: string;
  monday: string;
  caption: string;
  days: { date: string; sections: MenuSection[] }[];
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${validateDate(date)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function isoWeek(date: string): string {
  const value = new Date(`${validateDate(date)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const year = value.getUTCFullYear();
  const start = new Date(`${year}-01-01T12:00:00Z`);
  const week = Math.ceil(((value.getTime() - start.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
/** Default/base date means the following calendar week. Explicit YYYY-Www overrides it. */
export function weeklyRange(baseDate = seoulDate(), targetWeek?: string): WeeklyRange {
  validateDate(baseDate);
  let monday: string;
  if (targetWeek) {
    const match = /^(\d{4})-W(\d{2})$/.exec(targetWeek);
    if (!match) throw new Error('대상 주차는 YYYY-Www 형식이어야 합니다.');
    const jan4 = `${match[1]}-01-04`;
    const weekday = new Date(`${jan4}T12:00:00Z`).getUTCDay() || 7;
    monday = addDays(jan4, 1 - weekday + (Number(match[2]) - 1) * 7);
    if (isoWeek(monday) !== targetWeek) throw new Error('존재하지 않는 ISO 주차입니다.');
  } else {
    const weekday = new Date(`${baseDate}T12:00:00Z`).getUTCDay() || 7;
    monday = addDays(baseDate, 8 - weekday);
  }
  return { monday, week: isoWeek(monday), dates: Array.from({ length: 7 }, (_, index) => addDays(monday, index)) };
}
export function weeklyCaption(kind: WeeklyKind, dates: string[]): string {
  const start = dates[0]!;
  const end = dates.at(-1)!;
  const [year, month, day] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const last = `${year !== endYear ? `${endYear}년 ` : ''}${endMonth}월 ${endDay}일`;
  const name = { teacher: '교직원 식당 식단', snack: '학식 식단', dormitory: '기숙사 식단' }[kind];
  const tag = { teacher: '해양대교직원식당', snack: '해양대학식', dormitory: '해양대학생생활관' }[kind];
  return `${year}년 ${month}월 ${day}일 ~ ${last} ${name}입니다.\n\n#해양대학교 #${tag}`;
}
export function createWeeklyFetcher(deps = { dormitory: fetchDailyMenu, coop: fetchCoopDailyMenu }) {
  const coop = new Map<string, ReturnType<typeof fetchCoopDailyMenu>>();
  return async (kind: WeeklyKind, range: WeeklyRange): Promise<WeeklyData> => {
    const dates = range.dates.slice(0, kind === 'dormitory' ? 7 : 5);
    const days: WeeklyData['days'] = [];
    for (const date of dates) {
      let sections: MenuSection[];
      if (kind === 'dormitory') {
        const menu = await deps.dormitory(date);
        sections = ['breakfast', 'lunch', 'dinner'].map(key => ({
          key, label: key[0]!.toUpperCase() + key.slice(1), items: menu?.[key as 'breakfast' | 'lunch' | 'dinner'] ?? [],
        }));
      } else {
        let pending = coop.get(date);
        if (!pending) { pending = deps.coop(date); coop.set(date, pending); }
        const menu = await pending;
        sections = kind === 'snack' ? [
          { key: 'snack', label: '분식코너', items: menu.snackCorner.snack },
          { key: 'set-meal', label: '정식', items: menu.snackCorner.setMeal },
        ] : ['breakfast', 'lunch', 'dinner'].map(key => ({
          key, label: key[0]!.toUpperCase() + key.slice(1), items: menu.staffRestaurant[key as 'breakfast' | 'lunch' | 'dinner'],
        }));
      }
      days.push({ date, sections });
    }
    return { kind, week: range.week, monday: range.monday, days, caption: weeklyCaption(kind, dates) };
  };
}
