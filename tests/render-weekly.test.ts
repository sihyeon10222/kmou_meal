import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createWeeklyFetcher, weeklyRange } from '../src/weekly-data.js';
import { renderWeekly, weeklyHtml } from '../src/render-weekly.js';
import { coopMenu } from './fixtures.js';
import { publishableWeekly } from '../src/weekly-snapshot.js';
import { layoutWeekly } from '../src/layout-weekly.js';
import { designKinds, designScenarios, weeklyDesignData } from './fixtures/weekly-design.js';

const range = weeklyRange('2026-09-20');
const fetcher = createWeeklyFetcher({
  coop: async () => coopMenu,
  badaro: async date => ({ date: String(date), breakfast: ['우유/시리얼'], lunch: ['삼겹살구이*상추쌈'], dinner: ['메밀소바+유부초밥'] }),
  dormitory: async date => ({ date: String(date), breakfast: ['우유/시리얼', '셀프토스트&버터/딸기잼', '야채샐러드&소스'], lunch: ['삼겹살구이*상추쌈', '밥/김치'], dinner: ['메밀소바+유부초밥', '콩나물국'] }),
});
for (const kind of ['combined', 'badaro', 'dormitory'] as const) {
  test(`weekly ${kind} renders every cell inside 3:4 pages`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-'));
    try {
      const data = await fetcher(kind, range);
      const result = await renderWeekly(data, dir);
      assert.equal(result.images.length, 2);
      if (kind === 'combined') {
        assert.match(result.images[0]!, /snack-weekly.jpg$/);
        assert.match(result.images[1]!, /teacher-weekly.jpg$/);
        assert.equal(result.master, undefined);
      }
      for (const path of result.images) {
        const meta = await sharp(path).metadata();
        assert.equal(meta.width, 1080); assert.equal(meta.height, 1440);
      }
      const headerBrowser = await chromium.launch({ headless: true });
      try {
        const page = await headerBrowser.newPage();
        for (const restaurant of data.pages) {
          await page.setContent(await readFile(join(dir, `${range.week}-${restaurant.kind}-weekly.html`), 'utf8'));
          const insets = await page.evaluate(async () => {
            await document.fonts.ready;
            const title = document.querySelector('h1')!;
            const style = getComputedStyle(title);
            const context = document.createElement('canvas').getContext('2d')!;
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = context.measureText(title.textContent!);
            const range = document.createRange(); range.selectNodeContents(title);
            return { top: range.getBoundingClientRect().top + metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent,
              left: title.getBoundingClientRect().left - metrics.actualBoundingBoxLeft };
          });
          assert.ok(Math.abs(insets.top - insets.left) <= 1, `${restaurant.kind}: ${JSON.stringify(insets)}`);
        }
      } finally { await headerBrowser.close(); }
      if (result.master) {
        const meta = await sharp(result.master).metadata();
        assert.equal(meta.width, 2160); assert.equal(meta.height, 1440);
        // Both files must come from exact halves of the same master, not independent renders.
        for (const [index, path] of result.images.entries()) {
          const expected = await sharp(result.master).extract({ left: index * 1080, top: 0, width: 1080, height: 1440 }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
          assert.deepEqual(await readFile(path), expected);
        }
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 2160, height: 1440 } });
          await page.setContent(await readFile(join(dir, `${range.week}-${kind}-weekly.html`), 'utf8'));
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const layout = await page.evaluate(() => {
            const days = [...document.querySelectorAll('.day')];
            const geometry = days.map(day => ({
              width: day.getBoundingClientRect().width,
              headings: [...day.querySelectorAll('.cell')].map(node => node.getAttribute('aria-label')),
              fonts: [...day.querySelectorAll('.menu')].map(node => getComputedStyle(node).fontSize),
              menus: day.querySelectorAll('.menu').length,
            }));
            const title = document.querySelector('h1')!.getBoundingClientRect();
            const range = document.querySelector('.range')!.getBoundingClientRect();
            const crossesCenter = [...days[3]!.querySelectorAll('.menu p')].some(node => {
              const text = document.createRange(); text.selectNodeContents(node);
              return [...text.getClientRects()].some(rect => rect.left < 1080 && rect.right > 1080);
            });
            return { geometry, crossesCenter, titleTop: title.top, titleRight: title.right, titleBottom: title.bottom, titleLeft: title.left, rangeTop: range.top, rangeLeft: range.left, rangeRight: range.right, rangeAlign: getComputedStyle(document.querySelector('.range')!).textAlign, rangeSize: getComputedStyle(document.querySelector('.range')!).fontSize, titleSize: getComputedStyle(document.querySelector('h1')!).fontSize };
          });
          assert.equal(layout.geometry.length, 7);
          for (const day of layout.geometry) {
            const first = layout.geometry[0]!;
            assert.ok(Math.abs(day.width - first.width) < 1, 'columns differ only by subpixel rounding');
            assert.deepEqual({ ...day, width: first.width }, first);
          }
          assert.equal(layout.crossesCenter, true, 'Thursday menu must not avoid the center crop');
          assert.equal(layout.rangeAlign, 'left');
          assert.equal(layout.titleSize, '72px');
          assert.equal(layout.rangeSize, '64px');
          assert.ok(layout.rangeRight <= 2160 - 32);
          assert.ok(layout.rangeTop > layout.titleTop, 'the smaller date shares the title baseline');
        } finally { await browser.close(); }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
test('empty weekday/holiday areas and HTML escaping survive rendering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-empty-'));
  try {
    const data = await fetcher('combined', range);
    const page = data.pages[1]!;
    page.days.forEach(day => day.sections.forEach(section => { section.items = []; }));
    assert.equal(((await weeklyHtml(page)).match(/등록된 식단 없음/g) ?? []).length, 15);
    await renderWeekly(data, dir);
    page.days[0]!.sections[0]!.items = ['<script>alert("test")</script>'];
    assert.ok(!(await weeklyHtml(page)).includes('<script>'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('one available restaurant renders a single combined feed image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-single-'));
  try {
    const data = await fetcher('combined', range);
    data.pages[1]!.days.forEach(day => day.sections.forEach(section => { section.items = []; }));
    const prepared = publishableWeekly(data)!;
    assert.deepEqual(prepared.pages.map(page => page.kind), ['snack']);
    assert.match(prepared.caption, /#해양대학식/);
    assert.doesNotMatch(prepared.caption, /교직원/);
    const rendered = await renderWeekly(prepared, dir);
    assert.equal(rendered.images.length, 1);
    assert.match(rendered.images[0]!, /snack-weekly.jpg$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('괄호 안 날짜 범위와 닫는 괄호는 한 줄 단위로 유지한다', async () => {
  const data = await fetcher('badaro', range);
  data.pages[0]!.days[0]!.sections[0]!.items = ['추석연휴(9/24~27)'];
  const html = await weeklyHtml(data.pages[0]!);
  assert.match(html, /추석연휴<span class="no-break">\(9\/24~27\)<\/span>/);
  assert.doesNotMatch(html, /<wbr>\)/);
});
test('overflow fails before returning publishable images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-overflow-'));
  try {
    const data = await fetcher('combined', range);
    data.pages[1]!.days[0]!.sections[1]!.items = Array.from({ length: 90 }, () => '메뉴');
    await assert.rejects(renderWeekly(data, dir), /초과/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('compact ranges and update notices use the full panorama header', async () => {
  const data = await fetcher('dormitory', range);
  const html = await weeklyHtml(data.pages[0]!, '2026-09-23');
  assert.match(html, /9\/21 ~ 9\/27/);
  assert.match(html, /9\/23 \(수\)에 식단표 변경됨/);
  assert.doesNotMatch(await weeklyHtml(data.pages[0]!), /식단표 변경됨/);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2160, height: 1440 } });
    await page.setContent(html);
    await page.addScriptTag({ content: 'globalThis.__name ??= value => value;' });
    await page.evaluate(layoutWeekly);
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return { noticeFont: getComputedStyle(document.querySelector('.update-notice')!).fontSize, noticeColor: getComputedStyle(document.querySelector('.update-notice')!).color, notice: rect('.update-notice'), calendar: rect('.calendar'), range: rect('.range'), title: rect('h1') };
    });
    assert.equal(boxes.noticeFont, '28px');
    assert.equal(boxes.noticeColor, 'rgb(255, 95, 95)');
    assert.ok(Math.abs(boxes.notice.right - (2160 - 64)) <= 1);
    assert.ok(boxes.notice.top > boxes.title.top);
    assert.equal(boxes.notice.left, boxes.title.left);
    assert.ok(boxes.notice.bottom < boxes.calendar.top);
    assert.doesNotMatch(html, /@kmou_meal|<footer/);
    assert.equal(boxes.calendar.left, 24);
    assert.equal(2160 - boxes.calendar.right, 24);
    assert.equal(1440 - boxes.calendar.bottom, 24);
    assert.ok(boxes.range.bottom < boxes.calendar.top);
    assert.ok(boxes.title.right < 1080);
  } finally { await browser.close(); }
});

