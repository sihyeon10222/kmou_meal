import { config } from 'dotenv';
config({ quiet: true });

export interface PublishConfig {
  igAccessToken: string;
  igUserId: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseBucket: string;
}

const SECRET_NAMES = ['IG_ACCESS_TOKEN', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDFLARE_API_TOKEN'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PublishConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} 설정이 없습니다. .env 또는 GitHub Actions Secrets를 확인하세요.`);
    return value;
  };
  const supabaseUrl = required('SUPABASE_URL');
  const url = URL.parse(supabaseUrl);
  if (!url || url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password) {
    throw new Error('SUPABASE_URL이 올바르지 않습니다.');
  }
  const igUserId = required('IG_USER_ID');
  if (!/^\d+$/.test(igUserId)) throw new Error('IG_USER_ID는 숫자 ID여야 합니다.');
  return {
    igAccessToken: required('IG_ACCESS_TOKEN'), igUserId, supabaseUrl,
    supabaseKey: env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseBucket: required('SUPABASE_BUCKET'),
  };
}

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
