import type { MenuSection, DailyMenu, CoopDailyMenu } from '../../../shared/contracts/menu.js';
import type { StoryRenderData, StoryRequest } from '../../../shared/contracts/story.js';

export function mealSections(menu: Pick<DailyMenu, 'breakfast' | 'lunch' | 'dinner'> | null | undefined): MenuSection[] {
  return [
    { key: 'breakfast', label: 'Breakfast', items: menu?.breakfast ?? [] },
    { key: 'lunch', label: 'Lunch', items: menu?.lunch ?? [] },
    { key: 'dinner', label: 'Dinner', items: menu?.dinner ?? [] },
  ];
}

export function dormitoryStory(request: StoryRequest, menu: DailyMenu | null): StoryRenderData {
  return { request, sections: mealSections(menu).filter(section => request.scope === 'full' || section.key === request.scope) };
}

export function coopStory(request: StoryRequest, menu: CoopDailyMenu): StoryRenderData {
  if (request.restaurant === 'snack') {
    const { western, ramen, snack, setMeal } = menu.snackCorner;
    return { request, sections: [
      { key: 'western', label: '양식코너', items: western },
      { key: 'set-meal', label: '정식', items: setMeal },
      { key: 'ramen', label: '라면코너', items: ramen },
      { key: 'snack', label: '분식코너', items: snack },
    ] };
  }
  return { request, sections: mealSections(menu.staffRestaurant).filter(section => request.scope === 'full' || section.key === request.scope) };
}
