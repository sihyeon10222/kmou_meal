import { load } from 'cheerio';
import { seoulDate, validateDate } from './dates.js';
import { fetchMenuText } from './fetch-menu-text.js';

const COOP_URL = 'https://www.kmou.ac.kr/coop/dv/dietView/selectDietDateView.do?mi=1189';
export interface CoopDailyMenu {
  date: string;
  snackCorner: { western: string[]; ramen: string[]; snack: string[]; setMeal: string[] };
  staffRestaurant: { breakfast: string[]; lunch: string[]; dinner: string[] };
}

export function parseCoopMenu(html: string, date: string): CoopDailyMenu {
  validateDate(date);
  const $ = load(html);
  const returnedDates = $('input[name="sch_date"]').toArray();
  if (returnedDates.some(input => $(input).val() !== date.replaceAll('-', '/'))) {
    throw new Error(`학식 응답 날짜 오류: 요청한 ${date}의 응답이 아닙니다.`);
  }
  const readTable = (headers: string[]): string[][] => {
    const tables = $('table').filter((_, table) => $(table).find('th').map((_, th) =>
      $(th).text().replace(/\s+/g, '').trim()).get().join('|') === headers.join('|'));
    if (tables.length !== 1) throw new Error(`학식 HTML 구조 오류: ${headers.join('|')} 테이블을 식별할 수 없습니다.`);
    const bodies = tables.children('tbody');
    if (bodies.length !== 1) throw new Error('학식 HTML 구조 오류: 메뉴 본문을 식별할 수 없습니다.');
    const allRows = bodies.children('tr');
    const dateRows = allRows.filter((_, row) => {
      const cells = $(row).children('td');
      return cells.length === 1 && cells.first().attr('colspan') === String(headers.length)
        && /^\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*[월화수목금토일]요일)?\s*$/.test(cells.text());
    });
    const rows = allRows.filter((_, row) => {
      const cells = $(row).children('td');
      return cells.length === headers.length && cells.toArray().every(cell =>
        !$(cell).attr('colspan') && !$(cell).attr('rowspan'));
    });
    if (allRows.length !== dateRows.length + rows.length || dateRows.length > 1) {
      throw new Error('학식 HTML 구조 오류: 예상하지 못한 메뉴 행/열입니다.');
    }
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
  const html = await fetchMenuText(COOP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: COOP_URL, Accept: 'text/html' },
    body: new URLSearchParams({ sys_id: 'coop', sch_date: date.replaceAll('-', '/'), gbn: '', streFileNm: '' }),
  }, `학식·교직원 조회 (coop, ${date})`);
  // 정상 응답의 구조 오류는 통신 재시도 대상이 아닙니다.
  return parseCoopMenu(html, date);
}
