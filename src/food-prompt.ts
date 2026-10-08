import type { TrayProfile } from './tray-profiles.js';

export const FOOD_KINDS = ['rice', 'soup', 'main', 'side', 'kimchi', 'dessert', 'drink'] as const;
export type FoodKind = typeof FOOD_KINDS[number];
export interface FoodDescription { description: string; kind: FoodKind }

export function mealPositions(profile: TrayProfile, foods: FoodDescription[]): string[] {
  const named = (kind: FoodKind) => foods.filter(food => food.kind === kind).map(food => food.description);
  const rice = named('rice'), soup = named('soup'), main = named('main');
  const sides = named('side'), kimchi = named('kimchi'), dessert = named('dessert'), drinks = named('drink');
  const positions: string[] = [];
  const put = (position: string, dishes: string[]) => {
    if (dishes.length) positions.push(`${position}: ${dishes.join('; alongside, ')}.`);
  };
  const distribute = (slots: string[], dishes: string[]) => {
    const groups = slots.map(() => [] as string[]);
    dishes.forEach((dish, index) => groups[Math.min(index, slots.length - 1)]!.push(dish));
    groups.forEach((group, index) => put(slots[index]!, group));
  };
  if (profile.id === 'yellow-round') {
    put('LEFT large circular main well', [...main, ...rice]);
    if (soup.length) put('LOWER RIGHT circular well, in ONE pale-green soup bowl', soup);
    distribute(soup.length ? ['UPPER RIGHT well', 'MIDDLE RIGHT well'] : ['UPPER RIGHT well', 'MIDDLE RIGHT well', 'LOWER RIGHT circular well'], [...sides, ...kimchi, ...dessert]);
  } else {
    put('BOTTOM LEFT large well, directly on the tray, one portion only', rice);
    put('BOTTOM RIGHT large well, in ONE pale-green soup bowl', soup);
    distribute(kimchi.length ? ['TOP LEFT well', 'TOP CENTER LEFT well', 'TOP CENTER RIGHT well'] : ['TOP LEFT well', 'TOP CENTER LEFT well', 'TOP CENTER RIGHT well', 'TOP RIGHT well'], [...main, ...sides]);
    put('TOP RIGHT rectangular well', kimchi);
    put('Small far-right circular well', dessert);
  }
  put('At the far-right edge of the tray, in small unbranded drink packaging', drinks);
  if (!rice.length) positions.push('This meal has NO rice. Do not add rice.');
  if (!soup.length) positions.push('This meal has NO soup and NO soup bowl.');
  return positions;
}

export function buildFoodPrompt(profile: TrayProfile, foods: FoodDescription[], background: string): string {
  const color = background === '#ffffff' ? 'white' : background === '#2259b1' ? 'blue' : 'ivory';
  return `Real Korean cafeteria food photography, directly overhead. A horizontal warm lemon-yellow plastic tray, broad food wells, thin dividers, generous natural portions. Every listed food must be visible:
${mealPositions(profile, foods).map(position => `- ${position}`).join('\n')}
${profile.prompt}
Rice and sides sit directly in the tray. Only soup uses a bowl. No other dishes, utensils, text or extra foods. One serving of each food, no duplicates. Leave unused wells empty.
Natural moist textures, individual rice grains, irregular cooked ingredients, soft daylight, sharp photographic detail, not a plastic food replica or 3D render. Entire tray fills the frame with a 3% margin, no cropping. Flat uniform ${color} background ${background}; no table texture. Generate the entire meal and tray together in one photograph.`;
}
