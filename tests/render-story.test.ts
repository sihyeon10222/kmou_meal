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
  assert.ok(html.includes('등록된 메뉴가 없습니다.'));
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
