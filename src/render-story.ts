import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { DailyMenu } from './fetch-menu.js';

export type StoryMode = 'today_lunch' | 'today_dinner' | 'tomorrow_full';

export interface StoryRenderData {
  mode: StoryMode;
  date: string;
  title: string;
  lunch?: string[];
  dinner?: string[];
  noMenu?: boolean;
  emptyMessage?: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export async function storyHtml(input: StoryRenderData | DailyMenu): Promise<string> {
  const data: StoryRenderData = 'mode' in input
    ? input
    : { mode: 'tomorrow_full', date: input.date, title: '오늘의 기숙사 식단', lunch: input.lunch, dinner: input.dinner };
  const [template, font] = await Promise.all([
    readFile(new URL('../templates/story.html', import.meta.url), 'utf8'),
    readFile(new URL('../assets/fonts/NotoSansKR.ttf', import.meta.url)),
  ]);
  const date = new Date(`${data.date.replaceAll('/', '-')}T12:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) throw new Error('이미지 날짜가 올바르지 않습니다.');
  const dishes = (items: string[]) => items.length
    ? items.map((item) => `<p class="dish">${escapeHtml(item)}</p>`).join('')
    : '<p class="dish empty">등록된 메뉴가 없습니다.</p>';
  const modeClass = `${data.mode.replace('_', '-')} ${data.noMenu ? 'no-menu' : ''} ${data.lunch?.length ? 'has-lunch' : 'no-lunch'} ${data.dinner?.length ? 'has-dinner' : 'no-dinner'}`;
  const replacements: Record<string, string> = {
    FONT: font.toString('base64'), MODE_CLASS: modeClass, TITLE: escapeHtml(data.title), EMPTY_MESSAGE: escapeHtml(data.emptyMessage ?? '오늘은 식단이 없습니다.'), DATE: data.date.slice(5).replace('/', ' / '),
    WEEKDAY: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(date),
    LUNCH: dishes(data.lunch ?? []), DINNER: dishes(data.dinner ?? []),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

/** JPEG는 Instagram에 전달할 최종 파일입니다. HTML은 로컬 디자인 확인용입니다. */
export async function renderStory(input: StoryRenderData | DailyMenu, outputDir = 'output'): Promise<string> {
  const data: StoryRenderData = 'mode' in input
    ? input
    : { mode: 'tomorrow_full', date: input.date, title: '오늘의 기숙사 식단', lunch: input.lunch, dinner: input.dinner };
  const html = await storyHtml(data);
  await mkdir(outputDir, { recursive: true });
  const stem = resolve(outputDir, `${data.date.replaceAll('/', '-')}-${data.mode}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    // 네트워크/OS 폰트에 의존하지 않도록 저장소의 한글 폰트를 기다립니다.
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (!document.fonts.check('560 50px Meal', '오늘의 기숙사 식단')) throw new Error('한글 폰트 로딩 실패');
      for (const element of document.querySelectorAll<HTMLElement>('.menu')) {
        let size = 50;
        while ((element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) && size > 28) {
          size -= 1;
          element.style.fontSize = `${size}px`;
          element.style.gap = `${Math.max(6, size - 34)}px`;
        }
        if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
          throw new Error('메뉴가 이미지 영역을 초과합니다. 게시 전 레이아웃 조정이 필요합니다.');
        }
      }
    });
    await writeFile(`${stem}.html`, await page.content());
    await page.screenshot({ path: `${stem}.jpg`, type: 'jpeg', quality: 94 });
    return `${stem}.jpg`;
  } finally {
    await browser.close();
  }
}
