import type { Page } from 'playwright';

export interface ArtRect { x: number; y: number; width: number; height: number }
export type ArtMeal = 'lunch' | 'dinner';
export interface StoryArtLayout {
  width: number; height: number;
  meals: Partial<Record<ArtMeal, ArtRect>>;
  obstacles: ArtRect[];
}
export interface ArtPlacement {
  width: number;
  character: ArtRect;
  bubbles: Partial<Record<ArtMeal, ArtRect>>;
}

/** Reserve actual text line rectangles, not the full-width menu element. */
export async function measureStoryArtLayout(page: Page): Promise<StoryArtLayout> {
  return page.evaluate(() => {
    const rect = (r: DOMRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
    const obstacles = [...document.querySelectorAll('header, .meal-heading')]
      .map(element => rect(element.getBoundingClientRect()));
    for (const menu of document.querySelectorAll('.menu')) {
      const walker = document.createTreeWalker(menu, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) obstacles.push(rect(r));
      }
    }
    const meals: Partial<Record<'lunch' | 'dinner', { x: number; y: number; width: number; height: number }>> = {};
    for (const key of ['lunch', 'dinner'] as const) {
      const element = document.querySelector(`.meal.${key}`);
      if (element) meals[key] = rect(element.getBoundingClientRect());
    }
    return { width: 1080, height: 1920, meals, obstacles };
  });
}

export const ART_MAX_WIDTH = 610;
export const ART_MIN_WIDTH = 312;
export const ART_TEXT_GAP = 16;
const CHARACTER_RATIO = 1149 / 970;

export function bubbleBodyHeight(box: ArtRect): number {
  return Math.round(box.height - 72 * Math.max(.6, box.width / 375));
}

/** Reserve the trail's central corridor without reserving its transparent lower corners. */
export function bubbleCollisionParts(box: ArtRect): ArtRect[] {
  const height = bubbleBodyHeight(box);
  return [
    { ...box, height },
    { x: box.x + box.width * .15, y: box.y + height, width: box.width * .7, height: box.height - height },
  ];
}

export function intersects(a: ArtRect, b: ArtRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Resize only the decoration. Menu positions, font sizes, and card heights never change. */
export function findArtPlacement(layout: StoryArtLayout, meals: ArtMeal[]): ArtPlacement | undefined {
  const regions = meals.flatMap(meal => layout.meals[meal] ? [layout.meals[meal]!] : []);
  if (!regions.length) return;
  const top = Math.min(...regions.map(r => r.y)) + 32;
  const bottom = Math.min(layout.height - 64, Math.max(...regions.map(r => r.y + r.height)) - 32);
  for (let width = ART_MAX_WIDTH; width >= ART_MIN_WIDTH; width -= 4) {
    const scale = width / ART_MAX_WIDTH;
    const characterHeight = Math.round(442 * CHARACTER_RATIO * scale);
    const height = Math.round(532 * scale) + characterHeight;
    // Use the same canvas anchor as the approved Badaro preview for every restaurant.
    // The group's transparent top does not need to be inside the menu card.
    const minimumY = top - (meals.length === 2 ? 170 : 180) * scale;
    if (height > bottom - minimumY) continue;
    const preferred = meals.length === 2 ? 691 : minimumY + (bottom - minimumY - height) / 2;
    const positions: number[] = [Math.round(Math.max(minimumY, Math.min(preferred, bottom - height)))];
    for (let y = Math.ceil(minimumY); y <= bottom - height; y += 8) positions.push(y);
    positions.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    for (const y of positions) {
      // The supplied example uses the right edge; small horizontal shifts can avoid long dishes.
      for (let inset = 32; inset <= 96; inset += 8) {
        const x = layout.width - inset - width;
        const box = (dx: number, dy: number, w: number, h: number): ArtRect => ({
          x: Math.round(x + dx * scale), y: Math.round(y + dy * scale),
          width: Math.round(w * scale), height: Math.round(h * scale),
        });
        const character = box(168, 532, 442, 442 * CHARACTER_RATIO);
        const bubbles: Partial<Record<ArtMeal, ArtRect>> = {};
        meals.forEach(meal => { bubbles[meal] = meals.length === 1
          ? box(259, 180, 312, 372)
          : meal === 'lunch' ? box(38, 260, 300, 358) : box(273, 170, 300, 358); });
        const parts = [character, ...Object.values(bubbles)];
        if (parts.every(part => part.x >= 32 && part.y >= top && part.x + part.width <= layout.width - 32
          && part.y + part.height <= bottom + 1)
          && [character, ...Object.values(bubbles).flatMap(bubbleCollisionParts)].every(part =>
            layout.obstacles.every(obstacle => !intersects(part, obstacle, ART_TEXT_GAP)))) {
          return { width, character, bubbles };
        }
      }
    }
  }
}
