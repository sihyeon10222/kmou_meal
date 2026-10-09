import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, readTemplate, loadFont } from './render-assets.js';
export { escapeHtml } from './render-assets.js';
import { resolve } from 'node:path';
import { shortDate, weekdayName } from './weekly-data.js';
import { chromium, type Browser, type Page } from 'playwright';
import type { MenuSection, StoryRenderData } from './story-data.js';
import type { Restaurant } from './story-modes.js';

const STORY_SIZE = { width: 1080, height: 1920 };
const JPEG_QUALITY = 94;
const MIN_MENU_FONT_SIZE = 28;
const MAX_MENU_FONT_SIZE = 72;
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
    : '<p class="dish empty">등록된 식단 없음</p>';
  return `<section class="meal ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><span class="symbol ${symbol}"></span><h2>${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
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
      menu.style.gap = `${Math.max(10, Math.round(size * .22))}px`;
      menu.style.lineHeight = '1.2';
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
      const height = Math.ceil(clone.getBoundingClientRect().height);
      clone.remove();
      return height;
    };
    const headerBox = story.querySelector('header')!.getBoundingClientRect();
    const available = 1920 - 58 - headerBox.bottom;
    const snack = story.classList.contains('snack');
    const rowCount = snack ? 2 : sections.length;
    const rowHeights = (heights: number[]) => snack
      ? [Math.max(heights[0]!, heights[1]!), Math.max(heights[2]!, heights[3]!)]
      : heights;
    let best = 0;
    let heights: number[] = [];
    for (let size = maxFontSize; size >= minFontSize; size--) {
      const measured = sections.map(section => measureSection(section, size));
      const rows = rowHeights(measured);
      const fitsWidth = sections.every(section => {
        const menu = section.querySelector<HTMLElement>('.menu')!;
        setMenuTypography(menu, size);
        return menu.scrollWidth <= menu.clientWidth + tolerance;
      });
      if (fitsWidth && rows.reduce((sum, height) => sum + height, 0) + 48 * (rowCount + 1) <= available + tolerance) {
        best = size;
        heights = measured;
        break;
      }
    }
    if (!best) throw new Error('메뉴가 이미지 영역을 초과합니다. 최소 글자 크기와 여백에서도 들어가지 않습니다.');
    const rows = rowHeights(heights);
    // Distribute spare height equally above, between and below content rows for every restaurant.
    const remaining = available - rows.reduce((sum, height) => sum + height, 0);
    const gap = remaining / (rowCount + 1);
    sectionsRoot.style.top = `${headerBox.bottom + gap}px`;
    sectionsRoot.style.bottom = `${58 + gap}px`;
    sectionsRoot.style.rowGap = `${gap}px`;
    if (snack) {
      sectionsRoot.style.setProperty('--snack-row-1', `${rows[0]}px`);
      sectionsRoot.style.setProperty('--snack-row-2', `${rows[1]}px`);
    } else {
      sectionsRoot.style.display = 'flex';
      sectionsRoot.style.flexDirection = 'column';
    }
    sections.forEach((section, index) => {
      section.style.flex = 'none';
      section.style.height = `${heights[index]}px`;
      const menu = section.querySelector<HTMLElement>('.menu')!;
      setMenuTypography(menu, best);
      if (menu.scrollHeight > menu.clientHeight + tolerance || menu.scrollWidth > menu.clientWidth + tolerance) {
        throw new Error(`메뉴가 이미지 영역을 초과합니다: ${section.className} (${menu.scrollHeight}/${menu.clientHeight}, ${menu.scrollWidth}/${menu.clientWidth}, ${heights[index]})`);
      }
    });
    if (story.classList.contains('full') && !snack) {
      const breakfast = story.querySelector<HTMLElement>('.meal.breakfast');
      const dinner = story.querySelector<HTMLElement>('.meal.dinner');
      if (breakfast) story.style.setProperty('--morning-end', `${breakfast.getBoundingClientRect().bottom + gap / 2}px`);
      if (dinner) story.style.setProperty('--night-start', `${dinner.getBoundingClientRect().top - gap / 2}px`);
    }
    const safe = sectionsRoot.getBoundingClientRect();
    const header = story.querySelector('header')!.getBoundingClientRect();
    const title = story.querySelector('h1')!.getBoundingClientRect();
    const date = story.querySelector('.date')!.getBoundingClientRect();
    if (header.bottom > safe.top || title.right + 24 > date.left + tolerance || date.right > width - 58 + tolerance) {
      throw new Error('Story 제목과 날짜가 겹치거나 안전 영역을 초과합니다.');
    }
    for (const section of document.querySelectorAll('.meal')) {
      const rect = section.getBoundingClientRect();
      if (rect.bottom > safe.bottom + tolerance || rect.top < safe.top - tolerance
        || rect.left < safe.left - tolerance || rect.right > Math.min(safe.right, width) + tolerance) {
        throw new Error(`메뉴 레이아웃이 안전 영역을 초과합니다: ${section.className} ` +
          `(좌 ${Math.round(rect.left)}, 우 ${Math.round(rect.right)}, 하 ${Math.round(rect.bottom)} / ` +
          `안전 좌 ${Math.round(safe.left)}, 우 ${Math.round(safe.right)}, 하 ${Math.round(safe.bottom)})`);
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
      // Keep the exact input even when layout validation rejects the image.
      await writeFile(`${stem}.menu.json`, JSON.stringify(data, null, 2));

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
