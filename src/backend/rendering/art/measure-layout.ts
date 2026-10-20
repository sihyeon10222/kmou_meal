import type { Page } from 'playwright';
import { measureStoryArt } from '../../../frontend/story/measure-art.js';
import type { StoryArtLayout } from '../../../frontend/story/art-placement.js';

export function measureStoryArtLayout(page: Page): Promise<StoryArtLayout> {
  return page.evaluate(measureStoryArt);
}
