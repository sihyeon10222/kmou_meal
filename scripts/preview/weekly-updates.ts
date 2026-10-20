import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import sharp from 'sharp';
import { createWeeklyRenderer } from '../../src/backend/rendering/weekly-renderer.js';
import { prepareWeekly } from '../../src/backend/features/weekly/snapshot.js';
import { weeklyRange } from '../../src/shared/dates.js';
import { weeklyDesignData } from '../../fixtures/design/weekly-design.js';

const root = resolve('output/weekly-redesign');
const renderer = createWeeklyRenderer();
const cards: string[] = [];
const headers: { input: Buffer; left: number; top: number }[] = [];
const range = weeklyRange('2026-10-14');
await mkdir(root, { recursive: true });
try {
  const configurations: { id: string; label: string; kinds: ('snack' | 'teacher' | 'dormitory' | 'badaro')[]; changed: string[]; replacement: boolean; source: boolean }[] = [];
  const groups = [
    { id: 'combined', label: '학식·교직원식당', kinds: ['snack', 'teacher'] as const },
    { id: 'snack-only', label: '학식만 포함', kinds: ['snack'] as const },
    { id: 'teacher-only', label: '교직원식당만 포함', kinds: ['teacher'] as const },
    { id: 'dormitory', label: '기숙사', kinds: ['dormitory'] as const },
    { id: 'badaro', label: '승선생활관', kinds: ['badaro'] as const },
  ];
  for (const group of groups) {
    const base = { kinds: [...group.kinds] };
    configurations.push({ ...base, id: `${group.id}-initial`, label: `${group.label} · 최초 게시`, changed: [], replacement: false, source: false });
    const changes: ('snack' | 'teacher' | 'dormitory' | 'badaro')[][] = group.id === 'combined' ? [['snack'], ['teacher'], ['snack', 'teacher']] : [[...group.kinds]];
    for (const changed of changes) configurations.push({ ...base, id: `${group.id}-${changed.join('-')}`, label: `${group.label} · ${changed.map(kind => ({ snack: '학식', teacher: '교직원식당', dormitory: '기숙사', badaro: '승선생활관' })[kind]).join('·')} 업데이트`, changed, replacement: true, source: true });
    configurations.push({ ...base, id: `${group.id}-force`, label: `${group.label} · 변경 없는 강제 재게시`, changed: [], replacement: true, source: true });
    configurations.push({ ...base, id: `${group.id}-legacy`, label: `${group.label} · 비교 원본 없는 강제 재게시`, changed: [], replacement: true, source: false });
  }
  const allHeaders: { input: Buffer; left: number; top: number }[] = [];
  for (const [caseIndex, scenario] of configurations.entries()) {
    const data = weeklyDesignData(scenario.kinds[0]!);
    Object.assign(data, { week: range.week, monday: range.monday });
    data.pages = scenario.kinds.map(kind => weeklyDesignData(kind).pages[0]!);
    data.pages.forEach(page => page.days.forEach((day, index) => { day.date = range.dates[index]!; }));
    const previous = structuredClone(data.pages);
    previous.forEach(page => {
      if (scenario.changed.includes(page.kind)) page.days.at(-1)!.sections[0]!.items = [];
    });
    const prepared = prepareWeekly(data, scenario.source ? previous : undefined, '2026-10-14', scenario.replacement)!;
    const result = await renderer.render(prepared, resolve(root, 'update-notices', scenario.id));
    const files = result.master ? [result.master, ...result.images] : result.images;
    const label = scenario.label;
    cards.push(`<article id="${scenario.id}"><h3>${caseIndex + 1}. ${label}</h3>${files.map(file => `<a href="${relative(root, file)}?v=${Date.now()}"><img src="${relative(root, file)}?v=${Date.now()}" alt="${label}"></a>`).join('')}</article>`);
    const main = result.master ?? result.images[0]!;
    allHeaders.push({ input: await sharp(main).extract({ left: 0, top: 0, width: 1080, height: 260 }).png().toBuffer(), left: (caseIndex % 2) * 1080, top: Math.floor(caseIndex / 2) * 260 });
    if (scenario.id === 'combined-teacher') for (const [index, file] of result.images.entries()) {
      headers.push({ input: await sharp(file).extract({ left: 0, top: 0, width: 1080, height: 300 }).png().toBuffer(), left: 0, top: index * 300 });
    }
  }
  await sharp({ create: { width: 2160, height: Math.ceil(configurations.length / 2) * 260, channels: 3, background: '#F6F8FB' } }).composite(allHeaders).png().toFile(resolve(root, 'update-notices-all.png'));
} finally { await renderer.close(); }
await sharp({ create: { width: 1080, height: 600, channels: 3, background: '#F6F8FB' } }).composite(headers).png().toFile(resolve(root, 'update-notices-overview.png'));
const page = resolve(root, 'index.html');
let html: string;
try { html = await readFile(page, 'utf8'); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>주간 게시물 미리보기</title><style>body{background:#e4e9f0;color:#183d44;font:16px system-ui;margin:32px}main{max-width:1200px;margin:auto}article{margin:48px 0}img{display:block;width:100%;margin:20px 0}a{color:inherit}</style><main><h1>주간 게시물 미리보기</h1><p>디자인 확인용 예시 식단입니다.</p></main></html>';
}
html = html.replace(/<section id="update-notices">[\s\S]*?<\/section>/, '');
html = html.replace('</main>', `<section id="update-notices"><h2>재게시 날짜·업데이트 식당 안내</h2>${cards.join('')}</section></main>`);
await writeFile(page, html);
console.log(`${page}#update-notices`);
