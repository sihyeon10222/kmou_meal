const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

function transportReason(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return '네트워크/본문 수신 오류';
  if ('name' in cause && cause.name === 'TimeoutError') return 'TimeoutError';
  const nested = 'cause' in cause ? cause.cause : undefined;
  const code = typeof nested === 'object' && nested !== null && 'code' in nested
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    let reason: string;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // 본문 수신까지 동일한 제한 시간을 적용하고, 수신 중 연결이 끊겨도 재시도합니다.
      if (response.ok) return await response.text();
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
    await retryAfterDelay(source, reason, attempt);
  }
  throw new Error(`${source} 실패: 재시도 횟수를 초과했습니다.`);
}

async function retryAfterDelay(source: string, reason: string, attempt: number): Promise<void> {
  const delay = attempt * RETRY_DELAY_MS;
  console.warn(`${source} ${attempt}/${MAX_ATTEMPTS} 실패: ${reason}. ${delay / 1_000}초 후 재시도합니다.`);
  await new Promise(resolve => setTimeout(resolve, delay));
}
