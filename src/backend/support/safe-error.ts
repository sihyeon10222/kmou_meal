const SECRET_NAMES = ['IG_ACCESS_TOKEN', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDFLARE_API_TOKEN'] as const;

/** 외부 라이브러리 오류에도 키나 토큰이 로그로 유출되지 않도록 최종 경계에서 가립니다. */
export function safeError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  let message = error instanceof Error ? error.message : '알 수 없는 오류';
  const secrets = SECRET_NAMES.flatMap(name => {
    const value = env[name]?.trim();
    return value ? [value, encodeURIComponent(value)] : [];
  }).sort((a, b) => b.length - a.length);
  for (const value of secrets) {
    message = message.replaceAll(value, '[REDACTED]');
  }
  return message;
}
