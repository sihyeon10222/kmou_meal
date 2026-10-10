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
const MAX_MENU_FONT_SIZE = 88;
const BOX_PADDING = 48;
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
  // Keep each menu name intact; only additions starting with '+' may move to a new line.
  const dishHtml = (item: string) => item.split(/(?=\+)/u)
    .map(part => `<span class="dish-part">${escapeHtml(part)}</span>`).join('<wbr>');
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
  await page.evaluate(async ({ width, height, minFontSize, maxFontSize, padding, tolerance }) => {
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
      menu.style.gap = `${Math.max(8, Math.round(size * .16))}px`;
      menu.style.lineHeight = '1.15';
    };
    // DOM line boxes include font ascent/descent space that is not painted.
    // Measure the glyphs so padding is based on visible text, including wrapped lines.
    const canvas = document.createElement('canvas').getContext('2d')!;
    const metrics = new Map<string, TextMetrics>();
    const textBounds = (element: Element) => {
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      canvas.font = font;
      let top = Infinity;
      let bottom = -Infinity;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let offset = 0;
        for (const character of node.textContent ?? '') {
          const end = offset + character.length;
          if (character.trim()) {
            const key = `${font}:${character}`;
            let metric = metrics.get(key);
            if (!metric) { metric = canvas.measureText(character); metrics.set(key, metric); }
            range.setStart(node, offset);
            range.setEnd(node, end);
            const rect = range.getBoundingClientRect();
            const baseline = rect.top + metric.fontBoundingBoxAscent;
            top = Math.min(top, baseline - metric.actualBoundingBoxAscent);
            bottom = Math.max(bottom, baseline + metric.actualBoundingBoxDescent);
          }
          offset = end;
        }
      }
      return { top, bottom };
    };
    const arrangeSection = (section: HTMLElement, size: number) => {
      const menu = section.querySelector<HTMLElement>('.menu')!;
      const heading = section.querySelector<HTMLElement>('.meal-heading')!;
      const label = heading.querySelector<HTMLElement>('h2')!;
      const symbol = heading.querySelector<HTMLElement>('.symbol')!;
      setMenuTypography(menu, size);
      const labelBox = label.getBoundingClientRect();
      const ink = textBounds(label);
      const labelHeight = ink.bottom - ink.top;
      const headingHeight = Math.max(48, labelHeight);
      heading.style.position = 'relative';
      heading.style.paddingBottom = '0';
      heading.style.flexBasis = `${headingHeight + 24 + 2}px`;
      label.style.position = 'absolute';
      label.style.left = '72px';
      label.style.top = `${(headingHeight - labelHeight) / 2 - (ink.top - labelBox.top)}px`;
      symbol.style.position = 'absolute';
      symbol.style.left = '0';
      symbol.style.top = `${(headingHeight - 48) / 2}px`;
      menu.style.paddingTop = '0';
      const firstInk = textBounds(menu.firstElementChild!);
      menu.style.paddingTop = `${24 - (firstInk.top - menu.getBoundingClientRect().top)}px`;
      const lastInk = textBounds(menu.lastElementChild!);
      return Math.ceil(lastInk.bottom - section.getBoundingClientRect().top);
    };
    const measureSection = (section: HTMLElement, size: number) => {
      const clone = section.cloneNode(true) as HTMLElement;
      clone.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;width:${section.clientWidth}px;height:auto;min-height:0;`;
      story.append(clone);
      const contentHeight = arrangeSection(clone, size);
      clone.remove();
      return contentHeight;
    };
    const header = story.querySelector('header')!;
    const headerBottom = Math.max(...[...header.children].map(textBounds).map(bounds => bounds.bottom));
    const available = height - headerBottom;
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
      if (fitsWidth && rows.reduce((sum, height) => sum + height, 0) + 2 * padding * rowCount <= available) {
        best = size;
        heights = measured;
        break;
      }
    }
    if (!best) throw new Error('메뉴가 이미지 영역을 초과합니다. 최소 글자 크기와 여백에서도 들어가지 않습니다.');
    const rows = rowHeights(heights);
    const totalContent = rows.reduce((sum, row) => sum + row, 0);
    const spare = available - totalContent - 2 * padding * rowCount;
    const allEmpty = sections.every(section => !section.querySelector('.dish:not(.empty)'));
    const boxHeights = rows.map(row => allEmpty
      ? available / rowCount
      : row + 2 * padding + spare * row / totalContent);
    const rowStarts = boxHeights.map((_, index) => boxHeights.slice(0, index).reduce((sum, box) => sum + box, 0));
    // Keep the content at the top of each box. Extra height stays below it.
    sectionsRoot.style.top = `${headerBottom + padding}px`;
    sectionsRoot.style.bottom = `${padding}px`;
    sectionsRoot.style.display = 'block';
    if (snack) {
      sectionsRoot.style.setProperty('--snack-row-1', `${boxHeights[0]}px`);
      sectionsRoot.style.setProperty('--snack-row-2', `${boxHeights[1]}px`);
    }
    sections.forEach((section, index) => {
      section.style.position = 'absolute';
      section.style.top = `${rowStarts[snack ? Math.floor(index / 2) : index]}px`;
      section.style.left = snack && index % 2 ? 'calc((100% + 48px) / 2)' : '0';
      section.style.width = snack ? 'calc((100% - 48px) / 2)' : '100%';
      arrangeSection(section, best);
      section.style.flex = 'none';
      section.style.height = `${heights[index]}px`;
      const menu = section.querySelector<HTMLElement>('.menu')!;
      setMenuTypography(menu, best);
      if (menu.scrollHeight > menu.clientHeight + tolerance || menu.scrollWidth > menu.clientWidth + tolerance) {
        throw new Error(`메뉴가 이미지 영역을 초과합니다: ${section.className} (${menu.scrollHeight}/${menu.clientHeight}, ${menu.scrollWidth}/${menu.clientWidth}, ${heights[index]})`);
      }
    });
    if (story.classList.contains('full') && !snack) {
      story.style.setProperty('--morning-end', `${headerBottom + rowStarts[1]!}px`);
      story.style.setProperty('--night-start', `${headerBottom + rowStarts[2]!}px`);
    }
    const safe = sectionsRoot.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const title = story.querySelector('h1')!.getBoundingClientRect();
    const date = story.querySelector('.date')!.getBoundingClientRect();
    if (headerBox.bottom > safe.top || title.right + 24 > date.left + tolerance || date.right > width - padding + tolerance) {
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
  }, { ...STORY_SIZE, minFontSize: MIN_MENU_FONT_SIZE, maxFontSize: MAX_MENU_FONT_SIZE,
    padding: BOX_PADDING, tolerance: OVERFLOW_TOLERANCE });
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
