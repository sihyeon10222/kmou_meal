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
  const response = await fetch(COOP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: COOP_URL, Accept: 'text/html' },
    body: new URLSearchParams({ sys_id: 'coop', sch_date: date.replaceAll('-', '/'), gbn: '', streFileNm: '' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`학식 조회 실패: HTTP ${response.status}`);
  return parseCoopMenu(await response.text(), date);
}
