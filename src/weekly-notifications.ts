import type { WeeklyKind } from './weekly-data.js';
import { publishedWeekly, type WeeklyRecord, type WeeklyReplacementNotice } from './post-weekly.js';
import type { StoryStorage } from './upload-supabase.js';

const ISSUE_TITLE = 'KMOU 주간 게시물 교체 알림';
type Storage = Pick<StoryStorage, 'readWeeklyJson' | 'writeWeeklyJson'>;

async function github(path: string, method: 'GET' | 'POST', token: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub 이슈 알림 실패: HTTP ${response.status}`);
  return response.json();
}

async function issueNumber(repo: string, token: string): Promise<number> {
  for (let page = 1; ; page++) {
    const issues = await github(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`, 'GET', token) as { number: number; title: string; pull_request?: unknown }[];
    const existing = issues.find(issue => !issue.pull_request && issue.title === ISSUE_TITLE);
    if (existing) return existing.number;
    if (issues.length < 100) break;
  }
  const issue = await github(`/repos/${repo}/issues`, 'POST', token, {
    title: ISSUE_TITLE,
    body: '주간 식단 게시물이 교체될 때마다 기존 게시물의 수동 삭제 안내를 댓글로 남깁니다. 알림을 받으려면 이 이슈를 구독하세요.',
    assignees: ['sihyeon10222'],
  }) as { number: number };
  return issue.number;
}

async function commentExists(repo: string, number: number, marker: string, token: string): Promise<boolean> {
  for (let page = 1; ; page++) {
    const comments = await github(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, 'GET', token) as { body: string }[];
    if (comments.some(comment => comment.body.includes(marker))) return true;
    if (comments.length < 100) return false;
  }
}

async function sendNotice(repo: string, number: number, notice: WeeklyReplacementNotice, token: string): Promise<void> {
  const marker = `<!-- kmou-weekly-replacement:${notice.runId} -->`;
  if (await commentExists(repo, number, marker, token)) return;
  await github(`/repos/${repo}/issues/${number}/comments`, 'POST', token, {
    body: `${marker}\n@sihyeon10222 ${notice.newMediaId ? '주간 식단 게시물이 새로 올라왔습니다.' : '기존 게시물의 학교 식단이 모두 사라졌습니다.'}\n\n` +
      `- 주차: ${notice.week}\n- 종류: ${notice.kind}\n` +
      `- 기존 게시물 ID: ${notice.oldMediaId}\n${notice.newMediaId ? `- 새 게시물 ID: ${notice.newMediaId}\n` : ''}\n` +
      '**기존 게시물을 Instagram에서 직접 삭제해 주세요.**',
  });
}

/** A failed notification stays in success.json and is retried without reposting media. */
export async function notifyWeeklyReplacements(storage: Storage, week: string, kinds: readonly WeeklyKind[],
  token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY): Promise<void> {
  if (!token || !repo) return;
  let number: number | undefined;
  const errors: unknown[] = [];
  for (const kind of kinds) {
    const record = await publishedWeekly(storage, week, kind);
    if (!record?.pendingNotifications?.length) continue;
    for (const notice of [...record.pendingNotifications]) {
      try {
        number ??= await issueNumber(repo, token);
        await sendNotice(repo, number, notice, token);
        record.pendingNotifications = record.pendingNotifications?.filter(item => item.runId !== notice.runId);
        await storage.writeWeeklyJson(`${week}/${kind}/success.json`, record satisfies WeeklyRecord);
      } catch (error) { errors.push(error); }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'GitHub 이슈 알림을 보내지 못했습니다. 다음 실행에서 다시 시도합니다.');
}
