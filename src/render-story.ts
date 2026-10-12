import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, readTemplate, loadFontCss } from './render-assets.js';
export { escapeHtml } from './render-assets.js';
import { resolve } from 'node:path';
import { shortDate, weekdayName } from './weekly-data.js';
import { layoutStory } from './layout-story.js';
import type { Page } from 'playwright';
import { createRenderBrowser } from './render-browser.js';
import type { MenuSection, StoryRenderData } from './story-data.js';
import type { Restaurant } from './story-modes.js';
import { measureStoryArtLayout } from './story-art-layout.js';
import type { StoryArtDecorator } from './story-art.js';
import { safeError } from './config.js';

const STORY_SIZE = { width: 1080, height: 1920 };
const JPEG_QUALITY = 94;

interface TemplateAssets {
  template: string;
  css: string;
  font: string;
}

export interface StoryRenderer {
  render(data: StoryRenderData, outputDir?: string): Promise<string>;
  close(): Promise<void>;
}

async function loadTemplateAssets(): Promise<TemplateAssets> {
  const [template, css, font, design] = await Promise.all([
    readTemplate('story.html'), readTemplate('shared.css'), loadFontCss(), readTemplate('design.css'),
  ]);
  return { template, css: `${design}\n${css}`, font };
}

function sectionHtml(section: MenuSection): string {
  // Keep each menu name intact; only additions starting with '+' may move to a new line.
  const dishHtml = (item: string) => item.split(/(?=\+)/u)
    .map(part => `<span class="dish-part">${escapeHtml(part)}</span>`).join('<wbr>');
  const items = section.items.length
    ? section.items.map(item => `<p class="dish">${dishHtml(item)}</p>`).join('')
    : '<p class="dish empty">등록된 식단 없음</p>';
  return `<section class="meal ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><h2 class="meal-label">${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
}

function buildStoryHtml(data: StoryRenderData, assets: TemplateAssets, layout: string): string {
  const { request, sections } = data;
  const replacements: Record<string, string> = {
    FONT: assets.font,
    CSS: `${assets.css}\n${layout}`,
    CLASSES: `${request.restaurant === 'badaro' ? 'badaro dormitory' : request.restaurant} ${request.scope}`,
    DATE: escapeHtml(`${shortDate(request.targetDate)}(${weekdayName(request.targetDate)})`),
    TITLE: { dormitory: '기숙사', badaro: '승선생활관', snack: '학식', teacher: '교직원식당' }[request.restaurant],
    SECTIONS: sections.map(sectionHtml).join(''),
  };
  return assets.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

export async function storyHtml(data: StoryRenderData): Promise<string> {
  const [assets, layout] = await Promise.all([
    loadTemplateAssets(), readTemplate(`${data.request.restaurant === 'badaro' ? 'dormitory' : data.request.restaurant}.css`),
  ]);
  return buildStoryHtml(data, assets, layout);
}

async function fitMenusAndValidateLayout(page: Page): Promise<void> {
  // tsx/esbuild preserves nested callback names with this helper; Chromium executes
  // the serialized callback outside Node's module scope.
  await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
  await page.evaluate(layoutStory);
}

/** Reuses one browser and template snapshot for sequential Stories in a batch. */
export function createStoryRenderer(options: { art?: StoryArtDecorator } = {}): StoryRenderer {
  const browser = createRenderBrowser('Story');
  let assets: Promise<TemplateAssets> | undefined;
  const layouts = new Map<Restaurant, Promise<string>>();
  let closed = false;

  return {
    async render(data, outputDir = 'output') {
      if (closed) throw new Error('Story 렌더러가 이미 종료되었습니다.');
      assets ??= loadTemplateAssets();
      const restaurant = data.request.restaurant;
      const layout = layouts.get(restaurant) ?? readTemplate(`${restaurant === 'badaro' ? 'dormitory' : restaurant}.css`);
      layouts.set(restaurant, layout);
      const [common, restaurantCss] = await Promise.all([assets, layout]);
      const html = buildStoryHtml(data, common, restaurantCss);
      await mkdir(outputDir, { recursive: true });
      const stem = resolve(outputDir, `${data.request.targetDate}-${data.request.mode}`);
      // Keep the exact input even when layout validation rejects the image.
      await writeFile(`${stem}.menu.json`, JSON.stringify(data, null, 2));

      const page = await browser.newPage({ viewport: STORY_SIZE, deviceScaleFactor: 1 });
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await fitMenusAndValidateLayout(page);
        await writeFile(`${stem}.html`, await page.content());
        // Optional decoration is isolated from the validated, publishable base Story.
        let decorated: Buffer | undefined;
        if (options.art) {
          const base = await page.screenshot({ type: 'png' });
          try {
            const result = await options.art.decorate(data, await measureStoryArtLayout(page), base);
            await writeFile(`${stem}.art.json`, JSON.stringify(result.report, null, 2));
            decorated = result.image;
            console.info(`Story AI ${data.request.mode}: ${result.report.status}${result.report.reason ? ` (${result.report.reason})` : ''}`);
            if (decorated) await page.screenshot({ path: `${stem}.base.jpg`, type: 'jpeg', quality: JPEG_QUALITY });
          } catch (error) {
            console.warn(`Story AI 생략: ${safeError(error)}`);
          }
        }
        if (decorated) await writeFile(`${stem}.jpg`, decorated);
        else await page.screenshot({ path: `${stem}.jpg`, type: 'jpeg', quality: JPEG_QUALITY });
        return `${stem}.jpg`;
      } catch (error) {
        // Diagnostic files are never returned as publishable images.
        await Promise.allSettled([
          page.content().then(content => writeFile(`${stem}.failed.html`, content)),
          page.screenshot({ path: `${stem}.failed.png`, type: 'png' }),
        ]);
        throw error;
      } finally {
        await page.close();
      }
    },
    async close() {
      closed = true;
      await browser.close();
    },
  };
}

/** 모든 메뉴를 담은 한 장. 읽을 수 있는 최소 크기에서도 넘치면 게시 전 실패합니다. */
export async function renderStory(data: StoryRenderData, outputDir = 'output'): Promise<string> {
  const renderer = createStoryRenderer();
  try {
    return await renderer.render(data, outputDir);
  } finally {
    await renderer.close();
  }
}
