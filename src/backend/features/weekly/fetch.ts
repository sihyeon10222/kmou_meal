import { createResidenceMenuFetcher } from '../../integrations/kmou/residence.js';
import { fetchCoopDailyMenu } from '../../integrations/kmou/coop.js';
import { mealSections } from '../story/data.js';
import { weeklyCaption } from './caption.js';
import type { WeeklyKind, WeeklyRange, WeeklyData, WeeklyPage } from '../../../shared/contracts/weekly.js';

export function createWeeklyFetcher(deps = {
  dormitory: createResidenceMenuFetcher('dorm'), badaro: createResidenceMenuFetcher('badaro'), coop: fetchCoopDailyMenu,
}) {
  const coop = new Map<string, ReturnType<typeof fetchCoopDailyMenu>>();
  return async (kind: WeeklyKind, range: WeeklyRange): Promise<WeeklyData> => {
    const dates = range.dates.slice(0, kind === 'combined' ? 5 : 7);
    const pages: WeeklyPage[] = kind === 'combined'
      ? [{ kind: 'snack', days: [] }, { kind: 'teacher', days: [] }]
      : [{ kind, days: [] }];
    for (const date of dates) {
      if (kind !== 'combined') {
        const menu = await deps[kind](date);
        pages[0]!.days.push({ date, sections: mealSections(menu) });
      } else {
        let pending = coop.get(date);
        if (!pending) {
          pending = deps.coop(date).catch(error => { coop.delete(date); throw error; });
          coop.set(date, pending);
        }
        const menu = await pending;
        pages[0]!.days.push({ date, sections: [
          { key: 'western', label: '양식코너', items: menu.snackCorner.western },
          { key: 'ramen', label: '라면코너', items: menu.snackCorner.ramen },
          { key: 'snack', label: '분식코너', items: menu.snackCorner.snack },
          { key: 'set-meal', label: '정식', items: menu.snackCorner.setMeal },
        ] });
        pages[1]!.days.push({ date, sections: mealSections(menu.staffRestaurant) });
      }
    }
    return { kind, week: range.week, monday: range.monday, pages, caption: weeklyCaption(kind, dates) };
  };
}

