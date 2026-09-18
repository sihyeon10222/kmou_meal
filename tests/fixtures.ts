import { readFile } from 'node:fs/promises';
import { parseCoopMenu } from '../src/fetch-coop-menu.js';

export const coopHtml = await readFile(new URL('./fixtures/coop.html', import.meta.url), 'utf8');
export const coopMenu = parseCoopMenu(coopHtml, '2026-09-18');
export const emptyCoopHtml = '<table><thead><th>양식코너</th><th>라면코너</th><th>분식코너</th><th>정식</th></thead><tbody><td colspan="4">2026년 09월 19일</td></tbody></table><table><thead><th>조식</th><th>중식</th><th>석식</th></thead><tbody><td colspan="3">2026년 09월 19일</td></tbody></table>';
export const emptyCoop = parseCoopMenu(emptyCoopHtml, '2026-09-19');
