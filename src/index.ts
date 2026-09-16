import { fetchDailyMenu } from './fetch-menu.js';

// 조회 전용 진입점. 업로드나 Instagram 게시는 실행하지 않습니다.
try {
  if (process.argv.length > 3) throw new Error('사용법: npm run fetch-menu -- [YYYY-MM-DD]');
  const date = process.argv[2];
  const menu = date === undefined ? await fetchDailyMenu() : await fetchDailyMenu(date);
  console.log(menu === null ? '해당 날짜의 식단이 없습니다. 게시를 건너뜁니다.' : JSON.stringify(menu, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : '식단 조회에 실패했습니다.');
  process.exitCode = 1;
}
