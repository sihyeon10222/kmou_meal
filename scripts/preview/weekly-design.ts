import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import sharp from 'sharp';
import { load } from 'cheerio';
import { createStoryRenderer } from '../../src/backend/rendering/story-renderer.js';
import { createStoryArt } from '../../src/backend/rendering/art/decorate.js';
import { storyDesignData, storyDesignScenarios } from '../../fixtures/design/story-design.js';
import { createWeeklyRenderer } from '../../src/backend/rendering/weekly-renderer.js';
import { designKinds, designScenarios, weeklyDesignData } from '../../fixtures/design/weekly-design.js';

const root = resolve('output/weekly-redesign');
const scenarios = designScenarios;
const names = { dormitory: '기숙사', badaro: '승선생활관', snack: '학식', teacher: '교직원식당' };
const labels = { normal: '일반 식단', empty: '빈 식단', repost: '재게시', partial: '일부 빈 식단', dense: '분량 편차', long: '긴 메뉴·추가 구성', 'one-long-day': '한 요일만 긴 메뉴', 'two-size': '일반·작은 글자 두 단계', 'near-size': '1~2px 차이는 한 크기로 통일' };
const sections: string[] = [];
const revision = Date.now();
await mkdir(root, { recursive: true });
const weeklyRenderer = createWeeklyRenderer();
try {
  for (const scenario of scenarios) {
    const cards: string[] = [];
    const previews: { input: Buffer; left: number; top: number }[] = [];
    const captions: string[] = [];
    for (const [index, kind] of designKinds.entries()) {
      const data = weeklyDesignData(kind, scenario);
      const result = await weeklyRenderer.render(data, resolve(root, scenario));
      const main = result.master ?? result.images[0]!;
      const path = (file: string) => `${relative(root, file)}?v=${revision}`;
      const panorama = Boolean(result.master);
      const $ = load(await readFile(resolve(root, scenario, `${data.week}-${kind}-weekly.html`), 'utf8'));
      const fontRows = data.pages[0]!.days[0]!.sections.map((section, row) => {
        const sizes = $('.day').map((_, day) => {
          const cell = $(day).find('.cell').eq(row);
          const size = cell.find('.menu').attr('style')?.match(/font-size:\s*(\d+)px/)?.[1];
          return `${$(day).find('.weekday').text()} ${cell.attr('data-font-mode') === 'empty' ? '빈 식단' : `${size}px`}`;
        }).get();
        return `${section.label}: ${sizes.join(' · ')}`;
      });
      const thumbnail = await sharp(main).resize(panorama ? 1080 : 528, panorama ? 720 : 704).png().toBuffer();
      previews.push({ input: thumbnail, left: index < 2 ? 24 : 24 + (index - 2) * 552, top: index < 2 ? 24 + index * 744 : 1512 });
      cards.push(`<article><h3>${names[kind]}</h3><a href="${path(main)}"><img src="${path(main)}" alt="${names[kind]} ${labels[scenario]} ${panorama ? '전체 원본' : ''}"></a><details><summary>요일별 적용된 글자 크기</summary><pre>${fontRows.join('\n')}</pre></details>${panorama ? `<div class="halves">${result.images.map((file, i) => `<a href="${path(file)}"><span>${i + 1}번 이미지</span><img src="${path(file)}" alt="${names[kind]} ${i + 1}번 분할 이미지"></a>`).join('')}</div>` : ''}<details><summary>본문</summary><pre>${data.caption}</pre></details></article>`);
      captions.push(`[${names[kind]}]\n${data.caption}`);
    }
    await sharp({ create: { width: 1128, height: 2240, channels: 3, background: '#dfe5ee' } }).composite(previews).png().toFile(resolve(root, `${scenario}-overview.png`));
    await writeFile(resolve(root, scenario, 'captions.txt'), captions.join('\n\n\n'));
    sections.push(`<section id="${scenario}"><h2>${labels[scenario]}</h2>${cards.join('')}</section>`);
  }
} finally { await weeklyRenderer.close(); }
const storySections: string[] = [];
// Design iterations only reuse illustrations; they never silently spend generation credits.
const renderer = createStoryRenderer({ art: createStoryArt({ mode: 'cache' }) });
const storyLabels = { normal: '일반 식단', empty: '빈 식단', partial: '일부 빈 식단', dense: '분량 편차', long: '긴 메뉴·추가 구성' };
try {
  for (const scenario of storyDesignScenarios) {
    const cards: string[] = [];
    const previews: { input: Buffer; left: number; top: number }[] = [];
    for (const [index, kind] of designKinds.entries()) {
      const file = await renderer.render(storyDesignData(kind, scenario), resolve(root, 'story', scenario));
      const path = `${relative(root, file)}?v=${revision}`;
      cards.push(`<article><h3>${names[kind]}</h3><a href="${path}"><img src="${path}" alt="${names[kind]} ${storyLabels[scenario]} 스토리"></a></article>`);
      previews.push({ input: await sharp(file).resize(540, 960).png().toBuffer(), left: 24 + (index % 2) * 564, top: 24 + Math.floor(index / 2) * 1008 });
    }
    await sharp({ create: { width: 1152, height: 2016, channels: 3, background: '#dfe5ee' } }).composite(previews).png().toFile(resolve(root, `story-${scenario}-overview.png`));
    storySections.push(`<section id="story-${scenario}"><h2>스토리 · ${storyLabels[scenario]}</h2><div class="story-grid">${cards.join('')}</div></section>`);
  }
  const singleCards: string[] = [];
  for (const kind of ['dormitory', 'badaro', 'teacher'] as const) for (const scope of ['breakfast', 'lunch', 'dinner']) {
    const file = await renderer.render(storyDesignData(kind, 'normal', scope), resolve(root, 'story', 'single'));
    const path = `${relative(root, file)}?v=${revision}`;
    singleCards.push(`<article><h3>${names[kind]} · ${scope}</h3><a href="${path}"><img src="${path}" alt="${names[kind]} ${scope} 스토리"></a></article>`);
  }
  storySections.push(`<section id="story-single"><h2>스토리 · 개별 끼니</h2><div class="story-grid">${singleCards.join('')}</div></section>`);
} finally { await renderer.close(); }
await writeFile(resolve(root, 'index.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>게시물·스토리 디자인 미리보기</title><style>
*{box-sizing:border-box}body{margin:0;background:#dfe5ee;color:#183d44;font-family:system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px}h1{font-size:28px}nav{display:flex;flex-wrap:wrap;gap:16px;margin:28px 0}a{color:inherit}section{margin:64px 0}article{margin:32px 0 64px}img{display:block;width:100%;height:auto}.halves,.story-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}.halves span{display:block;margin-bottom:12px}details{margin-top:16px}pre{white-space:pre-wrap;line-height:1.7;padding:20px;background:#fff}p{line-height:1.6}.story-grid article{margin:0 0 24px}@media(max-width:600px){main{padding:16px}.story-grid{grid-template-columns:1fr}}
</style><main><h1>게시물·스토리 디자인 미리보기</h1><p>디자인 검토용 예시 식단입니다. 파노라마는 전체 원본 아래에 실제로 나눈 두 장을 표시합니다. 이미지를 누르면 원본 크기로 볼 수 있습니다.</p><nav><a href="../story-ai/index.html">해양이 음식 일러스트 비교</a>${scenarios.map(scenario => `<a href="#${scenario}">주간 · ${labels[scenario]}</a>`).join('')}${storyDesignScenarios.map(scenario => `<a href="#story-${scenario}">스토리 · ${storyLabels[scenario]}</a>`).join('')}<a href="#story-single">스토리 · 개별 끼니</a></nav>${sections.join('')}${storySections.join('')}</main></html>`);
console.log(root);

await import("./weekly-updates.js");
