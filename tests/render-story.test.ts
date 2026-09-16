import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderStory, storyHtml } from '../src/render-story.js';

test('식단 텍스트는 HTML로 실행하지 않고 빈 끼니를 표시한다', async () => {
  const html = await storyHtml({ date: '2026/09/16', lunch: ['<script>alert(1)</script>', '밥&김치'], dinner: [] });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('밥&amp;김치'));
  assert.ok(html.includes('석식이 없습니다.'));
  assert.ok(html.includes('오늘의 기숙사 식단'));
  assert.ok(html.includes('제작: 인공지능공학부 김시현'));
  assert.ok(!html.includes('A GOOD MEAL, A GOOD DAY.'));
  assert.ok(!html.includes('출처 · 학생생활관 식단표'));
});

test('시간대별 Story는 지정한 식사 영역과 제목만 노출한다', async () => {
  const lunch = await storyHtml({ mode: 'today_lunch', date: '2026/09/17', title: '오늘의 기숙사 식단', lunch: ['점심'], dinner: [] });
  assert.ok(lunch.includes('today-lunch'));
  assert.ok(lunch.includes('점심'));
  assert.ok(lunch.includes('.today-lunch .dinner { display: none; }'));

  const dinner = await storyHtml({ mode: 'today_dinner', date: '2026/09/17', title: '오늘의 기숙사 식단', lunch: [], dinner: ['저녁'] });
  assert.ok(dinner.includes('today-dinner'));
  assert.ok(dinner.includes('.today-dinner .lunch { display: none; }'));
  assert.ok(dinner.includes('저녁'));

  const tomorrow = await storyHtml({ mode: 'tomorrow_full', date: '2026/09/18', title: '내일의 기숙사 식단', lunch: ['내일 점심'], dinner: ['내일 저녁'] });
  assert.ok(tomorrow.includes('내일의 기숙사 식단'));
  assert.ok(tomorrow.includes('내일 점심') && tomorrow.includes('내일 저녁'));

  const lunchOnly = await storyHtml({ mode: 'tomorrow_full', date: '2026/09/18', title: '내일의 기숙사 식단', lunch: ['내일 점심'], dinner: [] });
  assert.ok(lunchOnly.includes('석식이 없습니다.'));
  const dinnerOnly = await storyHtml({ mode: 'tomorrow_full', date: '2026/09/18', title: '내일의 기숙사 식단', lunch: [], dinner: ['내일 저녁'] });
  assert.ok(dinnerOnly.includes('중식이 없습니다.'));

  const empty = await storyHtml({ mode: 'today_lunch', date: '2026/09/17', title: '오늘의 기숙사 식단', lunch: [], dinner: [], noMenu: true });
  assert.ok(empty.includes('no-menu'));
  assert.ok(empty.includes('오늘은 식단이 없습니다.'));
});

test('긴 식단은 축소해 JPEG로 렌더링하고 너무 긴 식단은 누락시키지 않고 실패한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kmou-render-'));
  try {
    const file = await renderStory({ date: '2026/09/16', lunch: Array(8).fill('점심 메뉴'), dinner: Array(8).fill('저녁 메뉴') }, directory);
    const bytes = await readFile(file);
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
    assert.ok((await readFile(file.replace('.jpg', '.html'), 'utf8')).includes('font-size:'));
    await assert.rejects(renderStory({ date: '2026/09/16', lunch: Array(40).fill('매우 긴 메뉴'), dinner: [] }, directory), /메뉴가 이미지 영역을 초과/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
