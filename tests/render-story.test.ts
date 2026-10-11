import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { load } from 'cheerio';
import { chromium } from 'playwright';
import { createStoryRenderer, storyHtml } from '../src/render-story.js';
import { coopStory, dormitoryStory } from '../src/story-data.js';
import { STORY_MODES, resolveStoryRequest } from '../src/story-modes.js';
import { storyDesignData, storyDesignScenarios } from './fixtures/story-design.js';
import { designKinds } from './fixtures/weekly-design.js';
import { coopMenu, emptyCoop } from './fixtures.js';
import type { CoopDailyMenu } from '../src/fetch-coop-menu.js';

test('메뉴 HTML escape, 공통 헤더, 부분 empty 영역 유지', async () => {
  const data = dormitoryStory(resolveStoryRequest('today_dormitory_full', '2026-09-18'), {
    date: '2026/09/18', breakfast: [], lunch: ['<script>alert(1)</script>', '밥&김치'], dinner: [],
  });
  const html = await storyHtml(data);
  const $ = load(html);
  assert.equal($('script').length, 0);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal($('.dinner .menu').text(), '등록된 식단 없음');
  assert.equal($('h1').text(), '기숙사');
  assert.equal($('.date').text(), '9/18(금)');
  assert.equal($('footer').length, 0);
  assert.equal($('.eyebrow').length, 0);
});

test('메뉴명은 분리하지 않고 추가 메뉴의 더하기 앞에서만 줄바꿈을 허용한다', async () => {
  const request = resolveStoryRequest('today_snack', '2026-09-18');
  const html = await storyHtml(coopStory(request, {
    snackCorner: { western: ['삼겹살구이*상추쌈'], setMeal: [], ramen: [], snack: ['메밀소바+유부초밥/김치'], },
    staffRestaurant: { breakfast: [], lunch: [], dinner: [] }, date: '2026-09-18',
  }));
  assert.equal((html.match(/\.dish:first-child/g) ?? []).length, 0);
  assert.equal((html.match(/<wbr>/g) ?? []).length, 1);
  assert.match(load(html)('.meal.western .dish').html() ?? '', /<span class="dish-part">삼겹살구이\*상추쌈<\/span>/);
  assert.match(load(html)('.meal.snack .dish').html() ?? '', /메밀소바<\/span><wbr><span class="dish-part">\+유부초밥\/김치/);
});

test('26개 모드의 실제 DOM은 요청한 영역만 포함하고 영어 끼니를 유지한다', async () => {
  for (const mode of STORY_MODES) {
    const request = resolveStoryRequest(mode, '2026-09-17');
    const data = (request.restaurant === 'dormitory' || request.restaurant === 'badaro') ? dormitoryStory(request, null) : coopStory(request, coopMenu);
    const $ = load(await storyHtml(data));
    assert.equal($('.meal').length, request.restaurant === 'snack' ? 4 : request.scope !== 'full' ? 1 : 3);
    assert.equal($('.meal.breakfast').length, request.restaurant !== 'snack' && ['full', 'breakfast'].includes(request.scope) ? 1 : 0);
    if (request.restaurant !== 'snack') {
      const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', full: 'Breakfast|Lunch|Dinner' };
      assert.equal($('h2').map((_, el) => $(el).text()).get().join('|'), labels[request.scope]);
    }
    assert.equal($('h1').text(), { dormitory: '기숙사', badaro: '승선생활관', snack: '학식', teacher: '교직원식당' }[request.restaurant]);
  }
});

test('스낵/교직원 전체 및 부분 누락은 영역을 유지한다', async () => {
  for (const mode of ['today_snack', 'today_teacher_full'] as const) {
    const request = resolveStoryRequest(mode, '2026-09-18');
    const $ = load(await storyHtml(coopStory(request, emptyCoop)));
    assert.equal($('.empty').length, mode === 'today_snack' ? 4 : 3);
    const partial = structuredClone(coopMenu);
    partial.snackCorner.snack = [];
    partial.staffRestaurant.breakfast = [];
    const p = load(await storyHtml(coopStory(request, partial)));
    assert.equal(p('.empty').length, 1);
    assert.equal(p(mode === 'today_snack' ? '.meal.snack .menu' : '.breakfast .menu').text(), '등록된 식단 없음');
  }
});