test('all four restaurants keep balanced margins and shared meal rows in every design scenario', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-design-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const kind of designKinds) for (const scenario of designScenarios) {
      await t.test(`${kind}: ${scenario}`, async () => {
        const data = weeklyDesignData(kind, scenario);
        await renderWeekly(data, dir);
        await page.setContent(await readFile(join(dir, `${data.week}-${kind}-weekly.html`), 'utf8'));
        const layout = await page.evaluate(async () => {
          await document.fonts.ready;
          const rect = (node: Element) => {
            const r = node.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
          };
          const ink = (node: Element) => {
            const style = getComputedStyle(node);
            const context = document.createElement('canvas').getContext('2d')!;
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
            const metrics = context.measureText(node.textContent!);
            const text = document.createRange(); text.selectNodeContents(node);
            const r = text.getBoundingClientRect();
            const baseline = r.top + metrics.fontBoundingBoxAscent;
            return { top: baseline - metrics.actualBoundingBoxAscent, bottom: baseline + metrics.actualBoundingBoxDescent,
              left: r.left - metrics.actualBoundingBoxLeft, right: r.left + metrics.actualBoundingBoxRight };
          };
          const title = document.querySelector('h1')!;
          const date = document.querySelector('.range')!;
          const notice = document.querySelector('.update-notice');
          const days = [...document.querySelectorAll('.day')].map(day => ({ ...rect(day),
            cells: [...day.querySelectorAll('.cell')].map(cell => {
              const menu = cell.querySelector<HTMLElement>('.menu')!;
              const heading = cell.querySelector('h2');
              const style = getComputedStyle(cell);
              return { ...rect(cell), menu: rect(menu), heading: heading ? rect(heading) : null,
                emptyFont: cell.querySelector('.empty') ? getComputedStyle(cell.querySelector('.empty')!).fontSize : null,
                font: parseFloat(getComputedStyle(menu).fontSize), color: getComputedStyle(menu).color,
                line: parseFloat(getComputedStyle(menu).lineHeight), spacing: getComputedStyle(menu).letterSpacing,
                background: style.backgroundColor, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
                labelVisible: Boolean(heading),
                overflow: menu.scrollWidth > menu.clientWidth + 1,
                parts: [...menu.querySelectorAll('.menu-part, .empty')].map(part => {
                  const range = document.createRange(); range.selectNodeContents(part);
                  const lines = [...range.getClientRects()];
                  return { wraps: new Set(lines.map(line => Math.round(line.top))).size > 1,
                    fallback: part.classList.contains('can-wrap'),
                    overflow: lines.some(line => line.right > menu.getBoundingClientRect().right + 1) };
                }),
              };
            }),
          }));
          return { title: ink(title), titleBox: rect(title), date: rect(date), dateInk: ink(date),
            headingBottom: Math.max(ink(title).bottom, ink(date).bottom), notice: notice ? ink(notice) : null,
            surfaces: [...document.querySelectorAll('.meal-surface')].map(node => ({ ...rect(node), color: getComputedStyle(node).backgroundColor, blur: getComputedStyle(node).backdropFilter, shadow: getComputedStyle(node).boxShadow, radius: getComputedStyle(node).borderRadius })),
            weekday: ink(document.querySelector('.weekday')!), weekdays: [...document.querySelectorAll('.weekday')].map(node => node.textContent), sheet: rect(document.querySelector('.sheet')!), calendar: rect(document.querySelector('.calendar')!), days };
        });
        const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} vs ${expected}`);
        close(layout.title.top, 64, 'visible title top');
        close(layout.title.left, 64, 'visible title left');
        close(layout.calendar.left, 24, 'table left');
        close(layout.sheet.width - layout.calendar.right, 24, 'table right');
        close(layout.sheet.height - layout.calendar.bottom, 24, 'table bottom');
        close(layout.dateInk.left - layout.title.right, layout.title.left, 'visible name/date gap matches left margin');
        close(layout.weekday.top - layout.headingBottom, 56, 'header/weekday visible gap is identical on reposts');
        assert.deepEqual(layout.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, layout.days.length));
        close(layout.days[0]!.cells[0]!.top - layout.weekday.bottom, 32, 'weekday/card edge gap');
        assert.equal(layout.surfaces.length, layout.days[0]!.cells.length);
        layout.surfaces.forEach((surface, index) => {
          const first = layout.days[0]!.cells[index]!;
          const last = layout.days.at(-1)!.cells[index]!;
          close(surface.top, first.top, 'surface top'); close(surface.height, first.height, 'surface height');
          close(surface.left, first.left, 'surface left'); close(surface.right, last.right, 'one continuous surface');
          assert.equal(surface.radius, '48px'); assert.equal(surface.blur, 'none'); assert.notEqual(surface.shadow, 'none'); assert.match(surface.shadow, /inset/);
          assert.equal(surface.color, kind === 'snack' ? 'rgb(218, 233, 255)' : ['rgb(255, 255, 255)', 'rgb(218, 233, 255)', 'rgb(34, 89, 177)'][index]);
        });
        assert.equal(Boolean(layout.notice), scenario === 'repost');
        if (layout.notice) {
          assert.ok(layout.notice.top >= layout.headingBottom);
          assert.ok(layout.notice.bottom <= layout.weekday.top);
          close(layout.notice.top - layout.headingBottom, layout.weekday.top - layout.notice.bottom, 'notice fits centrally inside existing gap');
        }
        for (const day of layout.days) {
          assert.equal(day.cells.length, kind === 'snack' ? 4 : 3);
          close(day.width, layout.days[0]!.width, 'day width');
          for (const [row, cell] of day.cells.entries()) {
            const reference = layout.days[0]!.cells[row]!;
            close(cell.top, reference.top, 'row top');
            close(cell.bottom, reference.bottom, 'row bottom');
            assert.equal(cell.font, reference.font, 'one menu font per meal row');
            assert.equal(cell.labelVisible, day === layout.days[0], 'each meal label appears only once across the row');
            assert.ok(cell.font >= 18 && cell.font <= 30);
            close(cell.line, cell.font * 1.4, 'menu line height');
            assert.equal(cell.spacing, 'normal');
            assert.equal(cell.color, kind !== 'snack' && row === 2 ? 'rgb(255, 255, 255)' : 'rgb(24, 61, 68)');
            assert.deepEqual(cell.padding, ['32px', '16px', '16px', '16px']);
            close(cell.menu.top - cell.top, 32, 'menu top alignment without a reserved heading row');
            if (cell.heading) {
              close((cell.heading.top + cell.heading.bottom) / 2, cell.top, 'label straddles the card boundary');
              assert.ok(cell.heading.bottom < cell.menu.top);
            }
            assert.ok(cell.bottom - cell.menu.bottom >= 16 - 0.1, 'minimum bottom padding');
            assert.ok(cell.menu.left - cell.left >= 16 - 0.1);
            assert.ok(cell.right - cell.menu.right >= 16 - 0.1);
            assert.equal(cell.overflow, false);
            for (const part of cell.parts) {
              assert.equal(part.overflow, false);
              if (part.fallback) assert.equal(cell.font, 18, 'only wrap ordinary names at the minimum font');
              else assert.equal(part.wraps, false, 'ordinary names stay intact');
            }
            assert.equal(cell.background, 'rgba(0, 0, 0, 0)', 'columns share the row surface');
            if (cell.emptyFont && ['dormitory', 'badaro'].includes(kind)) assert.equal(cell.emptyFont, '30px');
            else if (cell.emptyFont) assert.ok(parseFloat(cell.emptyFont) <= 24);
            if (scenario === 'empty') assert.ok(cell.font <= 24);
          }
        }
        layout.days[0]!.cells.slice(1).forEach((cell, index) => close(cell.top - layout.days[0]!.cells[index]!.bottom, 24, 'equal spacing between meal bands'));
        if (scenario === 'empty') {
          const cells = layout.days[0]!.cells;
          cells.forEach(cell => close(cell.height, cells[0]!.height, 'empty rows have equal heights'));
        }
        if (scenario === 'dense') assert.ok(layout.days[0]!.cells[1]!.height > layout.days[0]!.cells[0]!.height * 2);
        if (scenario === 'long') assert.ok(layout.days.some(day => day.cells.some(cell => cell.parts.some(part => part.fallback))));
      });
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('plus add-ons can move to their own line without splitting the main dish', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-weekly-plus-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const data = weeklyDesignData('snack', 'empty');
    data.pages[0]!.days[0]!.sections[0]!.items = ['메밀소바+유부초밥'];
    await renderWeekly(data, dir);
    const page = await browser.newPage();
    await page.setContent(await readFile(join(dir, `${data.week}-snack-weekly.html`), 'utf8'));
    const parts = await page.locator('.menu-part').evaluateAll(async nodes => {
      await document.fonts.ready;
      return nodes.map(node => ({ text: node.textContent, top: node.getBoundingClientRect().top,
        font: getComputedStyle(node).fontSize, wraps: node.classList.contains('can-wrap') }));
    });
    assert.deepEqual(parts.map(part => part.text), ['메밀소바', '+유부초밥']);
    assert.ok(parts[1]!.top > parts[0]!.top);
    assert.equal(parts[0]!.wraps, false);
    assert.equal(parts[0]!.font, parts[1]!.font);
    assert.ok(parseFloat(parts[0]!.font) <= 30, 'short rows respect the menu font cap');
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('replacement colors only changed dishes red, matching the update notice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kmou-highlight-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const data = weeklyDesignData('dormitory', 'repost');
    await renderWeekly(data, dir);
    const page = await browser.newPage();
    await page.setContent(await readFile(join(dir, `${data.week}-dormitory-weekly.html`), 'utf8'));
    const colors = await page.evaluate(() => ({
      notice: getComputedStyle(document.querySelector('.update-notice')!).color,
      changed: [...document.querySelectorAll('.changed-menu')].map(node => getComputedStyle(node).color),
      dinnerChanged: [...document.querySelectorAll('.dinner .changed-menu')].map(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor })),
      normal: [...document.querySelectorAll('.menu p:not(.changed-menu)')].map(node => getComputedStyle(node).color),
    }));
    assert.equal(colors.notice, 'rgb(255, 95, 95)');
    assert.ok(colors.changed.length > 1);
    assert.ok(colors.changed.every(color => color === colors.notice));
    assert.ok(colors.dinnerChanged.length > 0);
    colors.dinnerChanged.forEach(item => {
      assert.equal(item.color, colors.notice);
      assert.equal(item.background, 'rgba(0, 0, 0, 0)');
    });
    assert.ok(colors.normal.every(color => color !== colors.notice));
    const initial = await weeklyHtml(data.pages[0]!, undefined, data.menuChanges);
    assert.ok(!initial.includes('class="changed-menu"'));
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('단색 디자인의 둥근 폰트는 HTML에 내장되고 알약은 블러와 그림자를 유지한다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const kind of designKinds) {
      const data = weeklyDesignData(kind, 'normal');
      const html = await weeklyHtml(data.pages[0]!);
      assert.ok(!html.includes('data:image/'));
      assert.ok(html.includes('font-family: MealFallback'));
      assert.ok(!html.includes('radial-gradient'));
      assert.equal((html.match(/class="meal-surface /g) ?? []).length, data.pages[0]!.days[0]!.sections.length);
      await page.setContent(html);
      const labels = await page.locator('.meal-label').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, blur: style.backdropFilter, shadow: style.boxShadow };
      }));
      labels.forEach(label => {
        assert.equal(label.background, 'rgba(255, 255, 255, 0.22)');
        assert.match(label.blur, /blur\(3px\)/);
        assert.notEqual(label.shadow, 'none');
      });
    }
  } finally { await browser.close(); }
});
