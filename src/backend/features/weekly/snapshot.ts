import { createHash } from 'node:crypto';
import { weeklyCaption } from './caption.js';
import type { WeeklyData, WeeklyPage } from '../../../shared/contracts/weekly.js';

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

/** Use the latest full week, comparing replacements against the last successful post. */
export function prepareWeekly(data: WeeklyData, previous: WeeklyPage[] | undefined, today: string, replacement: boolean): WeeklyData | undefined {
  const prepared = structuredClone(data);
  delete prepared.updatedOn;
  delete prepared.menuChanges;
  delete prepared.updatedKinds;
  if (replacement) prepared.updatedOn = today;
  if (replacement && previous) {
    const changes: NonNullable<WeeklyData['menuChanges']> = [];
    const normalize = (item: string) => item.replace(/\s+/gu, ' ').trim();
    const updatedKinds = new Set<WeeklyPage['kind']>();
    const normalizedItems = (items: string[]) => items.map(normalize).filter(Boolean).sort();
    for (const page of prepared.pages) for (const day of page.days) {
      for (const section of day.sections) {
        const old = previous.find(candidate => candidate.kind === page.kind)?.days.find(candidate => candidate.date === day.date)
          ?.sections.find(candidate => candidate.key === section.key);
        if (JSON.stringify(normalizedItems(section.items)) !== JSON.stringify(normalizedItems(old?.items ?? []))) updatedKinds.add(page.kind);
        const remaining = new Map<string, number>();
        for (const item of old?.items ?? []) {
          const key = normalize(item);
          remaining.set(key, (remaining.get(key) ?? 0) + 1);
        }
        const indexes: number[] = [];
        section.items.forEach((item, index) => {
          const key = normalize(item);
          if (!key) return;
          const count = remaining.get(key) ?? 0;
          if (count) remaining.set(key, count - 1);
          else indexes.push(index);
        });
        if (indexes.length) changes.push({ kind: page.kind, date: day.date, section: section.key, indexes });
      }
    }
    if (changes.length) prepared.menuChanges = changes;
    prepared.updatedKinds = [...updatedKinds];
  }
  return publishableWeekly(prepared);
}
