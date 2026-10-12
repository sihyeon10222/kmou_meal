import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRenderBrowser } from './render-browser.js';
import sharp from 'sharp';
import { escapeHtml, readTemplate, loadFontCss } from './render-assets.js';
import { layoutWeekly } from './layout-weekly.js';
import { shortDate, weekdayName, type WeeklyData, type WeeklyPage } from './weekly-data.js';
import type { WeeklyImages } from './run-weekly.js';

const dish = (text: string) => {
  const parts = [''];
  // Keep bracketed notes intact; only a top-level + offers an optional break.
  for (const token of text.split(/(\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\})/u)) {
    if (/^(\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\})$/u.test(token)) {
      parts[parts.length - 1] += `<span class="no-break">${escapeHtml(token)}</span>`;
    } else {
      for (const char of token) {
        if (char === '+' && parts.at(-1)) parts.push('');
        parts[parts.length - 1] += escapeHtml(char);
      }
    }
  }
  return parts.map(part => `<span class="menu-part">${part}</span>`).join('<wbr>');
};
const itemsHtml = (items: string[], changed: number[] = []) => items.length ? items.map((item, index) => `<p${changed.includes(index) ? ' class="changed-menu"' : ''}>${dish(item)}</p>`).join('') : '<p class="empty">등록된 식단 없음</p>';
export async function weeklyHtml(data: WeeklyPage, updatedOn?: string, menuChanges?: WeeklyData['menuChanges']): Promise<string> {
  const [css, font, design] = await Promise.all([
    readTemplate('weekly.css'),
    loadFontCss(),
    readTemplate('design.css'),
  ]);
  const panorama = data.kind === 'dormitory' || data.kind === 'badaro';
  const title = { dormitory: '기숙사', badaro: '승선생활관', teacher: '교직원식당', snack: '학식' }[data.kind];
  const days = data.days.map((day, index) => {
    const weekdayIndex = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayIndex];
    return `<article class="day${weekdayIndex === 0 || weekdayIndex === 6 ? ' weekend' : ''}"><div class="day-title"><span class="weekday">${weekday}</span></div>${day.sections.map(section => {
      const changed = updatedOn ? menuChanges?.find(change => change.kind === data.kind && change.date === day.date && change.section === section.key)?.indexes : undefined;
      return `<section class="cell ${escapeHtml(section.key)}" aria-label="${escapeHtml(section.label)}">${index === 0 ? `<h2><span class="meal-label">${escapeHtml(section.label)}</span></h2>` : ''}<div class="menu">${itemsHtml(section.items, changed)}</div></section>`;
    }).join('')}</article>`;
  }).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>${font} ${design}\n${css}</style><body><main class="sheet ${data.kind} ${panorama ? 'panorama' : ''}" style="width:${panorama ? 2160 : 1080}px;--days:${data.days.length};--rows:${data.days[0]!.sections.length}"><div class="meal-surfaces" aria-hidden="true">${data.days[0]!.sections.map(section => `<div class="meal-surface ${escapeHtml(section.key)}"></div>`).join('')}</div><header><div class="heading-row"><h1>${title}</h1><div class="range">${shortDate(data.days[0]!.date)} ~ ${shortDate(data.days.at(-1)!.date)}</div></div>${updatedOn ? `<div class="update-notice">${shortDate(updatedOn)} (${weekdayName(updatedOn)})에 식단표 변경됨</div>` : ''}</header><div class="calendar">${days}</div></main></body></html>`;
}
export async function renderWeekly(data: WeeklyData, outputDir = 'output'): Promise<WeeklyImages> {
  const renderer = createWeeklyRenderer();
  try { return await renderer.render(data, outputDir); }
  finally { await renderer.close(); }
}

/** Share Chromium across feed kinds while keeping page state and failures isolated. */
export function createWeeklyRenderer() {
  const browser = createRenderBrowser('Weekly');
  let closed = false;
  return {
    async render(data: WeeklyData, outputDir = 'output'): Promise<WeeklyImages> {
      if (closed) throw new Error('Weekly 렌더러가 이미 종료되었습니다.');
      const images: string[] = [];
      let master: string | undefined;
      for (const page of data.pages) {
        const rendered = await renderWeeklyPage(browser, page, data.week, outputDir, data.updatedOn, data.menuChanges);
        images.push(...rendered.images);
        master = rendered.master ?? master;
      }
      return { images, ...(master ? { master } : {}) };
    },
    async close() { closed = true; await browser.close(); },
  };
}

async function renderWeeklyPage(browser: ReturnType<typeof createRenderBrowser>, data: WeeklyPage, week: string, outputDir: string, updatedOn?: string, menuChanges?: WeeklyData['menuChanges']): Promise<WeeklyImages> {
  await mkdir(outputDir, { recursive: true });
  const stem = resolve(outputDir, `${week}-${data.kind}-weekly`);
  const panorama = data.kind === 'dormitory' || data.kind === 'badaro';
  const page = await browser.newPage({ viewport: { width: panorama ? 2160 : 1080, height: 1440 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(await weeklyHtml(data, updatedOn, menuChanges), { waitUntil: 'load' });
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    await page.evaluate(layoutWeekly);
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
  } finally { await page.close(); }
}
