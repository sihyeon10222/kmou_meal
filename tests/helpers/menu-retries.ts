import type { TestContext } from 'node:test';

/** Only for mocked-fetch tests: record backoff without sleeping or noisy failure logs. */
export function fastMenuRetries(t: TestContext) {
  const delays: number[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    delays.push(delay);
    queueMicrotask(callback);
    return 0;
  });
  t.mock.method(Math, 'random', () => 0);
  const warnings = t.mock.method(console, 'warn', () => {});
  const recoveries = t.mock.method(console, 'info', () => {});
  return { delays, warnings, recoveries };
}
