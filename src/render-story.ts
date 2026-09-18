import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { MenuSection, StoryRenderData } from './story-data.js';
import type { Restaurant } from './story-modes.js';

const STORY_SIZE = { width: 1080, height: 1920 };
const JPEG_QUALITY = 94;
const MIN_MENU_FONT_SIZE = 28;
const OVERFLOW_TOLERANCE = 1;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

interface TemplateAssets {
  template: string;
  css: string;
  font: string;
}

export interface StoryRenderer {
  render(data: StoryRenderData, outputDir?: string): Promise<string>;
  close(): Promise<void>;
}

// The bundled font is immutable and large; retain its encoded form across renders.
let fontBase64: Promise<string> | undefined;

function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../templates/${name}`, import.meta.url), 'utf8');
}

async function loadTemplateAssets(): Promise<TemplateAssets> {
  fontBase64 ??= readFile(new URL('../assets/fonts/NotoSansKR.ttf', import.meta.url))
    .then(font => font.toString('base64'))
    .catch(error => {
      fontBase64 = undefined;
      throw error;
    });
  const [template, css, font] = await Promise.all([
    readTemplate('story.html'), readTemplate('shared.css'), fontBase64,
  ]);
  return { template, css, font };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}

function sectionHtml(section: MenuSection): string {
  const symbol = section.key === 'dinner' ? 'moon' : 'sun';
  const items = section.items.length
    ? section.items.map(item => `<p class="dish">${escapeHtml(item)}</p>`).join('')
    : '<p class="dish empty">메뉴 없음</p>';
  return `<section class="meal ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><span class="symbol ${symbol}"></span><h2>${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
}

function buildStoryHtml(data: StoryRenderData, assets: TemplateAssets, layout: string): string {
  const { request, sections } = data;
  const replacements: Record<string, string> = {
    FONT: assets.font,
    CSS: `${assets.css}\n${layout}`,
    CLASSES: `${request.restaurant} ${request.scope}`,
    DATE: escapeHtml(request.dateLabel),
    TITLE: escapeHtml(request.title),
    SECTIONS: sections.map(sectionHtml).join(''),
  };
  return assets.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

export async function storyHtml(data: StoryRenderData): Promise<string> {
  const [assets, layout] = await Promise.all([
    loadTemplateAssets(), readTemplate(`${data.request.restaurant}.css`),
  ]);
  return buildStoryHtml(data, assets, layout);
}

async function fitMenusAndValidateLayout(page: Page): Promise<void> {
  // Values must be passed explicitly because this callback runs inside Chromium.
  await page.evaluate(async ({ width, minFontSize, tolerance }) => {
    await document.fonts.ready;
    if (!document.fonts.check('560 50px Meal', '기숙사 식단')) {
      throw new Error('한글 폰트 로딩 실패');
    }
    for (const element of document.querySelectorAll<HTMLElement>('.menu')) {
      let size = parseFloat(getComputedStyle(element).fontSize);
      while ((element.scrollHeight > element.clientHeight + tolerance || element.scrollWidth > element.clientWidth + tolerance) && size > minFontSize) {
        size -= 1;
        element.style.fontSize = `${size}px`;
        element.style.gap = `${Math.max(5, size - 35)}px`;
      }
      if (element.scrollHeight > element.clientHeight + tolerance || element.scrollWidth > element.clientWidth + tolerance) {
        throw new Error('메뉴가 이미지 영역을 초과합니다. 게시 전 레이아웃 조정이 필요합니다.');
      }
    }
    const footer = document.querySelector('footer');
    if (!footer) throw new Error('Story 푸터가 없습니다. 템플릿을 확인하세요.');
    const footerTop = footer.getBoundingClientRect().top;
    for (const section of document.querySelectorAll('.meal')) {
      const rect = section.getBoundingClientRect();
      if (rect.bottom > footerTop || rect.left < 0 || rect.right > width) {
        throw new Error('메뉴 레이아웃이 안전 영역을 초과합니다.');
      }
    }
  }, { width: STORY_SIZE.width, minFontSize: MIN_MENU_FONT_SIZE, tolerance: OVERFLOW_TOLERANCE });
}

/** Reuses one browser and template snapshot for sequential Stories in a batch. */
export function createStoryRenderer(): StoryRenderer {
  let browser: Promise<Browser> | undefined;
  let assets: Promise<TemplateAssets> | undefined;
  const layouts = new Map<Restaurant, Promise<string>>();
  let closed = false;

  return {
    async render(data, outputDir = 'output') {
      if (closed) throw new Error('Story 렌더러가 이미 종료되었습니다.');
      assets ??= loadTemplateAssets();
      const restaurant = data.request.restaurant;
      const layout = layouts.get(restaurant) ?? readTemplate(`${restaurant}.css`);
      layouts.set(restaurant, layout);
      const [common, restaurantCss] = await Promise.all([assets, layout]);
      const html = buildStoryHtml(data, common, restaurantCss);
      await mkdir(outputDir, { recursive: true });
      const stem = resolve(outputDir, `${data.request.targetDate}-${data.request.mode}`);

      browser ??= chromium.launch({ headless: true }).catch(error => {
        browser = undefined;
        throw error;
      });
      const page = await (await browser).newPage({ viewport: STORY_SIZE, deviceScaleFactor: 1 });
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await fitMenusAndValidateLayout(page);
        await writeFile(`${stem}.html`, await page.content());
        await page.screenshot({ path: `${stem}.jpg`, type: 'jpeg', quality: JPEG_QUALITY });
        return `${stem}.jpg`;
      } finally {
        await page.close();
      }
    },
    async close() {
      closed = true;
      const activeBrowser = browser;
      browser = undefined;
      if (activeBrowser) await (await activeBrowser).close();
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
