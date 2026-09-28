import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPublishingServices } from './publishing-services.js';
import { createWeeklyFetcher, WEEKLY_KINDS, type WeeklyKind, type WeeklyRange } from './weekly-data.js';
import { renderWeekly } from './render-weekly.js';
import { runWeekly } from './run-weekly.js';
import { markWeeklySourceEmpty, postWeekly, publishedWeekly } from './post-weekly.js';
import { notifyWeeklyReplacements } from './weekly-notifications.js';
import { safeError } from './config.js';

export async function executeWeekly(range: WeeklyRange, kind: WeeklyKind | 'all', preview: boolean, force = false) {
  await mkdir('output', { recursive: true });
  const getServices = createPublishingServices();
  const results = await runWeekly(range, kind, preview, force, {
    fetch: createWeeklyFetcher(),
    render: renderWeekly,
    published: async (week, current) => publishedWeekly((await getServices()).storage, week, current),
    post: async (data, images, forcePublish) => {
      const { storage, instagram } = await getServices();
      return postWeekly(data, images, forcePublish, storage, instagram, async record => {
        await writeFile(`output/${data.week}-${data.kind}-${record.runId}.publish.json`, JSON.stringify(record, null, 2));
      });
    },
  });
  await writeFile(`output/${range.week}-weekly-${randomUUID()}.run.json`, JSON.stringify({ range, kind, preview, force, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = [`## 주간 식단 ${range.week}`, '', '| 종류 | 결과 | 게시물 ID |', '| --- | --- | --- |',
      ...results.map(result => `| ${result.kind} | ${result.status} | ${result.mediaId ?? '-'} |`), ''];
    for (const result of results.filter(item => item.replacedMediaId)) {
      lines.push(`- **${result.kind}: 기존 게시물 ${result.replacedMediaId}을 Instagram에서 직접 삭제해 주세요. 새 게시물: ${result.mediaId}**`);
    }
    for (const result of results.filter(item => item.status === 'deferred' && item.mediaId)) {
      lines.push(`- **${result.kind}: 학교 식단이 모두 비어 있습니다. 기존 게시물 ${result.mediaId}을 확인하고 필요하면 수동 삭제해 주세요.**`);
    }
    await appendFile(summary, `${lines.join('\n')}\n`);
  }
  if (!preview) {
    try {
      const { storage } = await getServices();
      for (const result of results.filter(item => item.status === 'deferred' && item.mediaId)) {
        await markWeeklySourceEmpty(storage, range.week, result.kind);
      }
      await notifyWeeklyReplacements(storage, range.week, kind === 'all' ? WEEKLY_KINDS : [kind]);
    } catch (error) {
      if (summary) await appendFile(summary, `\n⚠️ GitHub 이슈 알림 실패: 다음 실행에서 재시도합니다. ${safeError(error)}\n`);
      throw error;
    }
  }
  return results;
}
