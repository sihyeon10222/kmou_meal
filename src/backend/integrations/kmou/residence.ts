import type { DailyMenu } from '../../../shared/contracts/menu.js';
import { seoulDate, validateDate } from '../../../shared/dates.js';
import { fetchMenuText } from './transport.js';

export { seoulDate, validateDate } from '../../../shared/dates.js';

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
  const targetDate = requestDate.replaceAll('-', '/');
  const rows = await fetchResidenceRows(site, requestDate);
  return menuFromRows(rows.filter(row => row.dietDate === targetDate), requestDate);
}

/** Reuse only dates explicitly present in a response, within this one execution. */
export function createResidenceMenuFetcher(site: 'dorm' | 'badaro') {
  const menus = new Map<string, DailyMenu | null>();
  return async (date: Date | string): Promise<DailyMenu | null> => {
    const requestDate = typeof date === 'string' ? validateDate(date) : seoulDate(date);
    if (!menus.has(requestDate)) {
      const rows = await fetchResidenceRows(site, requestDate);
      const byDate = new Map<string, RawDiet[]>();
      for (const row of rows) {
        const group = byDate.get(row.dietDate);
        if (group) group.push(row);
        else byDate.set(row.dietDate, [row]);
      }
      // A response may span weeks or months. Absent dates still get their own request;
      // absence from another date's response must not be treated as an empty menu.
      for (const returnedDate of byDate.keys()) {
        const key = returnedDate.replaceAll('/', '-');
        // Preserve exact slash-form matching even if the source returns other formats.
        menus.set(key, menuFromRows(byDate.get(key.replaceAll('-', '/')) ?? [], key));
      }
      if (!menus.has(requestDate)) menus.set(requestDate, null);
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

function menuFromRows(candidates: RawDiet[], requestDate: string): DailyMenu | null {
  const targetDate = requestDate.replaceAll('-', '/');
  if (candidates.length === 0) return null;
  // A newer row may update only one meal. Keep the latest populated value for each meal.
  const latestMeal = (key: 'dietAditCn1' | 'dietAditCn2' | 'dietAditCn3') => {
    let latest: RawDiet | undefined;
    for (const row of candidates) {
      // Equal sequence numbers retain the first populated row, like a stable sort.
      if ((!latest || row.dietSeq > latest.dietSeq) && row[key]?.trim()) latest = row;
    }
    return cleanMenu(latest?.[key]);
  };
  return {
    date: targetDate,
    breakfast: latestMeal('dietAditCn1'),
    lunch: latestMeal('dietAditCn2'),
    dinner: latestMeal('dietAditCn3'),
  };
}
