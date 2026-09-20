import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, readTemplate, loadFont } from './render-assets.js';
export { escapeHtml } from './render-assets.js';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { MenuSection, StoryRenderData } from './story-data.js';
import type { Restaurant } from './story-modes.js';

const STORY_SIZE = { width: 1080, height: 1920 };
const JPEG_QUALITY = 94;
const MIN_MENU_FONT_SIZE = 28;
const MAX_MENU_FONT_SIZE = 60;
const OVERFLOW_TOLERANCE = 1;

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
  const [template, css, font] = await Promise.all([
    readTemplate('story.html'), readTemplate('shared.css'), loadFont(),
  ]);
  return { template, css, font };
}

function sectionHtml(section: MenuSection): string {
  const symbol = section.key === 'dinner' ? 'moon' : 'sun';
  const dishHtml = (item: string) => Array.from(item, character => {
    // 메뉴 조합에 쓰이는 모든 유니코드 문장부호·기호 앞을 선택적 줄바꿈 지점으로 둡니다.
    // escapeHtml 이후에 처리하면 &amp; 같은 HTML entity를 깨뜨릴 수 있으므로 원문을 순회합니다.
    const isBreakPoint = /[\p{P}\p{S}]/u.test(character) && character !== '<' && character !== '>';
    return `${isBreakPoint ? '<wbr>' : ''}${escapeHtml(character)}`;
  }).join('');
  const items = section.items.length
    ? section.items.map(item => `<p class="dish">${dishHtml(item)}</p>`).join('')
    : '<p class="dish empty">메뉴 없음</p>';
  return `<section class="meal ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><span class="symbol ${symbol}"></span><h2>${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
}

function buildStoryHtml(data: StoryRenderData, assets: TemplateAssets, layout: string): string {
  const { request, sections } = data;
  const replacements: Record<string, string> = {
    FONT: assets.font,
    CSS: `${assets.css}\n${layout}`,
    CLASSES: `${request.restaurant === 'badaro' ? 'badaro dormitory' : request.restaurant} ${request.scope}`,
    DATE: escapeHtml(request.dateLabel),
    TITLE: escapeHtml(request.title),
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
  // Values must be passed explicitly because this callback runs inside Chromium.
  await page.evaluate(async ({ width, minFontSize, maxFontSize, tolerance }) => {
    await document.fonts.ready;
    if (!document.fonts.check('560 50px Meal', '기숙사 식단')) {
      throw new Error('한글 폰트 로딩 실패');
    }

    const story = document.querySelector<HTMLElement>('.story');
    const sectionsRoot = document.querySelector<HTMLElement>('.sections');
    const sections = [...document.querySelectorAll<HTMLElement>('.meal')];
    if (!story || !sectionsRoot || sections.length === 0) throw new Error('Story 메뉴 영역이 없습니다.');

    const setMenuTypography = (menu: HTMLElement, size: number) => {
      menu.style.fontSize = `${size}px`;
      menu.style.gap = `${Math.max(5, Math.round(size * .25))}px`;
      menu.style.lineHeight = size <= 36 ? '1.2' : '1.3';
    };
    const measureSection = (section: HTMLElement, size: number) => {
      const clone = section.cloneNode(true) as HTMLElement;
      clone.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;width:${section.clientWidth}px;height:auto;min-height:0;`;
      const menu = clone.querySelector<HTMLElement>('.menu');
      if (!menu) throw new Error('메뉴 요소가 없습니다.');
      menu.style.flex = 'none';
      menu.style.height = 'auto';
      setMenuTypography(menu, size);
      story.append(clone);
      const height = Math.ceil(clone.scrollHeight);
      clone.remove();
      return height;
    };
    const allocate = (minimums: number[], maximums: number[], available: number) => {
      const minTotal = minimums.reduce((sum, value) => sum + value, 0);
      if (minTotal > available + tolerance) {
        throw new Error(`메뉴가 이미지 영역을 초과합니다. 최소 필요 높이 ${Math.ceil(minTotal)}px / 사용 가능 높이 ${Math.floor(available)}px`);
      }
      // Square-root weighting still grants denser sections more room, while
      // reserving enough space for sparse sections to use visibly larger type.
      const growth = maximums.map((value, index) => Math.sqrt(Math.max(0, value - minimums[index]!)));
      const growthTotal = growth.reduce((sum, value) => sum + value, 0);
      const remaining = available - minTotal;
      const allocations = minimums.map((value, index) => value + (growthTotal ? remaining * growth[index]! / growthTotal : remaining / minimums.length));
      return allocations;
    };

    const sectionMinimums = sections.map(section => measureSection(section, minFontSize));
    const sectionMaximums = sections.map(section => measureSection(section, maxFontSize));
    if (story.classList.contains('snack')) {
      const gap = parseFloat(getComputedStyle(sectionsRoot).rowGap) || 0;
      const minimums = [Math.max(sectionMinimums[0]!, sectionMinimums[1]!), Math.max(sectionMinimums[2]!, sectionMinimums[3]!)];
      const maximums = [Math.max(sectionMaximums[0]!, sectionMaximums[1]!), Math.max(sectionMaximums[2]!, sectionMaximums[3]!)];
      const rows = allocate(minimums, maximums, sectionsRoot.clientHeight - gap);
      sectionsRoot.style.setProperty('--snack-row-1', `${rows[0]}px`);
      sectionsRoot.style.setProperty('--snack-row-2', `${rows[1]}px`);
    } else if (story.classList.contains('full')) {
      const gap = parseFloat(getComputedStyle(sectionsRoot).rowGap) || 0;
      const heights = allocate(sectionMinimums, sectionMaximums, sectionsRoot.clientHeight - gap * (sections.length - 1));
      sections.forEach((section, index) => { section.style.height = `${heights[index]}px`; });
    }

    for (const section of sections) {
      const menu = section.querySelector<HTMLElement>('.menu');
      if (!menu) throw new Error('메뉴 요소가 없습니다.');
      let low = minFontSize;
      let high = maxFontSize;
      let best = minFontSize;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        setMenuTypography(menu, size);
        const fits = menu.scrollHeight <= menu.clientHeight + tolerance && menu.scrollWidth <= menu.clientWidth + tolerance;
        if (fits) { best = size; low = size + 1; } else { high = size - 1; }
      }
      setMenuTypography(menu, best);
      if (menu.scrollHeight > menu.clientHeight + tolerance || menu.scrollWidth > menu.clientWidth + tolerance) {
        throw new Error(`메뉴가 이미지 영역을 초과합니다: ${section.className} (${menu.scrollHeight}×${menu.scrollWidth} / ${menu.clientHeight}×${menu.clientWidth})`);
      }
    }

    if (story.classList.contains('full')) {
      const breakfast = story.querySelector<HTMLElement>('.meal.breakfast');
      const dinner = story.querySelector<HTMLElement>('.meal.dinner');
      if (breakfast) story.style.setProperty('--morning-end', `${Math.round(breakfast.getBoundingClientRect().bottom + 15)}px`);
      if (dinner) story.style.setProperty('--night-start', `${Math.round(dinner.getBoundingClientRect().top - 15)}px`);
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
  }, { width: STORY_SIZE.width, minFontSize: MIN_MENU_FONT_SIZE, maxFontSize: MAX_MENU_FONT_SIZE, tolerance: OVERFLOW_TOLERANCE });
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
      const layout = layouts.get(restaurant) ?? readTemplate(`${restaurant === 'badaro' ? 'dormitory' : restaurant}.css`);
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
