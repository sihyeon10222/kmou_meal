import { escapeHtml } from '../shared/escape-html.js';
import { shortDate } from '../../shared/dates.js';
import type { MenuSection } from '../../shared/contracts/menu.js';
import type { StoryRenderData } from '../../shared/contracts/story.js';

export interface StoryTemplateAssets { template: string; css: string; font: string }

function sectionHtml(section: MenuSection): string {
  // Keep each menu name intact; only additions starting with '+' may move to a new line.
  const dishHtml = (item: string) => item.split(/(?=\+)/u)
    .map(part => `<span class="dish-part">${escapeHtml(part)}</span>`).join('<wbr>');
  const items = section.items.length
    ? section.items.map(item => `<p class="dish">${dishHtml(item)}</p>`).join('')
    : '<p class="dish empty">등록된 식단 없음</p>';
  return `<section class="meal ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><h2 class="meal-label">${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
}

export function buildStoryHtml(data: StoryRenderData, assets: StoryTemplateAssets, layout: string): string {
  const { request, sections } = data;
  const replacements: Record<string, string> = {
    FONT: assets.font,
    CSS: `${assets.css}\n${layout}`,
    CLASSES: `${request.restaurant === 'badaro' ? 'badaro dormitory' : request.restaurant} ${request.scope}`,
    DATE: escapeHtml(`${shortDate(request.targetDate)}(${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${request.targetDate}T12:00:00Z`).getUTCDay()]})`),
    TITLE: { dormitory: '기숙사', badaro: '승선생활관', snack: '학식', teacher: '교직원식당' }[request.restaurant],
    SECTIONS: sections.map(sectionHtml).join(''),
  };
  return assets.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

