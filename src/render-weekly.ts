import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { escapeHtml, readTemplate, loadFont } from './render-assets.js';
import type { WeeklyData } from './weekly-data.js';
import type { WeeklyImages } from './run-weekly.js';

const dish = (text: string) => Array.from(text, char => `${/[\p{P}\p{S}]/u.test(char) ? '<wbr>' : ''}${escapeHtml(char)}`).join('');
const itemsHtml = (items: string[]) => items.length ? items.map(item => `<p>${dish(item)}</p>`).join('') : '<p class="empty">메뉴 없음</p>';
export async function weeklyHtml(data: WeeklyData): Promise<string> {
  const [css, font] = await Promise.all([
    readTemplate('weekly.css'),
    loadFont(),
  ]);
  const panorama = data.kind === 'dormitory';
  const title = { dormitory: '기숙사 식단', teacher: '교직원 식당 식단', snack: '학식 식단' }[data.kind];
  const days = data.days.map((day, index) => {
    const date = `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`;
    const label = `${['월', '화', '수', '목', '금', '토', '일'][index]} ${date}`;
    return `<article class="day"><div class="day-title">${label}</div>${day.sections.map(section => {
      return `<section class="cell ${section.key}"><h2>${section.label}</h2><div class="menu">${itemsHtml(section.items)}</div></section>`;
    }).join('')}</article>`;
  }).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>@font-face{font-family:Meal;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900;} ${css}</style><body><main class="sheet ${panorama ? 'panorama' : ''}" style="width:${panorama ? 2160 : 1080}px;--days:${data.days.length};--rows:${data.kind === 'snack' ? 2 : 3}"><header><div class="eyebrow">KMOU WEEKLY MENU</div><h1>${title}</h1><div class="range">${escapeHtml(data.days[0]!.date)} — ${escapeHtml(data.days.at(-1)!.date)}</div></header><div class="calendar">${days}</div><footer><span>@kmou_meal</span></footer></main></body></html>`;
}
export async function renderWeekly(data: WeeklyData, outputDir = 'output'): Promise<WeeklyImages> {
  await mkdir(outputDir, { recursive: true });
  const stem = resolve(outputDir, `${data.week}-${data.kind}-weekly`);
  const panorama = data.kind === 'dormitory';
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: panorama ? 2160 : 1080, height: 1440 }, deviceScaleFactor: 1 });
    await page.setContent(await weeklyHtml(data), { waitUntil: 'load' });
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (!document.fonts.check('450 24px Meal', '식단')) throw new Error('주간 한글 폰트 로딩 실패');
      const calendar = document.querySelector<HTMLElement>('.calendar')!;
      const days = [...document.querySelectorAll<HTMLElement>('.day')];
      const rowCount = days[0]!.querySelectorAll('.cell').length;
      const measure = (cell: HTMLElement, fontSize: number) => {
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.style.cssText = `position:fixed;visibility:hidden;left:0;top:0;width:${cell.getBoundingClientRect().width}px;height:auto;`;
        clone.querySelectorAll<HTMLElement>('.menu').forEach(menu => { menu.style.fontSize = `${fontSize}px`; });
        cell.parentElement!.append(clone);
        const height = clone.getBoundingClientRect().height;
        clone.remove();
        return height;
      };
      const minimums: number[] = [];
      const maximums: number[] = [];
      for (let row = 0; row < rowCount; row++) {
        const cells = days.map(day => day.querySelectorAll<HTMLElement>('.cell')[row]!);
        minimums.push(Math.max(...cells.map(cell => measure(cell, 18))));
        maximums.push(Math.max(...cells.map(cell => measure(cell, 32))));
      }
      const remaining = calendar.clientHeight - 70 - minimums.reduce((sum, value) => sum + value, 0);
      if (remaining < 0) throw new Error('주간 메뉴가 최소 글자 크기에서도 영역을 초과합니다.');
      const weights = maximums.map((height, index) => Math.max(1, height - minimums[index]!));
      const totalWeight = weights.reduce((sum, value) => sum + value, 0);
      const rows = minimums.map((height, index) => `${height + remaining * weights[index]! / totalWeight}px`).join(' ');
      days.forEach(day => { day.style.gridTemplateRows = `70px ${rows}`; });
      for (const cell of document.querySelectorAll<HTMLElement>('.cell')) {
        const menus = [...cell.querySelectorAll<HTMLElement>('.menu')];
        const fits = () => menus.every(menu => {
          const rect = menu.getBoundingClientRect();
          return rect.bottom <= cell.getBoundingClientRect().bottom - 12 && menu.scrollWidth <= menu.clientWidth + 1;
        });
        let size = 32;
        for (; size >= 18; size--) {
          menus.forEach(menu => { menu.style.fontSize = `${size}px`; });
          if (fits()) break;
        }
        if (!fits()) throw new Error('주간 메뉴가 최소 글자 크기에서도 영역을 초과합니다.');
        const box = cell.getBoundingClientRect();
        const footer = document.querySelector('footer')!.getBoundingClientRect();
        const day = cell.closest('.day')!.getBoundingClientRect();
        if (box.bottom > footer.top || box.left < day.left || box.right > day.right + 1) {
          throw new Error('주간 메뉴 영역이 날짜 칸 또는 푸터를 침범합니다.');
        }
      }
    });
    await writeFile(`${stem}.html`, await page.content());
    await writeFile(`${stem}.menu.json`, JSON.stringify(data, null, 2));
    // Render the complete design before cropping. The center may cut through
    // Thursday's text intentionally; no layout element adapts to the crop line.
    const bytes = await page.screenshot({ type: 'png' });
    if (!panorama) {
      const image = `${stem}.jpg`;
      await sharp(bytes).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(image);
      return { images: [image] };
    }
    const master = `${stem}-master.png`;
    await writeFile(master, bytes);
    const images: string[] = [];
    for (let index = 0; index < 2; index++) {
      const image = `${stem}-${index + 1}.jpg`;
      await sharp(bytes).extract({ left: index * 1080, top: 0, width: 1080, height: 1440 }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(image);
      images.push(image);
    }
    return { images, master };
  } finally { await browser.close(); }
}
