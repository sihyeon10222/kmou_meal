import type { Restaurant } from './story-modes.js';

// Text descriptions only: the model generates the tray and food together.
// No fixed tray assets, compartment masks or food overlays are used.
export interface TrayProfile { id: string; version: number; height: number; prompt: string }
export const GENERAL_TRAY: TrayProfile = {
  id: 'yellow-general', version: 6, height: 714,
  prompt: 'Tray shape: horizontal rounded rectangle, width:height 1.40:1, exactly 8 recessed compartments: four small rectangular wells in the top row, two large wells below for rice and soup, a small circle at the far top-right above a narrow vertical utensil channel. Thin rounded dividers, broad food wells, warm lemon-yellow plastic (#F8E45C).',
};
export const ROUND_TRAY: TrayProfile = {
  id: 'yellow-round', version: 6, height: 676,
  prompt: 'Tray shape: horizontal rounded rectangle, width:height 1.48:1, exactly 5 recessed compartments: a dominant large circular main well on the left, a vertical stack of upper-right and middle-right rectangular wells and a lower-right circular well, plus a narrow utensil channel at the far-right edge. Thin rounded dividers, warm lemon-yellow plastic (#F8E45C).',
};
export const ROUND_MENU_PATTERN = /돈가스|돈까스|커틀릿|파스타|스파게티/u;
export const RESTAURANT_TRAYS: Record<Exclude<Restaurant, 'snack'>, { regular: TrayProfile; round?: TrayProfile }> = {
  dormitory: { regular: GENERAL_TRAY, round: ROUND_TRAY },
  badaro: { regular: GENERAL_TRAY }, teacher: { regular: GENERAL_TRAY },
};
export function shouldGenerateFoodImage(restaurant: Restaurant, meal: string): boolean {
  return restaurant !== 'snack' && ['breakfast', 'lunch', 'dinner'].includes(meal)
    && (meal !== 'breakfast' || restaurant === 'badaro');
}
export function selectTray(restaurant: Exclude<Restaurant, 'snack'>, meal: string, items: string[]): TrayProfile {
  const profiles = RESTAURANT_TRAYS[restaurant];
  return profiles.round && (meal === 'breakfast' || items.some(item => ROUND_MENU_PATTERN.test(item)))
    ? profiles.round : profiles.regular;
}
