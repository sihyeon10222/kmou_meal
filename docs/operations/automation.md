# 자동화: 예약은 두 개

| 시간 (Asia/Seoul) | Workflow | 순서 |
| --- | --- | --- |
| 매일 07:00 | `daily.yml` | 당일 기숙사 전체 → 승선생활관 전체 → 학식 → 교직원 전체 Story |
| 매일 18:00 | `weekly.yml` | 일요일에는 다음 주, 월~토에는 해당 주의 세 게시물을 확인하고 미래의 빈 끼니에 식단이 추가된 종류만 게시 |

Story와 게시물은 독립적으로 실행됩니다. 주말 대상 학식·교직원 Story는 건너뛰고 기숙사·승선생활관은 매일 처리합니다. 정상 조회에서 메뉴가 없으면 실제 게시에서도 `등록된 식단 없음` 안내 이미지를 올립니다. 학교가 미운영 안내를 메뉴 칸에 넣으면 그 문구를 그대로 표시합니다. HTTP·파싱·응답 날짜 오류를 빈 식단으로 처리하지 않습니다.

Story 실행 결과는 Actions Summary와 `.run.json`에 남습니다. 실패는 `fetch`·`render`·`publish` 단계로 구분하고, 정상 빈 식단 게시도 표시합니다. 게시 후 기록 저장/활성 Story 확인에 실패하면 `published`와 게시물 ID를 보존하고 경고를 남깁니다. 이 경고도 확인이 필요하므로 CLI는 종료 코드 1을 반환합니다. 성공/경고 항목을 포함한 전체 배치를 다시 실행하면 중복 게시되므로 실패한 식당만 선택하세요. 게시 응답이 유실된 경우에는 계정과 `.publish.json`부터 확인하세요.

AI 음식 장식의 적용·생략·실패도 Actions Summary의 `AI 장식` 열과 `.run.json`의 `art`에 남습니다. AI 실패 시 기본 식단 Story가 게시되면 결과를 경고로 표시하되 CLI 종료 코드는 바꾸지 않습니다. 이 경우 이미 게시된 Story를 다시 실행하면 중복 게시됩니다. `.art.json`에서 실패 사유와 호출/캐시 횟수를 확인하고, Cloudflare HTTP 오류의 단계·모델·오류 코드·`cf-ray`로 제공자 문제를 조사하세요.

cron-job.org에서 시간대를 **Asia/Seoul**, 메서드를 **POST**로 설정합니다. Weekly 예약은 요일 전체를 선택해 매일 18:00에 실행합니다. 기존 세 예약 작업은 비활성화하고 Daily·Weekly 두 작업만 사용합니다.

공통 헤더:

```text
Authorization: Bearer <GitHub PAT>
Accept: application/vnd.github+json
Content-Type: application/json
X-GitHub-Api-Version: 2022-11-28
```

PAT에는 해당 저장소의 Actions 읽기/쓰기 권한이 필요합니다.

매일 Story URL:

```text
https://api.github.com/repos/sihyeon10222/kmou_meal/actions/workflows/daily.yml/dispatches
```

```json
{
  "ref": "main",
  "inputs": { "preview": "false" }
}
```

주간 피드 URL:

```text
https://api.github.com/repos/sihyeon10222/kmou_meal/actions/workflows/weekly.yml/dispatches
```

```json
{
  "ref": "main",
  "inputs": {
    "restaurant": "all",
    "preview": "false",
    "force": "false"
  }
}
```

예약 본문에는 날짜를 고정하지 않습니다. **이전 입력 `run_mode`, `preview_only`, `kind`, `force_publish`, `base_date`, `target_week`는 제거됐으므로 위 본문으로 교체해야 합니다.**

요청 접수와 실제 게시는 다릅니다. **GitHub → Actions → 실행 기록**에서 성공 여부와 Artifacts의 이미지·JSON을 확인합니다. Artifact는 7일 보관됩니다.

### GitHub 수동 실행

자동 운영에는 `daily.yml`, `weekly.yml`, `ci.yml` 세 workflow가 있습니다. 앞의 두 개가 실제 실행이고 `ci.yml`은 코드 검증 전용입니다. **Actions → Daily KMOU Stories → Run workflow**에서 전체 또는 개별 Story를 실행할 수 있습니다.

- **Daily KMOU Stories**: `restaurant`, `meal`, `date`, `preview`, `art`. `restaurant=all`, `meal=all`이면 네 식당 전체를 실행합니다. `art` 기본값은 `generate`이며, Actions의 미리보기에서도 실제 음식 그림을 생성합니다. 반복 디자인 확인에는 `cache`, 장식 제외에는 `off`를 선택합니다.
- **KMOU Weekly Feed**: `restaurant` (`all`, `combined`, `badaro`, `dormitory`), `date` 또는 `week`, `preview`, `force`.

Daily의 preview 기본값은 false, Weekly의 기본값은 true입니다. 실제 게시하려면 preview를 해제합니다. 동일 계정의 게시 workflow는 하나의 대기열을 공유합니다.

```bash
gh workflow run daily.yml --ref main -f preview=true -f date=2026-09-21
gh workflow run weekly.yml --ref main -f restaurant=all -f preview=true -f week=2026-W39
```

