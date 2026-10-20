export interface PublishConfig {
  igAccessToken: string;
  igUserId: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseBucket: string;
}

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

