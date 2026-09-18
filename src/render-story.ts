import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { StoryRenderData } from './story-data.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export async function storyHtml(data: StoryRenderData): Promise<string> {
  const { request, sections } = data;
  const [template, css, layout, font] = await Promise.all([
    readFile(new URL('../templates/story.html', import.meta.url), 'utf8'),
    readFile(new URL('../templates/shared.css', import.meta.url), 'utf8'),
    readFile(new URL(`../templates/${request.restaurant}.css`, import.meta.url), 'utf8'),
    readFile(new URL('../assets/fonts/NotoSansKR.ttf', import.meta.url)),
  ]);
  const content = sections.map(section => {
    const symbol = section.key === 'dinner' ? 'moon' : 'sun';
    const items = section.items.length
      ? section.items.map(item => `<p class="dish">${escapeHtml(item)}</p>`).join('')
      : '<p class="dish empty">메뉴 없음</p>';
    return `<section class="meal ${section.key}" aria-label="${escapeHtml(section.label)}"><div class="meal-heading"><span class="symbol ${symbol}"></span><h2>${escapeHtml(section.label)}</h2></div><div class="menu">${items}</div></section>`;
  }).join('');
  const replacements: Record<string, string> = {
    FONT: font.toString('base64'), CSS: css + '\n' + layout,
    CLASSES: `${request.restaurant} ${request.scope}`,
    DATE: escapeHtml(request.dateLabel), TITLE: escapeHtml(request.title), SECTIONS: content,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

/** 모든 메뉴를 담은 한 장. 읽을 수 있는 최소 크기에서도 넘치면 게시 전 실패합니다. */
export async function renderStory(data: StoryRenderData, outputDir = 'output'): Promise<string> {
  const html = await storyHtml(data);
  await mkdir(outputDir, { recursive: true });
  const stem = resolve(outputDir, `${data.request.targetDate}-${data.request.mode}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (!document.fonts.check('560 50px Meal', '기숙사 식단')) throw new Error('한글 폰트 로딩 실패');
      for (const element of document.querySelectorAll<HTMLElement>('.menu')) {
        let size = parseFloat(getComputedStyle(element).fontSize);
        while ((element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) && size > 28) {
          size -= 1;
          element.style.fontSize = `${size}px`;
          element.style.gap = `${Math.max(5, size - 35)}px`;
        }
        if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) throw new Error('메뉴가 이미지 영역을 초과합니다. 게시 전 레이아웃 조정이 필요합니다.');
      }
      const footer = document.querySelector('footer')!.getBoundingClientRect();
      for (const section of document.querySelectorAll('.meal')) {
        const rect = section.getBoundingClientRect();
        if (rect.bottom > footer.top || rect.left < 0 || rect.right > 1080) throw new Error('메뉴 레이아웃이 안전 영역을 초과합니다.');
      }
    });
    await writeFile(`${stem}.html`, await page.content());
    await page.screenshot({ path: `${stem}.jpg`, type: 'jpeg', quality: 94 });
    return `${stem}.jpg`;
  } finally {
    await browser.close();
  }
}
