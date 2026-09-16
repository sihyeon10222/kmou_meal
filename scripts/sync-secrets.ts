import { spawnSync } from 'node:child_process';
import { loadConfig, safeError } from '../src/config.js';

// 토큰을 명령행 인자/로그로 출력하지 않고 gh의 표준 입력으로 전달합니다.
try {
  const repo = process.argv[2] ?? 'sihyeon10222/kmou_meal';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('저장소 형식: owner/repo');
  loadConfig();
  for (const name of ['IG_ACCESS_TOKEN', 'IG_USER_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_BUCKET']) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], { input: value, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`${name} 등록 실패. gh auth status로 로그인을 확인하세요.`);
    console.log(`${name}: GitHub Secret 등록 완료`);
  }
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
