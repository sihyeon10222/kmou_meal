/** Identical relative layout in src/ and dist/; independent of the caller's cwd. */
export const FRONTEND_ROOT = new URL('../../frontend/', import.meta.url);

export function frontendAsset(path: string): URL {
  return new URL(`assets/${path}`, FRONTEND_ROOT);
}
