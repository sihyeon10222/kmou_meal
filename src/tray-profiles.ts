import type { Restaurant } from './story-modes.js';

// Text descriptions only: the model generates the tray and food together.
// No fixed tray assets, compartment masks or food overlays are used.
export interface TrayProfile { id: string; version: number; height: number; servingLayout: string; prompt: string }
export const GENERAL_TRAY: TrayProfile = {
  id: 'yellow-general', version: 5, height: 714,
  servingLayout: 'Viewed from above: rice ONLY in the large BOTTOM-LEFT compartment; soup ONLY in ONE pale-green round soup bowl placed inside the large BOTTOM-RIGHT compartment. Main protein dishes in the TOP-LEFT and TOP-CENTER wells, vegetable sides in the remaining TOP-CENTER wells, kimchi in the TOP-RIGHT rectangular well. Small dessert or fruit in a remaining small well. Keep the far-right narrow utensil well empty. Do not put rice or soup in the top row. Do not swap the bottom rice and soup positions. Use only foods actually listed in the menu.',
  prompt: `A glossy warm lemon-yellow (#F8E45C) injection-molded Korean cafeteria tray.
The tray is a horizontal rounded rectangle, approximately 1.40:1 width:height, with an thin outer rim about 1.5% of its height and smooth consistent internal thin dividers about 0.8% of its width.
There are exactly 8 recessed compartments with rounded inner corners:
- Top row: upper-left rectangle (20% tray width, 34% tray height); a centered rectangular area (27% width, 34% height) split vertically into two equal wells; upper-right rectangle (21% width, 34% height).
- Bottom row: two large rectangles, bottom-left (42% width, 43% height) and bottom-center-right (32% width, 43% height).
- Far right: a small circle (diameter 13% tray height) directly above a separate long narrow vertical utensil capsule (10% width, 67% height).
The rectangular wells in each row align. Spacing is uniform. The utensil compartment stays empty.`,
};
export const ROUND_TRAY: TrayProfile = {
  id: 'yellow-round', version: 5, height: 676,
  servingLayout: 'The large main dish goes directly into the large LEFT circular compartment, rice alongside it if listed. Soup goes in ONE pale-green round soup bowl placed inside the LOWER-RIGHT circular tray well. Side dishes and kimchi go into the UPPER-RIGHT and MIDDLE-RIGHT tray wells. Keep the far-right narrow utensil well empty. Use only foods actually listed in the menu.',
  prompt: `A glossy warm lemon-yellow (#F8E45C) injection-molded cafeteria tray.
The tray is a wide horizontal rounded rectangle, approximately 1.48:1 width:height, with an thin outer rim about 1.5% of its height and smooth consistent internal thin dividers about 0.8% of its width.
There are exactly 5 recessed compartments:
- A dominant perfectly circular left main compartment (diameter about 74% of tray height), centered vertically. Serve the large main dish here, with rice alongside if listed.
- On the right, a vertical stack of an upper wide rounded rectangle (25% tray width, 19% tray height) whose lower-left edge follows the main circle; a middle small rectangle (20% width, 16% height); and a lower circular well (diameter 24% tray height).
- A separate very narrow vertical utensil capsule on the far-right edge (9% width, 76% height), kept empty.
Keep the left main compartment circular and dominant. Do not split it into smaller wells.`,
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
