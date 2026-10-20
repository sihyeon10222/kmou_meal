import type { WeeklyRange } from './contracts/weekly.js';

const seoulDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date는 순간을 의미하며, 한국에서 해당 순간의 날짜를 사용합니다. */
export function seoulDate(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('유효하지 않은 날짜입니다.');
  const parts = seoulDateFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('존재하지 않는 날짜입니다.');
  }
  return date;
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

export function shortDate(date: string): string {
  validateDate(date);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}
export function weekdayName(date: string): string {
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(`${validateDate(date)}T12:00:00Z`).getUTCDay()]!;
}
