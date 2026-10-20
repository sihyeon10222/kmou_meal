import type { StoryArtLayout } from './art-placement.js';

/** Runs inside Chromium; keep helpers self-contained for page.evaluate. */
export function measureStoryArt(): StoryArtLayout {
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
}
