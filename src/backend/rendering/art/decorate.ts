import { frontendAsset } from '../../config/paths.js';
import { readOptional, save } from './cache.js';
import { transparentBubble } from './image-processing.js';
import type { StoryArtMode } from '../../../shared/contracts/art.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderThoughtBubble } from './bubble-compositor.js';
import { cloudflareConfig, createFoodAi, FOOD_IMAGE_MODEL, FOOD_SELECTION_MODEL, type FoodAi } from '../../integrations/cloudflare/food-ai.js';
import { safeError } from '../../support/safe-error.js';
import type { StoryRenderData } from '../../../shared/contracts/story.js';
import { findArtPlacement, type ArtMeal, type ArtPlacement, type StoryArtLayout } from '../../../frontend/story/art-placement.js';

import sharp, { type OverlayOptions } from 'sharp';

export interface SelectedDish { meal: ArtMeal; item: string; description: string }
export interface StoryArtReport {
  status: 'applied' | 'skipped' | 'failed'; reason?: string;
  selected?: SelectedDish[]; placement?: ArtPlacement;
  selectionCalls: number; imageCalls: number; cacheHits: number;
}
export interface StoryArtResult { image?: Buffer; report: StoryArtReport }
export interface StoryArtDecorator {
  decorate(data: StoryRenderData, layout: StoryArtLayout, base: Buffer): Promise<StoryArtResult>;
}
export interface StoryArtOptions {
  mode: StoryArtMode; cacheDir?: string; size?: number; ai?: FoodAi; characterPath?: string;
}
const STYLE_VERSION = 'food-only-v7-fixed-heading';
const SELECTION_VERSION = 'main-dish-v2-visual';
const DEFAULT_CHARACTER = frontendAsset('illustrations/haeyangi.png');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** No meaningful food means no selection or generation call. Preserve all original menu text. */
export function artMenus(data: StoryRenderData): Partial<Record<ArtMeal, string[]>> {
  if (data.request.restaurant === 'snack') return {};
  return Object.fromEntries(data.sections.filter(s => s.key === 'lunch' || s.key === 'dinner').flatMap(s => {
    const items = s.items.map(item => item.trim()).filter(item => item
      && !/(등록된\s*식단\s*없음|메뉴\s*없음|미운영|미제공|운영\s*안\s*함|휴무|휴관|휴업|식단\s*없음)/u.test(item));
    return items.length ? [[s.key, items]] : [];
  }));
}

export function validateSelection(value: unknown, menus: Partial<Record<ArtMeal, string[]>>): SelectedDish[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('메뉴 선택 JSON 형식이 잘못되었습니다.');
  return Object.entries(menus).flatMap(([meal, items]) => {
    const choice = (value as Record<string, unknown>)[meal];
    if (!choice || typeof choice !== 'object') throw new Error(`${meal} 메뉴 선택이 없습니다.`);
    const { index, description } = choice as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || !items[index]
      || typeof description !== 'string' || description.length < 5 || description.length > 600) {
      throw new Error(`${meal} 메뉴 선택이 실제 식단과 일치하지 않습니다.`);
    }
    return [{ meal: meal as ArtMeal, item: items[index]!, description }];
  });
}

export function foodPrompt(dish: SelectedDish): string {
  const description = dish.description.replace(/\b(?:with a side of|alongside|accompanied by|served alongside)\b[\s\S]*$/i, '').trim();
  return `A cute polished Korean food illustration of ${description}. Draw ONLY this ONE dish in one bowl or plate, with clean dark outlines, appetizing colors and gentle glossy shading. No accompanying rice, side dishes, mascot, people, cloud, speech bubble, thought bubble, sun, moon, stars, icons, text, letters, labels, writing or watermark. The entire dish and plate must be fully visible, centered with generous even margin on all sides. The dish fills about 70 percent of the square. Outside the dish and plate is perfectly flat solid vivid magenta #FF00FF filling all four canvas edges. No ground shadow outside the plate.`;
}

