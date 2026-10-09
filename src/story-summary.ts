import type { RunResult } from './run-stories.js';

const cell = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/\r?\n/g, ' ');

export function storySummary(results: RunResult[]): string {
  const lines = ['## Story 실행 결과', '', '| 날짜 | 모드 | 결과 | 상세 |', '| --- | --- | --- | --- |'];
  for (const result of results) {
    const detail = result.warning ?? (result.error ? `${result.stage ?? 'unknown'}: ${result.error}`
      : result.emptyMenu ? '정상 조회: 등록된 식단 없음 안내' : result.mediaId ?? '-');
    lines.push(`| ${cell(result.targetDate)} | ${cell(result.mode)} | ${result.status}${result.warning ? ' (경고)' : ''} | ${cell(detail)} |`);
  }
  lines.push('', '재실행이 필요하면 실패한 식당만 선택하세요. 게시 성공/경고 항목은 재실행 시 중복 게시됩니다.',
    'publish 단계에서 응답이 유실된 경우에는 재실행 전에 계정과 게시 영수증을 먼저 확인하세요.', '');
  return `${lines.join('\n')}\n`;
}