test('10/2 학식의 긴 메뉴명이 두 열을 밀어내지 않고 모든 항목이 안전 영역에 남는다', async () => {
  // School response fetched for 2026-10-02; the old 1fr grid reproduces the logged failure.
  const menu: CoopDailyMenu = JSON.parse(await readFile(new URL('./fixtures/coop-2026-10-02.json', import.meta.url), 'utf8'));
  const data = coopStory(resolveStoryRequest('today_snack', menu.date), menu);
  const directory = await mkdtemp(join(tmpdir(), 'kmou-snack-regression-'));
  const renderer = createStoryRenderer();
  const browser = await chromium.launch({ headless: true });
  try {
    const file = await renderer.render(data, directory);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.setContent(await readFile(file.replace('.jpg', '.html'), 'utf8'));
    const measured = await page.evaluate(async () => {
      await document.fonts.ready;
      const safe = document.querySelector('.sections')!.getBoundingClientRect();
      const sections = [...document.querySelectorAll('.meal')].map(section => {
        const rect = section.getBoundingClientRect();
        const menu = section.querySelector('.menu')!;
        return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width,
          fontSize: parseFloat(getComputedStyle(menu).fontSize),
          text: [...menu.querySelectorAll('.dish')].map(item => item.textContent),
          // Font ascent/descent may extend past a line box without clipping.
          // Check the rendered text against the card's actual safe area.
          fits: menu.scrollWidth <= menu.clientWidth + 1 && [...menu.querySelectorAll('.dish')].every(item => {
            const text = document.createRange(); text.selectNodeContents(item);
            return [...text.getClientRects()].every(line => line.left >= rect.left + 31
              && line.right <= rect.right - 31 && line.top >= rect.top + 31 && line.bottom <= rect.bottom - 31);
          }) };
      });
      return { safe: { left: safe.left, right: safe.right, bottom: safe.bottom }, sections };
    });
    assert.equal(measured.sections.length, 4);
    for (const [index, section] of measured.sections.entries()) {
      assert.deepEqual(section.text, data.sections[index]!.items);
      assert.ok(section.left >= measured.safe.left && section.right <= measured.safe.right);
      assert.ok(section.bottom <= measured.safe.bottom + 1);
      assert.equal(section.width, 492);
      assert.ok(section.fits && section.fontSize >= 28);
    }
  } finally {
    await browser.close();
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('실제 fixture 3종 렌더, 긴 메뉴 축소, 삭제 없이 초과 실패', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-render-'));
  const renderer = createStoryRenderer();
  try {
    for (const mode of ['today_snack', 'today_teacher_full', 'today_dormitory_full', 'today_dormitory_breakfast', 'today_teacher_breakfast', 'today_badaro_full', 'today_badaro_breakfast', 'today_badaro_lunch', 'today_badaro_dinner'] as const) {
      const request = resolveStoryRequest(mode, '2026-09-18');
      const data = (request.restaurant === 'dormitory' || request.restaurant === 'badaro')
        ? dormitoryStory(request, { date: '2026/09/18', breakfast: ['아침 메뉴'], lunch: Array(8).fill('점심 메뉴'), dinner: Array(5).fill('저녁 메뉴') })
        : coopStory(request, coopMenu);
      const file = await renderer.render(data, directory);
      assert.deepEqual([...(await readFile(file)).subarray(0, 2)], [0xff, 0xd8]);
      const html = load(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      assert.equal(html('.dish').length, data.sections.reduce((sum, s) => sum + Math.max(s.items.length, 1), 0));
      assert.ok(html('.dish').toArray().every((node, index) => html(node).text() === data.sections.flatMap(s => s.items.length ? s.items : ['등록된 식단 없음'])[index]));
      const numberFromStyle = (selector: string, property: string) => {
        const match = html(selector).attr('style')?.match(new RegExp(`${property}:\\s*([\\d.]+)px`));
        assert.ok(match, `${selector}의 ${property} 동적 스타일이 필요합니다.`);
        return Number(match[1]);
      };
      if (mode === 'today_snack') {
        assert.equal(html('.meal').length, 4);
        assert.equal(numberFromStyle('.menu:first', 'font-size'), numberFromStyle('.menu:last', 'font-size'));
        assert.equal(numberFromStyle('.sections', '--snack-row-1'), numberFromStyle('.sections', '--snack-row-2'));
      }
      if (mode === 'today_teacher_full') {
        assert.equal(html('.meal').length, 3);
        assert.ok(numberFromStyle('.breakfast', 'height') < numberFromStyle('.lunch', 'height'));
        assert.equal(numberFromStyle('.breakfast .menu', 'font-size'), numberFromStyle('.lunch .menu', 'font-size'));
      }
      if (mode === 'today_dormitory_full') {
        assert.ok(numberFromStyle('.breakfast', 'height') < numberFromStyle('.lunch', 'height'));
        assert.equal(numberFromStyle('.breakfast .menu', 'font-size'), numberFromStyle('.lunch .menu', 'font-size'));
      }
    }
    for (const mode of ['today_snack', 'today_teacher_full'] as const) {
      const empty = coopStory(resolveStoryRequest(mode, '2026-09-18'), emptyCoop);
      const file = await renderer.render(empty, directory);
      const html = load(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      assert.equal(html('.empty').length, mode === 'today_snack' ? 4 : 3);
    }
    const tooLong = coopStory(resolveStoryRequest('today_snack', '2026-09-18'), coopMenu);
    tooLong.sections[0]!.items = Array(70).fill('매우 긴 메뉴');
    const overflowDir = join(directory, 'overflow');
    await assert.rejects(renderer.render(tooLong, overflowDir), /메뉴가 이미지 영역을 초과/);
    const stem = join(overflowDir, '2026-09-18-today_snack');
    await assert.rejects(access(`${stem}.jpg`));
    assert.deepEqual(JSON.parse(await readFile(`${stem}.menu.json`, 'utf8')), tooLong);
    assert.ok((await readFile(`${stem}.failed.png`)).length > 0);
    assert.equal(load(await readFile(`${stem}.failed.html`, 'utf8'))('.meal.western .dish').length, 70);
  } finally {
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('모든 스토리 모드에서 제목과 날짜는 같은 줄의 안전 영역에 배치된다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    for (const mode of STORY_MODES) {
      const request = resolveStoryRequest(mode, '2026-12-30');
      const data = ['dormitory', 'badaro'].includes(request.restaurant) ? dormitoryStory(request, null) : coopStory(request, emptyCoop);
      await page.setContent(await storyHtml(data));
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header')!.getBoundingClientRect();
        const title = document.querySelector('h1')!.getBoundingClientRect();
        const date = document.querySelector('.date')!.getBoundingClientRect();
        return { left: header.left, right: header.right, top: header.top, bottom: header.bottom,
          titleTop: title.top, dateTop: date.top, titleRight: title.right, dateLeft: date.left,
          titleSize: getComputedStyle(document.querySelector('h1')!).fontSize,
          dateSize: getComputedStyle(document.querySelector('.date')!).fontSize,
          menuTop: document.querySelector('.sections')!.getBoundingClientRect().top };
      });
      assert.equal(layout.left, 64);
      assert.equal(layout.right, 1016);
      assert.equal(layout.top, 164);
      assert.equal(layout.titleSize, '72px');
      assert.equal(layout.dateSize, '72px');
      assert.ok(Math.abs(layout.titleTop - layout.dateTop) < 1);
      assert.ok(Math.abs(layout.dateLeft - layout.titleRight - 64) <= 1);
      assert.ok(layout.bottom < layout.menuTop);
    }
  } finally { await browser.close(); }
});

test('네 식당은 메뉴를 읽기 쉬운 크기로 제한하고 모든 항목을 유지한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-story-spacing-'));
  const renderer = createStoryRenderer();
  try {
    const dailyMenu = {
      date: '2026/10/10',
      breakfast: ['우유or두유/시리얼', '셀프토스트&버터/딸기잼', '찐계란', '맛살샐러드', '포도'],
      lunch: ['얼큰쇠고기버섯찌개', '케이준샐러드', '모듬묵&양념장', '오이부추무침', '밥/석박지'],
      dinner: ['건새우아욱국', '매콤돼지갈비찜', '마카로니샐러드', '건파래무침', '밥/김치'],
    };
    for (const mode of ['today_dormitory_full', 'today_badaro_full', 'today_teacher_full', 'today_snack'] as const) {
      const request = resolveStoryRequest(mode, '2026-10-10');
      const data = request.restaurant === 'snack' ? coopStory(request, coopMenu)
        : request.restaurant === 'teacher' ? coopStory(request, { ...coopMenu, staffRestaurant: dailyMenu })
        : dormitoryStory(request, dailyMenu);
      const file = await renderer.render(data, directory);
      const html = load(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      for (const menu of html('.menu').toArray()) {
        const style = html(menu).attr('style')!;
        // The cafeteria may shrink further to keep long names on one line.
        assert.ok(Number(/font-size:\s*(\d+)px/.exec(style)![1]) >= (request.restaurant === 'snack' ? 28 : 44));
        assert.equal(Number(/gap:\s*(\d+)px/.exec(style)![1]), Math.max(8, Math.round(Number(/font-size:\s*(\d+)px/.exec(style)![1]) * .16)));
      }
      assert.equal(html('.dish').length, data.sections.reduce((sum, section) => sum + section.items.length, 0));
    }
  } finally {
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('라벨 간격을 확보한 학식은 16개 항목이 한 박스를 넘으면 내용을 자르지 않고 게시 전 실패한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-story-dense-overflow-'));
  const renderer = createStoryRenderer();
  try {
    const data = storyDesignData('snack', 'dense');
    data.sections[1]!.items = Array.from({ length: 16 }, (_, index) => ['백미밥', '돼지불고기', '미역국', '배추김치'][index % 4]!);
    await assert.rejects(renderer.render(data, directory), /메뉴가 이미지 영역을 초과/);
    const stem = join(directory, '2026-10-05-today_snack');
    await assert.rejects(access(`${stem}.jpg`));
    const html = load(await readFile(`${stem}.failed.html`, 'utf8'));
    assert.equal(html('.meal.set-meal .dish').length, 16);
  } finally { await renderer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('공통 카드 디자인의 실제 글자 여백·안전영역·분량 배분을 네 식당과 모든 모드에서 검증한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-uniform-spacing-'));
  const renderer = createStoryRenderer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const cases = designKinds.flatMap(kind => storyDesignScenarios.map(scenario => storyDesignData(kind, scenario)));
    cases.push(...STORY_MODES.map(mode => {
      const request = resolveStoryRequest(mode, '2026-12-30');
      return ['dormitory', 'badaro'].includes(request.restaurant) ? dormitoryStory(request, null) : coopStory(request, emptyCoop);
    }));
    for (const data of cases) {
      const file = await renderer.render(data, directory);
      await page.setContent(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
      const layout = await page.evaluate(async () => {
        await document.fonts.ready;
        const canvas = document.createElement('canvas').getContext('2d')!;
        const ink = (element: Element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const style = getComputedStyle(node.parentElement!);
            canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            let offset = 0;
            for (const char of node.textContent ?? '') {
              if (char.trim()) {
                range.setStart(node, offset); range.setEnd(node, offset + char.length);
                const metrics = canvas.measureText(char);
                const baseline = range.getBoundingClientRect().top + metrics.fontBoundingBoxAscent;
                top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
                bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
                const rect = range.getBoundingClientRect();
                left = Math.min(left, rect.left - metrics.actualBoundingBoxLeft);
                right = Math.max(right, rect.left + metrics.actualBoundingBoxRight);
              }
              offset += char.length;
            }
          }
          return { top, bottom, left, right };
        };
        const rect = (element: Element) => {
          const r = element.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
        };
        const header = document.querySelector('header')!;
        const headerInk = [...header.children].map(ink);
        const meals = [...document.querySelectorAll('.meal')].map(meal => {
          const menu = meal.querySelector('.menu')!;
          const label = meal.querySelector('h2')!;
          const style = getComputedStyle(menu);
          return { box: rect(meal), content: ink(menu), label: rect(label), labelInk: ink(label),
            menu: rect(menu), font: style.fontSize, gap: style.gap, line: style.lineHeight,
            textColor: style.color, spacing: style.letterSpacing,
            emptyFonts: [...menu.querySelectorAll('.empty')].map(node => parseFloat(getComputedStyle(node).fontSize)),
            labelFont: getComputedStyle(label).fontSize,
            labelBlur: getComputedStyle(label).backdropFilter, labelShadow: getComputedStyle(label).boxShadow,
            labelColor: getComputedStyle(label).backgroundColor,
            color: getComputedStyle(meal).backgroundColor, blur: getComputedStyle(meal).backdropFilter, shadow: getComputedStyle(meal).boxShadow, radius: getComputedStyle(meal).borderRadius,
            fits: menu.scrollWidth <= menu.clientWidth + 1,
            text: [...menu.querySelectorAll('.dish')].map(dish => dish.textContent),
            noWrappedNames: [...menu.querySelectorAll('.dish-part, .empty')].every(part => {
              const range = document.createRange(); range.selectNodeContents(part);
              return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size === 1;
            }) };
        });
        return { root: rect(document.querySelector('.sections')!), header: rect(header), meals,
          titleInk: ink(header.querySelector('h1')!), dateInk: ink(header.querySelector('.date')!),
          headerTop: Math.min(...headerInk.map(bounds => bounds.top)), headerBottom: Math.max(...headerInk.map(bounds => bounds.bottom)),
          oldDecorations: document.querySelectorAll('.night, .symbol, footer').length };
      });
      const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) <= 1, `${data.request.mode} ${label}: ${actual} vs ${expected}`);
      const columns = data.request.restaurant === 'snack' ? 2 : 1;
      const rows = layout.meals.filter((_, index) => index % columns === 0);
      close(layout.root.left, 32, 'outer left'); close(1080 - layout.root.right, 32, 'outer right');
      close(1920 - layout.root.bottom, 32, 'outer bottom');
      close(layout.header.top, 164, 'header container safe top');
      close(layout.titleInk.left, 64, 'visible title left');
      close(layout.dateInk.left - layout.titleInk.right, layout.titleInk.left, 'visible name/date gap matches left margin');
      assert.ok(layout.headerTop >= 187);
      close(layout.meals[0]!.labelInk.top - layout.headerBottom, 32, 'header/label ink gap');
      assert.equal(layout.oldDecorations, 0);
      for (const [index, meal] of layout.meals.entries()) {
        const row = rows[Math.floor(index / columns)]!;
        close(meal.box.top, row.box.top, 'row top'); close(meal.box.height, row.box.height, 'row height');
        close(meal.content.top - meal.box.top, meal.box.bottom - meal.content.bottom, 'visible menu vertically centered');
        assert.ok(meal.content.top - meal.box.top >= 31);
        close(meal.menu.left - meal.box.left, 32, 'menu left padding');
        close(meal.box.right - meal.menu.right, 32, 'menu right padding');
        close((meal.label.top + meal.label.bottom) / 2, meal.box.top, 'label on card boundary');
        assert.equal(meal.labelFont, '36px');
        close(meal.label.height, 48, 'larger story pill height');
        assert.ok(meal.box.bottom - meal.content.bottom >= 31);
        assert.ok(meal.content.bottom <= 1920 - 64 + 1);
        assert.ok(meal.content.top - meal.label.bottom >= 39 && meal.fits && meal.noWrappedNames);
        assert.equal(meal.radius, '32px');
        assert.equal(meal.blur, 'none'); assert.equal(meal.shadow, 'none');
        assert.match(meal.labelBlur, /blur\(3px\)/); assert.notEqual(meal.labelShadow, 'none');
        assert.equal(meal.labelColor, 'rgba(255, 255, 255, 0.22)');
        assert.ok(parseFloat(meal.font) <= (data.sections.every(section => !section.items.length) ? 36 : 48));
        meal.emptyFonts.forEach(size => assert.ok(size <= 36));
        close(parseFloat(meal.line), parseFloat(meal.font) * 1.25, 'menu line height');
        assert.equal(meal.spacing, 'normal');
        assert.equal(meal.font, layout.meals[0]!.font); assert.equal(meal.gap, layout.meals[0]!.gap); assert.equal(meal.line, layout.meals[0]!.line);
        const section = data.sections[index]!;
        assert.deepEqual(meal.text, section.items.length ? section.items : ['등록된 식단 없음']);
        assert.equal(meal.color, section.key === 'breakfast' ? 'rgb(255, 255, 255)' : section.key === 'dinner' ? 'rgb(34, 89, 177)' : 'rgb(218, 233, 255)');
        assert.equal(meal.textColor, section.key === 'dinner' ? 'rgb(255, 255, 255)' : 'rgb(24, 61, 68)');
      }
      rows.slice(1).forEach((row, index) => close(row.box.top - rows[index]!.box.bottom, 32, 'card gap'));
      if (columns === 2) close(layout.meals[1]!.box.left - layout.meals[0]!.box.right, 32, 'column gap matches row gap');
      if (columns === 2 || data.sections.every(section => !section.items.length)) rows.forEach(row => close(row.box.height, rows[0]!.box.height, 'cafeteria and empty rows have equal heights'));
      else {
        const contentHeights = rows.map((_, index) => Math.max(...layout.meals.slice(index * columns, (index + 1) * columns).map(meal => meal.content.bottom - meal.content.top)));
        const ratios = rows.map((row, index) => (row.box.height - 128) / contentHeights[index]!);
        ratios.forEach(ratio => assert.ok(Math.abs(ratio - ratios[0]!) < .01));
      }
    }
  } finally { await renderer.close(); await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
