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

/** Date는 순간을 의미하며, 한국에서 해당 순간의 날짜를 사용합니다. */
export function seoulDate(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('유효하지 않은 날짜입니다.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('존재하지 않는 날짜입니다.');
  }
  return date;
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
  let data: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(MENU_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://www.kmou.ac.kr/dorm/dv/dietView/',
        },
        body: new URLSearchParams({ diet_ty: '주간식단표', sys_id: 'dorm', sch_date: requestDate }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        // 응답 본문 읽기에도 위의 제한 시간이 적용됩니다.
        data = await response.json();
        break;
      }
    } catch (cause) {
      if (attempt === 3) throw new Error('KMOU 식단 요청 실패 (총 3회 시도).', { cause });
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    await response.body?.cancel();
    if (!retryable || attempt === 3) {
      throw new Error(`KMOU 식단 요청 실패: HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }

  if (!Array.isArray(data) || !data.every(isRawDiet)) {
    throw new Error('KMOU 식단 응답 구조가 예상과 다릅니다.');
  }
  const candidates = data.filter((item) => item.dietDate === targetDate);
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((a, b) => b.dietSeq > a.dietSeq ? b : a);
  return { date: latest.dietDate, lunch: cleanMenu(latest.dietAditCn2), dinner: cleanMenu(latest.dietAditCn3) };
}
