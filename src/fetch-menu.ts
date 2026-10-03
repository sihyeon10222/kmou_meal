import { seoulDate, validateDate } from './dates.js';
import { fetchMenuText } from './fetch-menu-text.js';

export { seoulDate, validateDate } from './dates.js';

export interface DailyMenu {
  date: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
}

interface RawDiet {
  dietSeq: number;
  dietDate: string;
  dietAditCn1?: string | null;
  dietAditCn2?: string | null;
  dietAditCn3?: string | null;
}

function isRawDiet(value: unknown): value is RawDiet {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.dietSeq === 'number' && Number.isSafeInteger(row.dietSeq)
    && typeof row.dietDate === 'string'
    && [row.dietAditCn1, row.dietAditCn2, row.dietAditCn3].every(
      (menu) => menu == null || typeof menu === 'string',
    );
}

function cleanMenu(text: string | null | undefined): string[] {
  return (text ?? '').split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
}

/** 데이터가 없으면 null. 통신/응답 오류는 정상적인 식단 없음과 구분합니다. */
export async function fetchDailyMenu(date: Date | string = new Date()): Promise<DailyMenu | null> {
  return fetchResidenceMenu('dorm', date);
}

export async function fetchBadaroMenu(date: Date | string = new Date()): Promise<DailyMenu | null> {
  return fetchResidenceMenu('badaro', date);
}

async function fetchResidenceMenu(site: 'dorm' | 'badaro', date: Date | string): Promise<DailyMenu | null> {
  const requestDate = typeof date === 'string' ? validateDate(date) : seoulDate(date);
  return menuForDate(await fetchResidenceRows(site, requestDate), requestDate);
}

/** Reuse only dates explicitly present in a response, within this one execution. */
export function createResidenceMenuFetcher(site: 'dorm' | 'badaro') {
  const menus = new Map<string, DailyMenu | null>();
  return async (date: Date | string): Promise<DailyMenu | null> => {
    const requestDate = typeof date === 'string' ? validateDate(date) : seoulDate(date);
    if (!menus.has(requestDate)) {
      const rows = await fetchResidenceRows(site, requestDate);
      // A response may span weeks or months. Absent dates still get their own request;
      // absence from another date's response must not be treated as an empty menu.
      for (const returnedDate of new Set(rows.map(row => row.dietDate))) {
        const key = returnedDate.replaceAll('/', '-');
        menus.set(key, menuForDate(rows, key));
      }
      menus.set(requestDate, menuForDate(rows, requestDate));
    }
    return structuredClone(menus.get(requestDate)!);
  };
}

async function fetchResidenceRows(site: 'dorm' | 'badaro', requestDate: string): Promise<RawDiet[]> {
  const source = `KMOU ${site === 'dorm' ? '기숙사' : '승선생활관'} 식단 조회 (${site}, ${requestDate})`;
  const body = await fetchMenuText(`https://www.kmou.ac.kr/${site}/di/diet/selectDietList.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `https://www.kmou.ac.kr/${site}/dv/dietView/`,
    },
    body: new URLSearchParams({ diet_ty: '주간식단표', sys_id: site, sch_date: requestDate }),
  }, source);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (cause) {
    throw new Error(`${source}: 응답 JSON을 해석할 수 없습니다.`, { cause });
  }
  if (!Array.isArray(data) || !data.every(isRawDiet)) {
    throw new Error(`${source}: 응답 구조가 예상과 다릅니다.`);
  }
  return data;
}

function menuForDate(data: RawDiet[], requestDate: string): DailyMenu | null {
  const targetDate = requestDate.replaceAll('-', '/');
  const candidates = data.filter((item) => item.dietDate === targetDate);
  if (candidates.length === 0) return null;
  // A newer row may update only one meal. Keep the latest populated value for each meal.
  candidates.sort((a, b) => b.dietSeq - a.dietSeq);
  const latestMeal = (key: 'dietAditCn1' | 'dietAditCn2' | 'dietAditCn3') =>
    cleanMenu(candidates.find((item) => cleanMenu(item[key]).length > 0)?.[key]);
  return {
    date: targetDate,
    breakfast: latestMeal('dietAditCn1'),
    lunch: latestMeal('dietAditCn2'),
    dinner: latestMeal('dietAditCn3'),
  };
}
