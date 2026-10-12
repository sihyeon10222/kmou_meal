import { chromium, type Browser, type BrowserContextOptions } from 'playwright';

/** One lazy browser per sequential batch; newPage isolates each image in its own context. */
export function createRenderBrowser(name: string) {
  let browser: Promise<Browser> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    async newPage(options: BrowserContextOptions) {
      if (closed) throw new Error(`${name} 렌더러가 이미 종료되었습니다.`);
      if (!browser) {
        const pending: Promise<Browser> = chromium.launch({ headless: true }).then(active => {
          active.once('disconnected', () => { if (browser === pending) browser = undefined; });
          return active;
        }).catch(error => {
          if (browser === pending) browser = undefined;
          throw error;
        });
        browser = pending;
      }
      const active = await browser;
      if (closed) throw new Error(`${name} 렌더러가 이미 종료되었습니다.`);
      return active.newPage(options);
    },
    close(): Promise<void> {
      closed = true;
      return closing ??= browser ? browser.then(active => active.close()) : Promise.resolve();
    },
  };
}
