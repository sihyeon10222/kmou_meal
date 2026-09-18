import { seoulDate, validateDate } from './dates.js';
import { fetchMenuText } from './fetch-menu-text.js';

export { seoulDate, validateDate } from './dates.js';

const MENU_API = 'https://www.kmou.ac.kr/dorm/di/diet/selectDietList.do';

export interface DailyMenu {
  date: string;
  lunch: string[];
  dinner: string[];
}

interface RawDiet {
  dietSeq: number;
  dietDate: string;
  dietAditCn2?: string | null;
  dietAditCn3?: string | null;
}

function isRawDiet(value: unknown): value is RawDiet {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.dietSeq === 'number' && Number.isSafeInteger(row.dietSeq)
    && typeof row.dietDate === 'string'
    && [row.dietAditCn2, row.dietAditCn3].every(
      (menu) => menu == null || typeof menu === 'string',
    );
}

function cleanMenu(text: string | null | undefined): string[] {
  return (text ?? '').split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
}

/** 데이터가 없으면 null. 통신/응답 오류는 정상적인 식단 없음과 구분합니다. */
export async function fetchDailyMenu(date: Date | string = new Date()): Promise<DailyMenu | null> {
  const requestDate = typeof date === 'string' ? validateDate(date) : seoulDate(date);
  const targetDate = requestDate.replaceAll('-', '/');
  const body = await fetchMenuText(MENU_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://www.kmou.ac.kr/dorm/dv/dietView/',
    },
    body: new URLSearchParams({ diet_ty: '주간식단표', sys_id: 'dorm', sch_date: requestDate }),
  }, 'KMOU 식단 요청');

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (cause) {
    throw new Error('KMOU 식단 응답 JSON을 해석할 수 없습니다.', { cause });
  }
  if (!Array.isArray(data) || !data.every(isRawDiet)) {
    throw new Error('KMOU 식단 응답 구조가 예상과 다릅니다.');
  }
  const candidates = data.filter((item) => item.dietDate === targetDate);
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((a, b) => b.dietSeq > a.dietSeq ? b : a);
  return { date: latest.dietDate, lunch: cleanMenu(latest.dietAditCn2), dinner: cleanMenu(latest.dietAditCn3) };
}
