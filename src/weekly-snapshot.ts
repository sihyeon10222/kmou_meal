import { createHash } from 'node:crypto';
import { weeklyCaption, type WeeklyData, type WeeklyPage } from './weekly-data.js';

const hasMenu = (page: WeeklyPage) => page.days.some(day =>
  day.sections.some(section => section.items.length > 0));

/** Keep empty days visible, but omit a wholly empty restaurant page. */
export function publishableWeekly(data: WeeklyData): WeeklyData | undefined {
  const pages = data.pages.filter(hasMenu);
  if (!pages.length) return undefined;
  const onlyCombinedPage = data.kind === 'combined' && pages.length === 1 ? pages[0]!.kind : undefined;
  return {
    ...data,
    pages,
    caption: weeklyCaption(data.kind, data.pages[0]!.days.map(day => day.date), onlyCombinedPage),
  };
}

/** Compare what readers see, ignoring whitespace-only changes in source text. */
export function weeklyMenuHash(data: WeeklyData): string {
  const visible = data.pages.map(page => ({
    kind: page.kind,
    days: page.days.map(day => ({
      date: day.date,
      sections: day.sections.map(section => ({
        key: section.key,
        items: section.items.map(item => item.replace(/\s+/gu, ' ').trim()).filter(Boolean),
      })),
    })),
  }));
  return createHash('sha256').update(JSON.stringify({ week: data.week, kind: data.kind, pages: visible })).digest('hex');
}
