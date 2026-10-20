import { shortDate, weekdayName } from '../../../shared/dates.js';
import type { WeeklyKind, WeeklyPageKind } from '../../../shared/contracts/weekly.js';

export function weeklyCaption(kind: WeeklyKind, _dates: string[], onlyCombinedPage?: WeeklyPageKind, updatedOn?: string): string {
  const tag = onlyCombinedPage === 'snack' ? '해양대학식'
    : onlyCombinedPage === 'teacher' ? '해양대교직원식당'
    : { combined: '해양대학식 #해양대교직원식당', badaro: '해양대승선생활관', dormitory: '해양대기숙사' }[kind];
  const intro = updatedOn ? `${shortDate(updatedOn)} (${weekdayName(updatedOn)})에 학교 측의 식단 업데이트로 인해 재업로드된 식단표입니다.` : undefined;
  const delayNotice = "학교 측의 식단 업데이트가 늦을 경우, 식단표에 '등록된 식단 없음'으로 표시될 수 있습니다.";
  const tags = `#해양대학교 #${tag}`;
  return intro ? `${intro}\n\n${delayNotice}\n\n${tags}` : `${delayNotice}\n\n${tags}`;
}
