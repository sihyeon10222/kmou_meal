import '../src/config.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import sharp from 'sharp';
import { createStoryRenderer } from '../src/render-story.js';
import { artMode, createStoryArt } from '../src/story-art.js';
import { storyDesignData } from '../tests/fixtures/story-design.js';

// Deliberately opt in to paid generation. Rerunning with the default reuses local results only.
const mode = artMode(process.argv[2], 'cache');
const root = resolve('output/story-ai');
await mkdir(root, { recursive: true });
const renderer = createStoryRenderer({ art: createStoryArt({ mode }) });
const cards: string[] = [], preview: { input: Buffer; left: number; top: number }[] = [];
const names = { dormitory: '기숙사', badaro: '승선생활관', teacher: '교직원식당', snack: '학식 (장식 제외)' };
const cases = [
  ...(['dormitory', 'badaro', 'teacher', 'snack'] as const).map(kind => ({ kind, scenario: 'normal' as const, scope: 'full' })),
  { kind: 'teacher' as const, scenario: 'empty' as const, scope: 'full' },
  { kind: 'dormitory' as const, scenario: 'partial' as const, scope: 'full' },
  { kind: 'badaro' as const, scenario: 'normal' as const, scope: 'lunch' },
  { kind: 'dormitory' as const, scenario: 'long' as const, scope: 'full' },
];
try {
  for (const [index, item] of cases.entries()) {
    const data = storyDesignData(item.kind, item.scenario, item.scope);
    if (item.scenario === 'long') {
      // Both meal regions are occupied by long, readable dishes: decoration must be omitted.
      data.sections.forEach(section => { section.items = Array(5).fill('국내산돼지고기김치두루치기와제철채소버섯을곁들인정식'); });
    }
    const file = await renderer.render(data, resolve(root, `${item.scenario}-${item.scope}`));
    const report = JSON.parse(await readFile(file.replace(/\.jpg$/, '.art.json'), 'utf8'));
    const link = `${relative(root, file)}?v=${Date.now()}`;
    cards.push(`<article><h2>${names[item.kind]} · ${item.scenario} · ${item.scope}</h2><p>${report.status} ${report.reason ?? ''}</p><a href="${link}"><img src="${link}"></a></article>`);
    if (index < 3) preview.push({ input: await sharp(file).resize(360, 640).png().toBuffer(), left: index * 384, top: 0 });
  }
} finally { await renderer.close(); }
await sharp({ create: { width: 1128, height: 640, channels: 3, background: '#e4e9f0' } }).composite(preview).png().toFile(resolve(root, 'overview.png'));
await writeFile(resolve(root, 'index.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>해양이 음식 일러스트 미리보기</title><style>body{background:#e4e9f0;color:#183d44;font:16px system-ui;margin:32px}main{max-width:1400px;margin:auto}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}h2{font-size:18px}img{width:100%;height:auto}a{color:inherit}</style><main><h1>해양이 음식 일러스트</h1><p>디자인 검토용 예시 식단입니다. 음식은 Cloudflare FLUX.2 Klein 4B, 해양이는 제공된 원본 PNG입니다. 공간 부족·빈 식단·학식은 기존 스토리를 표시합니다.</p><a href="../weekly-redesign/index.html">주간·스토리 전체 미리보기</a><section>${cards.join('')}</section></main></html>`);
console.log(root);
