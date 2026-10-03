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
    caption: weeklyCaption(data.kind, data.pages[0]!.days.map(day => day.date), onlyCombinedPage, data.updatedOn),
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

/** Only an empty future meal becoming available warrants an automatic post. */
export function hasFutureAddition(data: WeeklyData, previous: WeeklyPage[], today: string): boolean {
  return data.pages.some(page => page.days.some(day => day.date > today && day.sections.some(section => {
    const old = previous.find(p => p.kind === page.kind)?.days.find(d => d.date === day.date)
      ?.sections.find(s => s.key === section.key);
    return section.items.some(item => item.trim()) && !old?.items.some(item => item.trim());
  })));
}

/** Freeze today and the past, including days in previously omitted restaurants. */
export function prepareWeekly(data: WeeklyData, previous: WeeklyPage[] | undefined, today: string, replacement: boolean): WeeklyData | undefined {
  const prepared = structuredClone(data);
  delete prepared.updatedOn;
  if (replacement) prepared.updatedOn = today;
  if (previous) {
    prepared.pages = prepared.pages.map(page => ({ ...page, days: page.days.map(day => {
      if (day.date > today) return day;
      const old = previous.find(p => p.kind === page.kind)?.days.find(d => d.date === day.date);
      return old ? structuredClone(old) : { ...day, sections: day.sections.map(section => ({ ...section, items: [] })) };
    }) }));
    for (const old of previous) {
      if (!prepared.pages.some(page => page.kind === old.kind)) {
        prepared.pages.push({ ...structuredClone(old), days: old.days.map(day => day.date <= today
          ? structuredClone(day) : { ...day, sections: day.sections.map(section => ({ ...section, items: [] })) }) });
      }
    }
  }
  return publishableWeekly(prepared);
}
