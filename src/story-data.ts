import type { DailyMenu } from './fetch-menu.js';
import type { CoopDailyMenu } from './fetch-coop-menu.js';
import type { StoryRequest } from './story-modes.js';

export interface FoodImageResult {
  meal: string;
  status: 'generated' | 'cached' | 'skipped' | 'failed';
  tray?: string;
  imagePath?: string;
  error?: string;
}
export interface MenuSection {
  key: string; label: string; items: string[];
  image?: { dataUrl: string; width: number; height: number };
}
export interface StoryRenderData { request: StoryRequest; sections: MenuSection[]; aiImages?: FoodImageResult[] }

export function dormitoryStory(request: StoryRequest, menu: DailyMenu | null): StoryRenderData {
  return { request, sections: [
    { key: 'breakfast', label: 'Breakfast', items: menu?.breakfast ?? [] },
    { key: 'lunch', label: 'Lunch', items: menu?.lunch ?? [] },
    { key: 'dinner', label: 'Dinner', items: menu?.dinner ?? [] },
  ].filter(section => request.scope === 'full' || section.key === request.scope) };
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
  const { breakfast, lunch, dinner } = menu.staffRestaurant;
  return { request, sections: [
    { key: 'breakfast', label: 'Breakfast', items: breakfast },
    { key: 'lunch', label: 'Lunch', items: lunch },
    { key: 'dinner', label: 'Dinner', items: dinner },
  ].filter(section => request.scope === 'full' || section.key === request.scope) };
}
