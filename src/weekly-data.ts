import { seoulDate, validateDate } from './dates.js';
import { createResidenceMenuFetcher } from './fetch-menu.js';
import { fetchCoopDailyMenu } from './fetch-coop-menu.js';
import type { MenuSection } from './story-data.js';

export const WEEKLY_KINDS = ['combined', 'badaro', 'dormitory'] as const;
export type WeeklyKind = typeof WEEKLY_KINDS[number];
export type WeeklyPageKind = 'snack' | 'teacher' | 'badaro' | 'dormitory';
export interface WeeklyRange { monday: string; dates: string[]; week: string }
export interface WeeklyData {
  kind: WeeklyKind;
  week: string;
  monday: string;
  caption: string;
  updatedOn?: string;
  /** Rendering-only differences from the last successful post; not stored in menu snapshots. */
  menuChanges?: { kind: WeeklyPageKind; date: string; section: string; indexes: number[] }[];
  pages: WeeklyPage[];
}
export interface WeeklyPage {
  kind: WeeklyPageKind;
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
/** Monday–Saturday use their calendar week; Sunday uses the following week. Explicit YYYY-Www overrides it. */
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
    monday = addDays(baseDate, weekday === 7 ? 1 : 1 - weekday);
  }
  return { monday, week: isoWeek(monday), dates: Array.from({ length: 7 }, (_, index) => addDays(monday, index)) };
}
export function weeklyCaption(kind: WeeklyKind, dates: string[], onlyCombinedPage?: WeeklyPageKind, updatedOn?: string): string {
  const tag = onlyCombinedPage === 'snack' ? '해양대학식'
    : onlyCombinedPage === 'teacher' ? '해양대교직원식당'
    : { combined: '해양대학식 #해양대교직원식당', badaro: '해양대승선생활관', dormitory: '해양대기숙사' }[kind];
  const intro = updatedOn ? `${shortDate(updatedOn)} (${weekdayName(updatedOn)})에 학교 측의 식단 업데이트로 인해 재업로드된 식단표입니다.` : undefined;
  const delayNotice = "학교 측의 식단 업데이트가 늦을 경우, 식단표에 '등록된 식단 없음'으로 표시될 수 있습니다.";
  const tags = `#해양대학교 #${tag}`;
  return intro ? `${intro}\n\n${delayNotice}\n\n${tags}` : `${delayNotice}\n\n${tags}`;
}
export function createWeeklyFetcher(deps = {
  dormitory: createResidenceMenuFetcher('dorm'), badaro: createResidenceMenuFetcher('badaro'), coop: fetchCoopDailyMenu,
}) {
  const coop = new Map<string, ReturnType<typeof fetchCoopDailyMenu>>();
  return async (kind: WeeklyKind, range: WeeklyRange): Promise<WeeklyData> => {
    const dates = range.dates.slice(0, kind === 'combined' ? 5 : 7);
    const pages: WeeklyPage[] = kind === 'combined'
      ? [{ kind: 'snack', days: [] }, { kind: 'teacher', days: [] }]
      : [{ kind, days: [] }];
    for (const date of dates) {
      if (kind !== 'combined') {
        const menu = await deps[kind](date);
        const sections = ['breakfast', 'lunch', 'dinner'].map(key => ({
          key, label: key[0]!.toUpperCase() + key.slice(1), items: menu?.[key as 'breakfast' | 'lunch' | 'dinner'] ?? [],
        }));
        pages[0]!.days.push({ date, sections });
      } else {
        let pending = coop.get(date);
        if (!pending) {
          pending = deps.coop(date).catch(error => { coop.delete(date); throw error; });
          coop.set(date, pending);
        }
        const menu = await pending;
        pages[0]!.days.push({ date, sections: [
          { key: 'western', label: '양식코너', items: menu.snackCorner.western },
          { key: 'ramen', label: '라면코너', items: menu.snackCorner.ramen },
          { key: 'snack', label: '분식코너', items: menu.snackCorner.snack },
          { key: 'set-meal', label: '정식', items: menu.snackCorner.setMeal },
        ] });
        pages[1]!.days.push({ date, sections: ['breakfast', 'lunch', 'dinner'].map(key => ({
          key, label: key[0]!.toUpperCase() + key.slice(1), items: menu.staffRestaurant[key as 'breakfast' | 'lunch' | 'dinner'],
        })) });
      }
    }
    return { kind, week: range.week, monday: range.monday, pages, caption: weeklyCaption(kind, dates) };
  };
}

export function shortDate(date: string): string {
  validateDate(date);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}
export function weekdayName(date: string): string {
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(`${validateDate(date)}T12:00:00Z`).getUTCDay()]!;
}