export function createStoryArt(options: StoryArtOptions): StoryArtDecorator {
  const cacheDir = resolve(options.cacheDir ?? '.cache/story-art');
  const size = options.size ?? 512;
  if (![256, 512, 768, 1024].includes(size)) throw new Error('Story 음식 이미지 크기: 256 / 512 / 768 / 1024');
  let character: Promise<Buffer> | undefined;
  return {
    async decorate(data, layout, base) {
      const report: StoryArtReport = { status: 'skipped', selectionCalls: 0, imageCalls: 0, cacheHits: 0 };
      const skip = (reason: string): StoryArtResult => ({ report: { ...report, reason } });
      if (options.mode === 'off') return skip('disabled');
      const menus = artMenus(data), meals = Object.keys(menus) as ArtMeal[];
      if (!meals.length) return skip(data.request.restaurant === 'snack' ? 'excluded-restaurant' : 'no-lunch-or-dinner');
      // Test the minimum-size layout before spending anything on the AI.
      const placement = findArtPlacement(layout, meals);
      if (!placement) return skip('insufficient-space');
      try {
        character ??= readFile(options.characterPath ?? DEFAULT_CHARACTER).then(bytes => sharp(bytes).trim().png().toBuffer());
        const characterImage = await character;
        const config = options.mode === 'generate' && !options.ai ? cloudflareConfig() : undefined;
        const ai = options.ai ?? (config ? createFoodAi(config) : undefined);
        const selectionKey = hash({ model: FOOD_SELECTION_MODEL, version: SELECTION_VERSION, menus });
        const selectionPath = resolve(cacheDir, 'selections', `${selectionKey}.json`);
        const selectionCache = await readOptional(selectionPath);
        let selected: SelectedDish[] | undefined;
        // Older cached responses could omit dinner despite having real dinner dishes.
        // Reuse complete selections, but never silently turn two meals into one bubble.
        if (selectionCache) {
          try { selected = validateSelection(JSON.parse(selectionCache.toString()), menus); }
          catch { /* Invalid or incomplete selections are cache misses. */ }
        }
        if (selected) report.cacheHits++;
        else {
          if (options.mode !== 'generate') return skip('selection-cache-miss');
          if (!ai) return skip('missing-cloudflare-config');
          report.selectionCalls++;
          const rawSelection = await ai.select(menus);
          selected = validateSelection(rawSelection, menus);
          await save(selectionPath, JSON.stringify(rawSelection));
        }
        report.selected = selected;
        // Validation requires exactly the supplied meals, so the checked placement still applies.
        const composites: OverlayOptions[] = [];
        for (const dish of selected) {
          const prompt = foodPrompt(dish);
          // A different translation or menu context must not regenerate the same dish.
          const key = hash({ model: FOOD_IMAGE_MODEL, version: STYLE_VERSION, size, item: dish.item.normalize('NFC'), meal: dish.meal });
          const path = resolve(cacheDir, 'images', `${key}.raw.png`);
          let raw = await readOptional(path);
          if (raw) report.cacheHits++;
          else {
            if (options.mode !== 'generate') return skip('image-cache-miss');
            if (!ai) return skip('missing-cloudflare-config');
            report.imageCalls++;
            raw = await ai.image(prompt, size, parseInt(key.slice(0, 8), 16) % 2147483647);
            // Save raw results too: changing the matte/composition must never require generation again.
            raw = await sharp(raw, { limitInputPixels: 4_194_304 }).png().toBuffer();
            await save(path, raw);
            await save(path.replace('.raw.png', '.json'), JSON.stringify({ model: FOOD_IMAGE_MODEL, size, prompt, dish }));
          }
          const bubble = await transparentBubble(raw);
          const box = placement.bubbles[dish.meal]!;
          composites.push({ input: await renderThoughtBubble(bubble, dish.meal, box, placement.character), left: box.x, top: box.y });
        }
        const box = placement.character;
        composites.push({ input: await sharp(characterImage).resize(box.width, box.height, { fit: 'contain', background: '#00000000' }).png().toBuffer(), left: box.x, top: box.y });
        const image = await sharp(base).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
        return { image, report: { ...report, status: 'applied', placement } };
      } catch (error) {
        return { report: { ...report, status: 'failed', reason: safeError(error) } };
      }
    },
  };
}
