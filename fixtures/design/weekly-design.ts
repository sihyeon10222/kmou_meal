import { prepareWeekly } from '../../src/backend/features/weekly/snapshot.js';
import { weeklyCaption } from '../../src/backend/features/weekly/caption.js';
import { weeklyRange } from '../../src/shared/dates.js';
import type { WeeklyData, WeeklyPageKind } from '../../src/shared/contracts/weekly.js';

export const designKinds = ['dormitory', 'badaro', 'snack', 'teacher'] as const;
export const designScenarios = ['normal', 'empty', 'partial', 'dense', 'long', 'repost'] as const;
export type DesignScenario = typeof designScenarios[number];

// Representative design samples, not a live school menu.
const breakfasts = [
  ['우유or두유/시리얼', '셀프토스트&버터/딸기잼', '찐계란', '맛살샐러드', '포도'],
  ['밥/잡곡밥', '대파해장국', '동그랑땡전&케찹', '청포묵숙주무침', '더덕무침', '포기김치', '우유/시리얼'],
  ['백미밥', '소고기무국', '계란후라이', '도시락김', '배추김치'],
];
const lunches = [
  ['얼큰쇠고기버섯찌개', '케이준샐러드', '모듬묵&양념장', '오이부추무침', '밥/석박지'],
  ['유부계란볶음밥', '매운건새우무국', '등갈비바베큐', '누들밀떡볶이', '망고치즈샐러드', '깍두기', '제로콜라'],
  ['백미밥', '황태해장국', '닭볶음탕', '들기름쫄면', '도토리묵야채무침', '배추김치'],
];
const dinners = [
  ['건새우아욱국', '매콤돼지갈비찜', '마카로니샐러드', '건파래무침', '밥/김치'],
  ['밥/잡곡밥', '사골떡국', '우삼겹배추찜', '오징어&칠리소스', '상추파채무침', '포기김치', '오렌지/요구르트'],
  ['백미밥', '감자수제비', '언양식불고기', '두부조림', '열무나물', '배추김치'],
];

export function weeklyDesignData(pageKind: WeeklyPageKind, scenario: DesignScenario = 'normal'): WeeklyData {
  const range = weeklyRange('2026-10-08');
  const kind = pageKind === 'snack' || pageKind === 'teacher' ? 'combined' : pageKind;
  const dates = range.dates.slice(0, kind === 'combined' ? 5 : 7);
  const days = dates.map((date, index) => ({ date, sections: pageKind === 'snack' ? [
    { key: 'western', label: '양식코너', items: ['돈까스', '치킨치즈돈까스', '파채돈까스', '더블돈까스', '치킨치즈더블돈까스', '파채더블돈까스', '빅고구마치즈돈까스', '빅등심돈까스'] },
    { key: 'ramen', label: '라면코너', items: ['계란라면', '계란치즈라면', '부대찌개라면+공깃밥'] },
    { key: 'snack', label: '분식코너', items: [[ '메밀소바+유부초밥' ], [ '부대찌개라면+공깃밥' ], [ '치킨마요덮밥' ]][index % 3]!.slice() },
    { key: 'set-meal', label: '정식', items: lunches[index % 3]!.slice() },
  ] : [
    { key: 'breakfast', label: 'Breakfast', items: (pageKind === 'teacher' ? ['백미밥', '명란두부찌개', '계란말이', '배추김치'] : breakfasts[(index + (pageKind === 'badaro' ? 1 : 0)) % 3]!).slice() },
    { key: 'lunch', label: 'Lunch', items: lunches[index % 3]!.slice() },
    { key: 'dinner', label: 'Dinner', items: dinners[index % 3]!.slice() },
  ] }));
  if (scenario === 'empty') days.forEach(day => day.sections.forEach(section => { section.items = []; }));
  if (scenario === 'partial') days.forEach((day, index) => day.sections.forEach((section, row) => {
    if ((index + row) % 2 === 0) section.items = [];
  }));
  if (scenario === 'dense') {
    days.forEach(day => day.sections.forEach(section => { section.items = ['백미밥']; }));
    days[2]!.sections[1]!.items = Array.from({ length: pageKind === 'snack' ? 20 : 28 }, (_, index) => ['백미밥', '돼지불고기', '미역국', '배추김치'][index % 4]!);
  }
  if (scenario === 'long') {
    days[0]!.sections[0]!.items = ['바지락순두부찌개', '치킨치즈더블돈가스', '메밀소바+유부초밥', '부대찌개라면+공깃밥'];
    days[1]!.sections[1]!.items = ['구운버섯과채소를곁들인수제함박스테이크정식', '추석연휴(9/24~27)'];
  }
  const updatedOn = scenario === 'repost' ? '2026-10-08' : undefined;
  const result: WeeklyData = { kind, week: range.week, monday: range.monday, pages: [{ kind: pageKind, days }],
    caption: weeklyCaption(kind, dates, pageKind, updatedOn), ...(updatedOn ? { updatedOn } : {}) };
  if (scenario === 'repost') {
    const previous = structuredClone(result.pages);
    // A new future meal plus one edited future dish, alongside unchanged dishes.
    previous[0]!.days.at(-1)!.sections[1]!.items = [];
    previous[0]!.days[4]!.sections[0]!.items[0] = '업데이트 전 메뉴';
    previous[0]!.days.at(-1)!.sections.at(-1)!.items[0] = '업데이트 전 메뉴';
    return prepareWeekly(result, previous, '2026-10-08', true)!;
  }
  return result;
}

