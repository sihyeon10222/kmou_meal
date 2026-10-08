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

test('메뉴 항목은 제목처럼 임의로 굵어지지 않고 조합 기호 앞에서 줄바꿈할 수 있다', async () => {
  const request = resolveStoryRequest('today_snack', '2026-09-18');
  const html = await storyHtml(coopStory(request, {
    snackCorner: { western: ['삼겹살구이*상추쌈'], setMeal: [], ramen: [], snack: ['메밀소바+유부초밥/김치'], },
    staffRestaurant: { breakfast: [], lunch: [], dinner: [] }, date: '2026-09-18',
  }));
  assert.equal((html.match(/\.dish:first-child/g) ?? []).length, 0);
  assert.equal((html.match(/<wbr>/g) ?? []).length, 3);
  assert.match(load(html)('.meal.western .dish').html() ?? '', /삼겹살구이<wbr>\*상추쌈/);
  assert.match(load(html)('.meal.snack .dish').html() ?? '', /메밀소바<wbr>\+유부초밥<wbr>\/김치/);
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
          fits: menu.scrollWidth <= menu.clientWidth + 1 && menu.scrollHeight <= menu.clientHeight + 1 };
      });
      return { safe: { left: safe.left, right: safe.right, bottom: safe.bottom }, sections };
    });
    assert.equal(measured.sections.length, 4);
    for (const [index, section] of measured.sections.entries()) {
      assert.deepEqual(section.text, data.sections[index]!.items);
      assert.ok(section.left >= measured.safe.left && section.right <= measured.safe.right);
      assert.ok(section.bottom <= measured.safe.bottom + 1);
      assert.equal(section.width, 458);
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
        assert.notEqual(numberFromStyle('.sections', '--snack-row-1'), numberFromStyle('.sections', '--snack-row-2'));
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
      assert.equal(layout.left, 58);
      assert.equal(layout.right, 1022);
      assert.equal(layout.top, 164);
      assert.equal(layout.titleSize, '72px');
      assert.equal(layout.dateSize, '72px');
      assert.ok(Math.abs(layout.titleTop - layout.dateTop) < 1);
      assert.ok(Math.abs(layout.dateLeft - layout.titleRight - 24) <= 1);
      assert.ok(layout.bottom < layout.menuTop);
    }
  } finally { await browser.close(); }
});

test('하루 세 끼 각 다섯 항목은 넓어진 영역에서 큰 글자와 항목 간격을 사용한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-story-spacing-'));
  const renderer = createStoryRenderer();
  try {
    const data = dormitoryStory(resolveStoryRequest('today_dormitory_full', '2026-10-05'), {
      date: '2026/10/05',
      breakfast: ['우유or두유/시리얼', '셀프토스트&버터/딸기잼', '계란후라이', '맛살샐러드', '사과'],
      lunch: ['짜장밥', '대파계란국', '칠리탕수육', '양배추샐러드&케요네즈', '밥/김치'],
      dinner: ['시락국', '닭갈비', '감자채햄볶음', '청경채생채', '밥/김치'],
    });
    const file = await renderer.render(data, directory);
    const html = load(await readFile(file.replace('.jpg', '.html'), 'utf8'));
    for (const menu of html('.menu').toArray()) {
      const style = html(menu).attr('style')!;
      assert.ok(Number(/font-size:\s*(\d+)px/.exec(style)![1]) >= 44);
      assert.equal(Number(/gap:\s*(\d+)px/.exec(style)![1]), Math.max(10, Math.round(Number(/font-size:\s*(\d+)px/.exec(style)![1]) * .22)));
    }
    assert.equal(html('.dish').length, 15);
  } finally {
    await renderer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('내용 높이에 따른 균등 여백과 공통 글자 크기 및 배경 중앙 경계', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-uniform-spacing-'));
  const renderer = createStoryRenderer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    for (const mode of ['today_dormitory_full', 'today_badaro_full', 'today_teacher_full', 'today_snack', 'today_teacher_lunch'] as const) {
      const request = resolveStoryRequest(mode, '2026-10-05');
      const data = ['dormitory', 'badaro'].includes(request.restaurant)
        ? dormitoryStory(request, { date: '2026/10/05', breakfast: ['우유', '빵'], lunch: Array(7).fill('점심 메뉴'), dinner: Array(4).fill('저녁 메뉴') })
        : coopStory(request, mode === 'today_teacher_lunch' ? emptyCoop : coopMenu);
      const file = await renderer.render(data, directory);
      await page.setContent(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
      const layout = await page.evaluate(async () => {
        await document.fonts.ready;
        const header = document.querySelector('header')!.getBoundingClientRect();
        const root = document.querySelector('.sections')!.getBoundingClientRect();
        const meals = [...document.querySelectorAll('.meal')];
        const boxes = meals.map(meal => meal.getBoundingClientRect());
        const snack = document.querySelector('.story')!.classList.contains('snack');
        const rows = snack ? [boxes.slice(0, 2), boxes.slice(2)] : boxes.map(box => [box]);
        const gaps = [Math.min(...rows[0]!.map(box => box.top)) - header.bottom];
        for (let index = 1; index < rows.length; index++) gaps.push(Math.min(...rows[index]!.map(box => box.top)) - Math.max(...rows[index - 1]!.map(box => box.bottom)));
        const bottomGap = 1920 - Math.max(...rows.at(-1)!.map(box => box.bottom));
        if (snack) {
          if (Math.abs(bottomGap - 58 - gaps[0]!) > 1) throw new Error(`학식 중앙 정렬: ${bottomGap}, ${gaps[0]}`);
          if (Math.abs(gaps[1]! - 48) > 1) throw new Error(`학식 행 간격: ${gaps[1]}`);
        } else if (Math.abs(bottomGap - 58) > 1) throw new Error(`하단 여백: ${bottomGap}`);
        const typography = meals.map(meal => {
          const menu = meal.querySelector('.menu')!;
          const heading = meal.querySelector('.meal-heading')!;
          const style = getComputedStyle(menu);
          return { font: style.fontSize, gap: style.gap, line: style.lineHeight, padding: style.paddingTop,
            headingGap: getComputedStyle(heading).gap, fits: menu.scrollWidth <= menu.clientWidth + 1 && menu.scrollHeight <= menu.clientHeight + 1 };
        });
        const story = document.querySelector<HTMLElement>('.story')!;
        const morning = parseFloat(story.style.getPropertyValue('--morning-end'));
        const night = parseFloat(story.style.getPropertyValue('--night-start'));
        return { left: root.left, right: root.right, gaps, typography, snack,
          firstRowAligned: !snack || Math.abs(boxes[0]!.top - boxes[1]!.top) < 1,
          morningError: rows.length === 3 ? Math.abs(morning - (boxes[0]!.bottom + boxes[1]!.top) / 2) : 0,
          nightError: rows.length === 3 ? Math.abs(night - (boxes[1]!.bottom + boxes[2]!.top) / 2) : 0 };
      });
      assert.equal(layout.left, 58); assert.equal(layout.right, 1022);
      for (const gap of layout.gaps) { assert.ok(gap >= 47); if (!layout.snack) assert.ok(Math.abs(gap - layout.gaps[0]!) <= 1); }
      for (const typography of layout.typography) { assert.deepEqual(typography, layout.typography[0]); assert.equal(typography.padding, '24px'); assert.equal(typography.headingGap, '24px'); assert.ok(typography.fits); }
      assert.ok(layout.firstRowAligned && layout.morningError <= 1 && layout.nightError <= 1);
    }
  } finally { await renderer.close(); await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
