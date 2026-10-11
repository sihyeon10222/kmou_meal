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

// Embed local assets so both renderers work without network access.
const encoded = new Map<string, Promise<string>>();
function encodedAsset(path: string): Promise<string> {
  let result = encoded.get(path);
  if (!result) {
    result = readFile(new URL(`../assets/${path}`, import.meta.url)).then(bytes => bytes.toString('base64'))
      .catch(error => { encoded.delete(path); throw error; });
    encoded.set(path, result);
  }
  return result;
}
export function loadFont(): Promise<string> {
  return encodedAsset('fonts/NPSfontRegular.woff2');
}
let fontCss: Promise<string> | undefined;
export function loadFontCss(): Promise<string> {
  return fontCss ??= Promise.all([loadFont(), encodedAsset('fonts/NPSfontBold.woff2'), encodedAsset('fonts/PretendardVariable.woff2'), encodedAsset('fonts/NPSfontExtraBold.woff2')])
    .then(([regular, bold, fallback, title]) => `
      @font-face { font-family: Meal; src: url(data:font/woff2;base64,${regular}) format('woff2'); font-weight: 100 500; font-display: block; }
      @font-face { font-family: Meal; src: url(data:font/woff2;base64,${bold}) format('woff2'); font-weight: 600 900; font-display: block; }
      @font-face { font-family: MealFallback; src: url(data:font/woff2;base64,${fallback}) format('woff2'); font-weight: 100 900; font-display: block; }
      @font-face { font-family: MealTitle; src: url(data:font/woff2;base64,${title}) format('woff2'); font-weight: 800; font-display: block; }
    `).catch(error => { fontCss = undefined; throw error; });
}
