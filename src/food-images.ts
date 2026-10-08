import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { safeError } from './config.js';
import type { StoryRenderData, FoodImageResult } from './story-data.js';
import { compositeTray, selectTray, trayReference, type TrayProfile } from './tray-profiles.js';

export const FOOD_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const PROMPT_VERSION = 2;
export interface FoodConfig { accountId: string; token: string }
export function loadFoodConfig(env: NodeJS.ProcessEnv = process.env): FoodConfig | undefined {
  if (env.STORY_AI_ENABLED !== 'true') return undefined;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !/^[a-f\d]{32}$/i.test(accountId) || !token) {
    throw new Error('AI 음식 이미지: CLOUDFLARE_ACCOUNT_ID(32자리)와 CLOUDFLARE_API_TOKEN을 설정하세요.');
  }
  return { accountId, token };
}

const notice = /등록된\s*식단\s*없음|식단\s*없음|미운영|휴무|휴관|운영\s*안\s*함|미제공|식사\s*없음/u;
export function foodItems(items: string[]): string[] {
  return items.filter(item => item.trim() && !notice.test(item.trim())).flatMap(item =>
    item.split('/').map(part => part.split(/\s*or\s*|또는/u)[0]!.trim()).filter(Boolean));
}
function category(item: string): 'rice' | 'soup' | 'drink' | 'dessert' | 'main' | 'side' {
  if (/국$|탕$|찌개|스프|수프/u.test(item)) return 'soup';
  // Dish names take precedence over ingredients such as tomato or kimchi.
  if (/돈가스|돈까스|커틀릿|파스타|스파게티|갈비|탕수육|제육|불고기|두루치기|스테이크|국수|(?:돈|소|닭|낙지|낙새|새우|오징어).*볶음/u.test(item)) return 'main';
  if (/샐러드|나물|무침|김치$|장아찌|단무지|양배추찜|단호박.*찜/u.test(item)) return 'side';
  if (/우유|두유|주스|쥬스|시리얼/u.test(item)) return 'drink';
  if (/요구르트|요거트|사과|바나나|오렌지|포도|귤|과일|토마토|수박|참외|키위|파인애플/u.test(item)) return 'dessert';
  if (/밥$/u.test(item)) return 'rice';
  if (/돈가스|돈까스|커틀릿|파스타|스파게티|조림|불고기|두루치기|갈비|탕수육|제육|카레|짜장|강정|구이|찜|토스트|계란후라이|국수|면|튀김|스테이크|(?:돈|소|닭|낙지|낙새|새우|오징어).*볶음/u.test(item)) return 'main';
  return 'side';
}
export function planFood(profile: TrayProfile, items: string[]): { slot: string; items: string[] }[] {
  const slots = profile.slots.filter(slot => !slot.utensil);
  const assigned = new Map<string, string[]>(slots.map(slot => [slot.id, []]));
  const foods = foodItems(items);
  const hasSoup = foods.some(item => category(item) === 'soup');
  for (const item of foods) {
    const kind = category(item);
    // At breakfast the soup well can hold a cereal/milk bowl instead of squeezing
    // milk, cereal and fruit into the same tiny dessert compartment.
    const slotKind = kind === 'drink' ? (hasSoup ? 'dessert' : 'soup') : kind;
    const candidates = slotKind === 'side' ? profile.foodSlots.side : [profile.foodSlots[slotKind]];
    const slot = slots.filter(slot => candidates.includes(slot.id))
      .sort((a, b) => assigned.get(a.id)!.length - assigned.get(b.id)!.length)[0];
    if (!slot) throw new Error(`식판 ${profile.id}의 ${kind} 음식 칸 설정이 없습니다.`);
    assigned.get(slot.id)!.push(item);
  }
  return [...assigned].filter(([, items]) => items.length).map(([slot, items]) => ({ slot, items }));
}
export function foodPrompt(profile: TrayProfile, items: string[]): string {
  const placements = planFood(profile, items).map(placement => {
    const slot = profile.slots.find(slot => slot.id === placement.slot)!;
    const descriptions = placement.items.map(item => {
      // Supplemental descriptions help the image model distinguish literal dishes
      // from similarly colored food; the original menu remains the authority.
      const hint = /돈가스|돈까스|커틀릿/u.test(item) ? 'breaded deep-fried cutlet, crisp golden breadcrumb crust, not roast meat'
        : /토마토.*스파게티|토마토.*파스타/u.test(item) ? 'spaghetti or pasta noodles with tomato sauce'
        : /닭갈비/u.test(item) ? 'Korean spicy stir-fried chicken with cabbage'
        : /어묵매운탕/u.test(item) ? 'spicy Korean fish-cake soup in red broth, no rice in the soup'
        : '';
      return hint ? `${item} (${hint})` : item;
    });
    return `${placement.slot} (center ${Math.round((slot.x + slot.width / 2) / 10)}% across, ${Math.round((slot.y + slot.height / 2) / profile.height * 100)}% down): ${descriptions.join(', ')}`;
  });
  return `Use image 0 as the exact tray template and framing. ${profile.prompt}
Fill ONLY the assigned compartment interiors with realistic Korean cafeteria food, natural portions, soft diffused studio lighting, true food textures. Keep the tray outline and dividers at exactly the reference coordinates. No additional dishes, food, text, utensils, people, table or props. Do not move, rotate or crop the tray. Unassigned compartments stay empty. Drinks and soup may use a small cup or bowl fitting inside their assigned well. Foods listed together share the well, sauces accompany their dish. Plain 밥 means plain rice, never add curry or other unlisted toppings. Milk and cereal sharing a well should appear as cereal with milk in one bowl. Do not substitute unrelated dishes or let any food cross a divider. Korean menu names are literal food instructions:
${placements.join('\n')}`;
}

