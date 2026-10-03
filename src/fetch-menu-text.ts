import { Agent } from 'undici';

const CONNECT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

function transportReason(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return '네트워크/본문 수신 오류';
  if ('name' in cause && cause.name === 'TimeoutError') return 'TimeoutError';
  const nested = 'cause' in cause ? cause.cause : undefined;
  const code = 'code' in cause ? cause.code : typeof nested === 'object' && nested !== null && 'code' in nested
    ? nested.code : undefined;
  // 원본 오류 메시지와 URL은 로그에 노출하지 않습니다.
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code : '네트워크/본문 수신 오류';
}

/** 부작용이 없는 식단 조회 전용. 파싱은 반환 후 수행하여 구조 오류를 재시도하지 않습니다. */
export async function fetchMenuText(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  source: string,
): Promise<string> {
  // AbortSignal alone does not override Undici's shorter connection timeout.
  // Scope this transport to menu reads; never alter Instagram's publish transport.
  // Fresh connections also avoid reusing sockets closed by the school/proxy.
  const dispatcher = new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS }, connections: 1, pipelining: 0 });
  try {
    return await requestMenuText(url, init, source, dispatcher);
  } finally {
    await dispatcher.destroy();
  }
}

async function requestMenuText(url: string, init: Omit<RequestInit, 'signal'>, source: string, dispatcher: Agent): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    let reason: string;
    try {
      const options = { ...init, dispatcher, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
      response = await fetch(url, options);
      // 본문 수신까지 동일한 제한 시간을 적용하고, 수신 중 연결이 끊겨도 재시도합니다.
      if (response.ok) {
        const text = await response.text();
        if (attempt > 1) console.info(`${source} 복구 성공: ${attempt}/${MAX_ATTEMPTS}회 시도.`);
        return text;
      }
    } catch (cause) {
      reason = transportReason(cause);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`${source} 실패: ${reason} (총 ${MAX_ATTEMPTS}회 시도).`, { cause });
      }
      await retryAfterDelay(source, reason, attempt);
      continue;
    }

    // 오류 본문을 해제하다 발생한 통신 오류가 실제 HTTP 상태를 가리지 않게 합니다.
    await response.body?.cancel().catch(() => undefined);
    reason = `HTTP ${response.status}`;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`${source} 실패: ${reason} (${attempt}회 시도).`);
    }
    await retryAfterDelay(source, reason, attempt, response.headers.get('retry-after'));
  }
  throw new Error(`${source} 실패: 재시도 횟수를 초과했습니다.`);
}

async function retryAfterDelay(source: string, reason: string, attempt: number, retryAfter: string | null = null): Promise<void> {
  const serverDelay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter.trim())
    ? Number(retryAfter) * 1_000 : Math.max(0, Date.parse(retryAfter) - Date.now());
  const backoff = RETRY_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
  // Do not hammer the server earlier than Retry-After, or leave a job waiting indefinitely.
  if (serverDelay > MAX_RETRY_DELAY_MS) {
    throw new Error(`${source} 실패: ${reason}. 서버의 Retry-After가 60초를 초과하여 이번 조회를 중단합니다.`);
  }
  const delay = Math.max(backoff, Number.isFinite(serverDelay) ? serverDelay : 0);
  console.warn(`${source} ${attempt}/${MAX_ATTEMPTS} 실패: ${reason}. ${(delay / 1_000).toFixed(1)}초 후 재시도합니다.`);
  await new Promise(resolve => setTimeout(resolve, delay));
}
