import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import { renderThoughtBubble } from './story-art-bubble.js';
import { cloudflareConfig, createFoodAi, FOOD_IMAGE_MODEL, FOOD_SELECTION_MODEL, type FoodAi } from './cloudflare-ai.js';
import { safeError } from './config.js';
import type { StoryRenderData } from './story-data.js';
import { findArtPlacement, type ArtMeal, type ArtPlacement, type StoryArtLayout } from './story-art-layout.js';

export type StoryArtMode = 'off' | 'cache' | 'generate';
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
const STYLE_VERSION = 'food-thought-bubble-v6-complete';
const SELECTION_VERSION = 'main-dish-v2-visual';
const DEFAULT_CHARACTER = fileURLToPath(new URL('../assets/illustrations/haeyangi.png', import.meta.url));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
async function readOptional(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); } catch (error) { if (!missing(error)) throw error; }
}
async function save(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes); await rename(temporary, path);
}

export function artMode(value: string | undefined, fallback: StoryArtMode): StoryArtMode {
  if (value === undefined || value === '') return fallback;
  if (value !== 'off' && value !== 'cache' && value !== 'generate') throw new Error('Story art: off / cache / generate');
  return value;
}

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
  const lunch = dish.meal === 'lunch';
  const description = dish.description.replace(/\b(?:with a side of|alongside|accompanied by|served alongside)\b[\s\S]*$/i, '').trim();
  return `A cute polished Korean food thought-bubble sticker. ONE big white cloud-shaped bubble with a rounded scalloped ${lunch ? 'soft golden yellow' : 'soft sky blue'} outline. INSIDE THE CLOUD at the top, a small ${lunch ? 'golden sun' : 'yellow crescent moon'} icon beside the heading ${lunch ? 'Lunch' : 'Dinner'} in large readable rounded dark-blue handwritten letters. This ONE English word is the ONLY text anywhere in the entire image. No quotation marks, no Korean characters, no dish names, no subtitle, no other letters or writing. INSIDE THE SAME CLOUD directly below this heading, an appetizing illustration of ${description}. Draw ONLY this dish in one bowl or plate; omit accompanying rice, kimchi and side dishes. The title, icon and food form one balanced composition enclosed together in this single white cloud. The food plate occupies about 60 percent of the cloud width, with generous even WHITE PADDING between the entire plate and every edge of the cloud, and a moderate clear gap under the title. All food stays inside the bubble. Cute cartoon with clean dark outlines, glossy warm food colors and gentle soft shading. Two small separate white thought circles trail down from the bottom center of the cloud. The whole sticker is fully visible and centered with margin on every side of the square. No mascot, no people, no watermark, no frame. Outside the cloud and circles is perfectly flat solid vivid magenta #FF00FF filling all four canvas edges. The inside of the cloud is pure white.`;
}

/** FLUX returns RGB. Remove the explicit chroma backdrop while retaining the white bubble. */
export async function transparentBubble(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input, { limitInputPixels: 4_194_304 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Flood from the edges so pink ingredients enclosed inside a white bubble are preserved.
  const count = info.width * info.height, visited = new Uint8Array(count), queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    const i = pixel * 4, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (data[i + 3]! >= 16 && !(r > g + 15 && b > g + 15 && r > 90 && b > 90)) return;
    visited[pixel] = 1; queue[tail++] = pixel;
  };
  for (let x = 0; x < info.width; x++) { visit(x); visit((info.height - 1) * info.width + x); }
  for (let y = 0; y < info.height; y++) { visit(y * info.width); visit(y * info.width + info.width - 1); }
  while (head < tail) {
    const pixel = queue[head++]!, x = pixel % info.width;
    data[pixel * 4 + 3] = 0;
    if (x) visit(pixel - 1);
    if (x < info.width - 1) visit(pixel + 1);
    if (pixel >= info.width) visit(pixel - info.width);
    if (pixel + info.width < count) visit(pixel + info.width);
  }
  let transparent = 0, borderOpaque = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3]! < 16) transparent++;
    else if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) borderOpaque++;
  }
  const fraction = transparent / (info.width * info.height);
  if (fraction < .15 || fraction > .9 || borderOpaque > (info.width + info.height) * .04) {
    throw new Error('음식 말풍선의 배경 분리 또는 가장자리 검증에 실패했습니다.');
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
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
      let placement = findArtPlacement(layout, meals);
      if (!placement) return skip('insufficient-space');
      try {
        character ??= readFile(options.characterPath ?? DEFAULT_CHARACTER).then(bytes => sharp(bytes).trim().png().toBuffer());
        const characterImage = await character;
        const config = options.mode === 'generate' && !options.ai ? cloudflareConfig() : undefined;
        const ai = options.ai ?? (config ? createFoodAi(config) : undefined);
        const selectionKey = hash({ model: FOOD_SELECTION_MODEL, version: SELECTION_VERSION, menus });
        const selectionPath = resolve(cacheDir, 'selections', `${selectionKey}.json`);
        let selectionCache = await readOptional(selectionPath);
        // Older cached responses could omit dinner despite having real dinner dishes.
        // Reuse complete selections, but never silently turn two meals into one bubble.
        if (selectionCache) {
          try { validateSelection(JSON.parse(selectionCache.toString()), menus); }
          catch { selectionCache = undefined; }
        }
        let rawSelection: unknown;
        if (selectionCache) { rawSelection = JSON.parse(selectionCache.toString()); report.cacheHits++; }
        else {
          if (options.mode !== 'generate') return skip('selection-cache-miss');
          if (!ai) return skip('missing-cloudflare-config');
          report.selectionCalls++;
          rawSelection = await ai.select(menus);
          validateSelection(rawSelection, menus);
          await save(selectionPath, JSON.stringify(rawSelection));
        }
        const selected = validateSelection(rawSelection, menus);
        report.selected = selected;
        if (!selected.length) return skip('no-food-selected');
        placement = findArtPlacement(layout, selected.map(dish => dish.meal));
        if (!placement) return skip('insufficient-space');
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
