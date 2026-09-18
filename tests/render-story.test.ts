import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { load } from 'cheerio';
import { renderStory, storyHtml } from '../src/render-story.js';
import { coopStory, dormitoryStory } from '../src/story-data.js';
import { STORY_MODES, resolveStoryRequest } from '../src/story-modes.js';
import { coopMenu, emptyCoop } from './fixtures.js';

test('메뉴 HTML escape, 공통 헤더/푸터, 부분 empty 영역 유지', async () => {
  const data = dormitoryStory(resolveStoryRequest('today_dormitory_full', '2026-09-18'), {
    date: '2026/09/18', lunch: ['<script>alert(1)</script>', '밥&김치'], dinner: [],
  });
  const html = await storyHtml(data);
  const $ = load(html);
  assert.equal($('script').length, 0);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal($('.dinner .menu').text(), '메뉴 없음');
  assert.equal($('h1').text(), '9/18 금요일기숙사 식단');
  assert.match($('footer').text(), /@kmou_meal.*김시현/);
});

test('14개 모드의 실제 DOM은 요청한 영역만 포함한다', async () => {
  for (const mode of STORY_MODES) {
    const request = resolveStoryRequest(mode, '2026-09-17');
    const data = request.restaurant === 'dormitory' ? dormitoryStory(request, null) : coopStory(request, coopMenu);
    const $ = load(await storyHtml(data));
    assert.equal($('.meal').length, request.restaurant === 'snack' ? 4 : request.scope !== 'full' ? 1 : request.restaurant === 'teacher' ? 3 : 2);
    assert.equal($('.breakfast').length, request.restaurant === 'teacher' && request.scope === 'full' ? 1 : 0);
    assert.ok($('h1').text().includes(request.title));
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
    assert.equal(p(mode === 'today_snack' ? '.meal.snack .menu' : '.breakfast .menu').text(), '메뉴 없음');
  }
});

test('실제 fixture 3종 렌더, 긴 메뉴 축소, 삭제 없이 초과 실패', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-render-'));
  try {
    for (const mode of ['today_snack', 'today_teacher_full', 'today_dormitory_full'] as const) {
      const request = resolveStoryRequest(mode, '2026-09-18');
      const data = request.restaurant === 'dormitory'
        ? dormitoryStory(request, { date: '2026/09/18', lunch: Array(8).fill('점심 메뉴'), dinner: Array(8).fill('저녁 메뉴') })
        : coopStory(request, coopMenu);
      const file = await renderStory(data, directory);
      assert.deepEqual([...(await readFile(file)).subarray(0, 2)], [0xff, 0xd8]);
      const html = load(await readFile(file.replace('.jpg', '.html'), 'utf8'));
      assert.equal(html('.dish').length, data.sections.reduce((sum, s) => sum + Math.max(s.items.length, 1), 0));
      assert.ok(html('.dish').toArray().every((node, index) => html(node).text() === data.sections.flatMap(s => s.items.length ? s.items : ['메뉴 없음'])[index]));
    }
    const tooLong = coopStory(resolveStoryRequest('today_snack', '2026-09-18'), coopMenu);
    tooLong.sections[0]!.items = Array(70).fill('매우 긴 메뉴');
    await assert.rejects(renderStory(tooLong, directory), /메뉴가 이미지 영역을 초과/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
