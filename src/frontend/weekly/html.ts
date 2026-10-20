import { escapeHtml } from '../shared/escape-html.js';
import { shortDate, weekdayName } from '../../shared/dates.js';
import type { WeeklyData, WeeklyPage } from '../../shared/contracts/weekly.js';

export interface WeeklyTemplateAssets { css: string; font: string; design: string }

const dish = (text: string) => {
  const parts = [''];
  // Keep bracketed notes intact; only a top-level + offers an optional break.
  for (const token of text.split(/(\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\})/u)) {
    if (/^(\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\})$/u.test(token)) {
      parts[parts.length - 1] += `<span class="no-break">${escapeHtml(token)}</span>`;
    } else {
      for (const char of token) {
        if (char === '+' && parts.at(-1)) parts.push('');
        parts[parts.length - 1] += escapeHtml(char);
      }
    }
  }
  return parts.map(part => `<span class="menu-part">${part}</span>`).join('<wbr>');
};
const itemsHtml = (items: string[], changed: number[] = []) => items.length ? items.map((item, index) => `<p${changed.includes(index) ? ' class="changed-menu"' : ''}>${dish(item)}</p>`).join('') : '<p class="empty">등록된 식단 없음</p>';
export function buildWeeklyHtml(data: WeeklyPage, assets: WeeklyTemplateAssets, updatedOn?: string, menuChanges?: WeeklyData['menuChanges'], updatedKinds?: WeeklyData['updatedKinds']): string {
  const { css, font, design } = assets;
  const panorama = data.kind === 'dormitory' || data.kind === 'badaro';
  const title = { dormitory: '기숙사', badaro: '승선생활관', teacher: '교직원식당', snack: '학식' }[data.kind];
  const combinedNames = (['snack', 'teacher'] as const).filter(kind => updatedKinds?.includes(kind)).map(kind => kind === 'snack' ? '학식' : '교직원식당');
  const notice = !panorama && combinedNames.length ? `${combinedNames.join('&')} 식단표 변경됨` : '식단표 변경됨';
  const days = data.days.map((day, index) => {
    const weekdayIndex = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayIndex];
    return `<article class="day${weekdayIndex === 0 || weekdayIndex === 6 ? ' weekend' : ''}"><div class="day-title"><span class="weekday">${weekday}</span></div>${day.sections.map(section => {
      const changed = updatedOn ? menuChanges?.find(change => change.kind === data.kind && change.date === day.date && change.section === section.key)?.indexes : undefined;
      return `<section class="cell ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}">${index === 0 ? `<h2><span class="meal-label">${escapeHtml(section.label)}</span></h2>` : ''}<div class="menu">${itemsHtml(section.items, changed)}</div></section>`;
    }).join('')}</article>`;
  }).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>${font} ${design}\n${css}</style><body><main class="sheet ${data.kind} ${panorama ? 'panorama' : ''}" style="width:${panorama ? 2160 : 1080}px;--days:${data.days.length};--rows:${data.days[0]!.sections.length}"><div class="meal-surfaces" aria-hidden="true">${data.days[0]!.sections.map(section => `<div class="meal-surface ${escapeHtml(section.key)}"></div>`).join('')}</div><header><div class="heading-row"><h1>${title}</h1><div class="range${updatedOn ? ' updated-range' : ''}">${shortDate(data.days[0]!.date)} ~ ${shortDate(data.days.at(-1)!.date)}</div></div>${updatedOn ? `<div class="update-notice">${shortDate(updatedOn)}(${weekdayName(updatedOn)})에 ${escapeHtml(notice)}</div>` : ''}</header><div class="calendar">${days}</div></main></body></html>`;
}