class HttpError extends Error { constructor(readonly status: number) { super(`Cloudflare AI HTTP ${status}`); } }
export interface FoodClientOptions { fetch?: typeof fetch; timeoutMs?: number; sleep?: (ms: number) => Promise<void> }
export async function generateFood(config: FoodConfig, profile: TrayProfile, items: string[], options: FoodClientOptions = {}): Promise<Buffer> {
  const reference = await trayReference(profile);
  for (let attempt = 0; ; attempt++) {
    try {
      const form = new FormData();
      form.set('prompt', foodPrompt(profile, items));
      form.set('input_image_0', new Blob([new Uint8Array(reference)], { type: 'image/png' }), 'tray.png');
      form.set('width', '1024');
      form.set('height', String(Math.round(profile.height / 1000 * 1024 / 16) * 16));
      const response = await (options.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${FOOD_MODEL}`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, body: form,
        signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
      });
      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* Preserve the HTTP status if cleanup fails. */ }
        throw new HttpError(response.status);
      }
      const body: unknown = await response.json();
      const result = body as { success?: boolean; result?: { image?: unknown } };
      if (result?.success !== true || typeof result.result?.image !== 'string' || !result.result.image.length) {
        throw new Error('Cloudflare AI 이미지 응답 구조가 올바르지 않습니다.');
      }
      const buffer = Buffer.from(result.result.image, 'base64');
      const metadata = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) throw new Error('Cloudflare AI 이미지 크기가 올바르지 않습니다.');
      return buffer;
    } catch (error) {
      const retryable = error instanceof HttpError ? error.status === 429 || error.status >= 500
        : error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
      if (attempt || !retryable) throw error;
      await (options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(1500);
    }
  }
}

export interface FoodPreparerOptions { env?: NodeJS.ProcessEnv; cacheDir?: string; client?: FoodClientOptions }
export function createFoodImagePreparer(options: FoodPreparerOptions = {}) {
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? 'output/food-cache';
  return async (data: StoryRenderData): Promise<StoryRenderData> => {
    if (env.STORY_AI_ENABLED !== 'true' || data.request.restaurant === 'snack') return data;
    const prepared: StoryRenderData = { ...data, sections: data.sections.map(({ image: _image, ...section }) => ({ ...section })), aiImages: [] };
    let cursor = 0;
    const statuses = new Map<string, FoodImageResult>();
    // Each Story waits for its workers; the sequential batch also stays below two calls.
    await Promise.all(Array.from({ length: Math.min(2, prepared.sections.length) }, async () => {
      while (cursor < prepared.sections.length) {
        const section = prepared.sections[cursor++]!;
        if (!foodItems(section.items).length) { statuses.set(section.key, { meal: section.key, status: 'skipped' }); continue; }
        const profile = selectTray(data.request.restaurant as 'dormitory' | 'badaro' | 'teacher', section.key, section.items);
        let temporary: string | undefined;
        try {
          const prompt = foodPrompt(profile, section.items);
          const key = createHash('sha256').update(JSON.stringify({ restaurant: data.request.restaurant, date: data.request.targetDate,
            meal: section.key, items: section.items, profile, model: FOOD_MODEL, version: PROMPT_VERSION, prompt })).digest('hex');
          const imagePath = resolve(cacheDir, `${key}.png`);
          const config = loadFoodConfig(env)!;
          let image: Buffer | undefined;
          try {
            const cached = await readFile(imagePath);
            const metadata = await sharp(cached).metadata();
            if (metadata.width === 1000 && metadata.height === profile.height && metadata.hasAlpha) {
              await sharp(cached).raw().toBuffer();
              image = cached;
            }
          } catch { /* Missing or damaged cache is regenerated. */ }
          const status = image ? 'cached' : 'generated';
          if (!image) {
            image = await compositeTray(profile, await generateFood(config, profile, section.items, options.client), planFood(profile, section.items).map(item => item.slot));
            await mkdir(cacheDir, { recursive: true });
            temporary = `${imagePath}.${randomUUID()}.tmp`;
            await writeFile(temporary, image);
            await rename(temporary, imagePath);
          }
          section.image = { dataUrl: `data:image/png;base64,${image.toString('base64')}`, width: 1000, height: profile.height };
          statuses.set(section.key, { meal: section.key, status, tray: profile.id, imagePath });
        } catch (error) {
          statuses.set(section.key, { meal: section.key, status: 'failed', tray: profile.id, error: safeError(error, env) });
          console.warn(`${data.request.restaurant}/${section.key}: AI 음식 사진 제외 (${safeError(error, env)})`);
        } finally { if (temporary) await rm(temporary, { force: true }).catch(() => {}); }
      }
    }));
    prepared.aiImages = prepared.sections.map(section => statuses.get(section.key)!);
    return prepared;
  };
}
