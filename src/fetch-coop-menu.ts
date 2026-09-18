import { load } from 'cheerio';
import { seoulDate, validateDate } from './fetch-menu.js';

const COOP_URL = 'https://www.kmou.ac.kr/coop/dv/dietView/selectDietDateView.do?mi=1189';
export interface CoopDailyMenu {
  date: string;
  snackCorner: { western: string[]; ramen: string[]; snack: string[]; setMeal: string[] };
  staffRestaurant: { breakfast: string[]; lunch: string[]; dinner: string[] };
}

export function parseCoopMenu(html: string, date: string): CoopDailyMenu {
  validateDate(date);
  const $ = load(html);
  const readTable = (headers: string[]): string[][] => {
    const tables = $('table').filter((_, table) => $(table).find('th').map((_, th) =>
      $(th).text().replace(/\s+/g, '').trim()).get().join('|') === headers.join('|'));
    if (tables.length !== 1) throw new Error(`학식 HTML 구조 오류: ${headers.join('|')} 테이블을 식별할 수 없습니다.`);
    const rows = tables.find('tbody tr').filter((_, row) => {
      const cells = $(row).children('td');
      return cells.length === headers.length && cells.toArray().every(cell => !$(cell).attr('colspan'));
    });
    if (rows.length > 1) throw new Error('학식 HTML 구조 오류: 메뉴 행이 여러 개입니다.');
    if (!rows.length) return headers.map(() => []);
    return rows.first().children('td').toArray().map(cell => {
      const copy = $(cell).clone();
      copy.find('br').replaceWith('\n');
      return copy.text().split(/\r\n|\r|\n/)
        .map(line => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
        // 가격만 있는 줄과 메뉴명 뒤에 붙은 원화 가격은 표시하지 않습니다.
        .map(line => line.replace(/\s*[（(]?\s*(?:₩\s*)?\d[\d,]*\s*원\s*[)）]?/g, '').trim())
        .filter(line => !!line && !/^(?:₩\s*)?\d[\d,]*(?:\s*원)?$/.test(line));
    });
  };
  const [western = [], ramen = [], snack = [], setMeal = []] = readTable(['양식코너', '라면코너', '분식코너', '정식']);
  const [breakfast = [], lunch = [], dinner = []] = readTable(['조식', '중식', '석식']);
  return { date, snackCorner: { western, ramen, snack, setMeal }, staffRestaurant: { breakfast, lunch, dinner } };
}

/** 빈 메뉴와 HTTP/파서 실패를 구분합니다. 주말 정책은 실행 계층에서 적용합니다. */
export async function fetchCoopDailyMenu(date = seoulDate()): Promise<CoopDailyMenu> {
  validateDate(date);
  let html = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(COOP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: COOP_URL, Accept: 'text/html' },
        body: new URLSearchParams({ sys_id: 'coop', sch_date: date.replaceAll('-', '/'), gbn: '', streFileNm: '' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        html = await response.text();
        break;
      }
    } catch (cause) {
      // 원본 메시지/URL 대신 오류 종류와 연결 오류 코드만 로그에 남깁니다.
      const error = cause as { name?: string; cause?: { code?: unknown } } | null;
      const code = error?.cause?.code;
      const reason = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
        ? code : error?.name === 'TimeoutError' ? 'TimeoutError' : '네트워크/본문 수신 오류';
      if (attempt === 3) throw new Error(`학식 조회 실패: ${reason} (총 3회 시도).`, { cause });
      console.warn(`학식 조회 ${attempt}/3 실패: ${reason}. ${attempt}초 후 재시도합니다.`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
      continue;
    }
    await response.body?.cancel();
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw new Error(`학식 조회 실패: HTTP ${response.status} (${attempt}회 시도).`);
    console.warn(`학식 조회 ${attempt}/3 실패: HTTP ${response.status}. ${attempt}초 후 재시도합니다.`);
    await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
  }
  // 정상 응답의 구조 오류는 통신 재시도 대상이 아닙니다.
  return parseCoopMenu(html, date);
}
