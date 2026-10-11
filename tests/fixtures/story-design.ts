import { weeklyDesignData, type DesignScenario } from './weekly-design.js';
import { resolveStoryRequest, type StoryMode } from '../../src/story-modes.js';
import type { StoryRenderData } from '../../src/story-data.js';
import type { WeeklyPageKind } from '../../src/weekly-data.js';

export const storyDesignScenarios = ['normal', 'empty', 'partial', 'dense', 'long'] as const;
export function storyDesignData(kind: WeeklyPageKind, scenario: DesignScenario = 'normal', scope = 'full'): StoryRenderData {
  const mode = `today_${kind}${kind === 'snack' ? '' : `_${scope}`}` as StoryMode;
  const request = resolveStoryRequest(mode, '2026-10-05');
  const sections = structuredClone(weeklyDesignData(kind, 'normal').pages[0]!.days[0]!.sections);
  if (kind === 'snack') sections.sort((a, b) => ['western', 'set-meal', 'ramen', 'snack'].indexOf(a.key) - ['western', 'set-meal', 'ramen', 'snack'].indexOf(b.key));
  if (scenario === 'empty') sections.forEach(section => { section.items = []; });
  if (scenario === 'partial') sections.forEach((section, index) => { if (index % 2 === 0) section.items = []; });
  if (scenario === 'dense') {
    sections.forEach(section => { section.items = ['백미밥']; });
    // Sixteen lines fit an equal-height cafeteria row with 1.25 line spacing.
    // Larger rows are covered by the renderer's overflow rejection test.
    sections[1]!.items = Array.from({ length: kind === 'snack' ? 16 : 18 }, (_, i) => ['백미밥', '돼지불고기', '미역국', '배추김치'][i % 4]!);
  }
  if (scenario === 'long') {
    sections[0]!.items = ['바지락순두부찌개', '치킨치즈더블돈가스', '빅고구마치즈돈가스'];
    sections.at(-1)!.items = ['메밀소바+유부초밥', '부대찌개라면+공깃밥'];
  }
  return { request, sections: sections.filter(section => scope === 'full' || section.key === scope) };
}
