import { readFile } from 'node:fs/promises';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}

export function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../templates/${name}`, import.meta.url), 'utf8');
}

// Share the large, immutable encoded font across Story and weekly renders.
let fontBase64: Promise<string> | undefined;
export function loadFont(): Promise<string> {
  return fontBase64 ??= readFile(new URL('../assets/fonts/NotoSansKR.ttf', import.meta.url))
    .then(font => font.toString('base64'))
    .catch(error => { fontBase64 = undefined; throw error; });
}
