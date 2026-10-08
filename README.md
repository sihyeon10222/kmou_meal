# KMOU Meal

국립한국해양대학교 기숙사·학식 스낵코너·교직원 식당 식단을 Instagram Story와 주간 게시물로 만드는 Node.js + TypeScript 프로젝트입니다. 승선생활관도 매일 Story와 주간 게시물로 제공합니다.

## 실행 명령

| 명령 | 동작 |
| --- | --- |
| `npm run preview` | 오늘 Story 전체 미리보기, 업로드 없음 |
| `npm run story` | 오늘 Story 전체 실제 게시 |
| `npm run feed -- --preview` | 대상 주 게시물 전체 미리보기 |
| `npm run feed` | 대상 주 게시물 전체 실제 게시 |

`npm start`도 `npm run story`와 같습니다. 별도 옵션이 없으면 모든 식당을 처리합니다.
기숙사·승선생활관·교직원 전체 Story는 아침·점심·저녁을 한 장에, 학식은 네 코너를 한 장에 표시합니다.

### 공통 옵션

| 옵션 | 값 / 의미 |
| --- | --- |
| `--restaurant` | Story: `all`(기본), `dormitory`, `badaro`, `snack`, `teacher`. Feed: `all`(기본), `combined`, `badaro`, `dormitory` |
| `--date YYYY-MM-DD` | Story는 해당 날짜, feed는 월~토에 해당 주·일요일에 다음 주. 생략하면 한국시간 오늘 |
| `--preview` | 이미지 생성만 수행. Supabase·Instagram·게시 기록에 접근하지 않음 |

Story 전용: `--meal full|breakfast|lunch|dinner`. 기본은 `full`이며 끼니를 선택할 때는 식당도 지정합니다. Snack은 항상 네 코너 한 장입니다.

Feed 전용: `--week YYYY-Www`로 정확한 주차를 지정하거나 `--force`로 성공한 게시물을 재게시합니다. `--date`와 `--week`는 동시에 지정하지 않습니다.
주간 게시물은 메뉴가 있는 식당부터 게시합니다. 빈 날짜는 `등록된 식단 없음`으로 표시하고, 한 식당이 통째로 비어 있으면 통합 게시물에서 그 식당 이미지는 제외합니다. 게시한 식단에서 한국시간 내일 이후의 빈 끼니에 메뉴가 추가된 경우에만 새 게시물을 올리고 이전 게시물은 수동으로 삭제합니다. 메뉴 수정·삭제만으로는 재게시하지 않습니다.

```bash
# 기숙사 저녁 미리보기
npm run preview -- --restaurant dormitory --meal dinner

# 승선생활관 아침·점심·저녁 전체 Story 미리보기
npm run preview -- --restaurant badaro

# 승선생활관 아침 Story 실제 게시
npm run story -- --restaurant badaro --meal breakfast

# 특정 날짜의 교직원 전체 Story 미리보기
npm run preview -- --restaurant teacher --date 2026-09-21

# 특정 날짜 학식 Story 실제 게시
npm run story -- --restaurant snack --date 2026-09-21

# 특정 주차의 기숙사 게시물 미리보기
npm run feed -- --preview --restaurant dormitory --week 2026-W39

# 대상 주 학식+교직원 통합 게시물 실제 게시
npm run feed -- --restaurant combined

# 대상 주 승선생활관 게시물 미리보기
npm run feed -- --preview --restaurant badaro
```

잘못된 날짜·옵션은 게시 전에 실패 종료합니다. 긴 모드명(`today_dormitory_full` 등)과 실행 제어 환경변수(`RUN_MODE`, `BASE_DATE` 등)는 CLI 입력에 사용하지 않습니다.

## 설치와 WebStorm

Node.js 24.x와 npm을 사용합니다.

```bash
git clone https://github.com/sihyeon10222/kmou_meal.git
cd kmou_meal
npm ci
npx playwright install chromium
npm run preview
```

WebStorm에서 **File → Open**으로 프로젝트를 열고 **View → Tool Windows → Terminal**에서 명령을 실행합니다. Linux의 Chromium 시스템 라이브러리는 `npx playwright install --with-deps chromium`으로 설치합니다.

결과는 `output/`에 저장됩니다. Story는 1080×1920 JPEG, 게시물은 1080×1440 JPEG입니다. HTML·식단 JSON·실행 기록도 저장합니다. 기숙사와 승선생활관 게시물은 각각 2160×1440 마스터를 중앙에서 그대로 나눈 두 장의 파노라마 캐러셀입니다. 목요일 칸도 다른 요일과 폭이 같으며, 중앙에서 글자가 잘리는 것은 의도된 디자인입니다.

학식 Story의 두 열은 긴 메뉴명 때문에 화면 밖으로 늘어나지 않도록 고정된 폭 안에서 글자 크기를 조절합니다. 최소 글자 크기에서도 담을 수 없는 식단은 게시 전에 실패하며, 진단용 `.failed.png`·`.failed.html`과 원본 `.menu.json`을 Artifact에 보관합니다.

## AI 음식 사진 (Cloudflare Workers AI)

학생생활관·승선생활관·교직원식당 Story에 끼니별 가상 식판 사진을 넣을 수 있습니다. 아침 음식 사진은 승선생활관만 생성하며, 학생생활관·교직원식당 아침은 기존 메뉴 텍스트만 표시합니다. 기본은 비활성화이며, `.env`에 아래 값을 설정하면 일반 실행과 미리보기 모두 적용됩니다. 학식과 주간 피드는 적용 대상이 아닙니다.

```dotenv
STORY_AI_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=<Cloudflare 계정 ID, 32자리>
CLOUDFLARE_API_TOKEN=<Workers AI 실행 권한이 있는 API 토큰>
```

계정 ID는 Cloudflare 대시보드에서 확인합니다. API 토큰은 `Workers AI: Read` 권한이 필요합니다. 자동 게시에는 동일한 세 이름의 GitHub Actions Secrets를 설정하세요. 기존 `npm run secrets:sync`도 이 세 설정을 함께 등록합니다. 이 명령은 기존 게시 인증 설정 역시 필요합니다.

```bash
# 음식 사진을 포함한 미리보기. Instagram에 게시하지 않지만 Cloudflare 호출 비용은 발생할 수 있습니다.
npm run preview -- --restaurant dormitory --date 2026-10-08
```

모델은 `@cf/black-forest-labs/flux-2-klein-4b`입니다([Cloudflare 입력 형식 문서](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/)). 한글 메뉴를 Cloudflare Workers AI의 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`로 영어 음식 설명으로 번역한 뒤, 식판 형태 프롬프트와 해당 끼니의 메뉴만 전달해 **음식이 담긴 식판 전체를 한 번에 생성**합니다. 고정 식판 이미지·참고 이미지·칸별 좌표 배정·칸별 마스크·음식 오버레이는 사용하지 않습니다. 생성된 사진 전체를 자르거나 비율을 바꾸지 않고 스토리에 배치합니다. 스토리의 끼니 배경색에 맞는 단색 배경을 요청하지만, 실제 출력은 모델이 만든 완성 사진이며 투명 배경을 보장하지 않습니다. 음식 모습과 양은 실제 제공 사진이 아닌 AI의 예상 표현이며, 스토리에 별도 안내 문구는 넣지 않습니다.

밥·반찬은 식판의 칸에 직접 담고, 국만 연두색 원형 국그릇 하나에 담도록 요청합니다. 밥공기·반찬 접시·종이 라이너 등 추가 용기는 사용하지 않습니다. 국이 없는 메뉴에는 국그릇도 요청하지 않습니다.
일반식판은 위에서 보았을 때 왼쪽 아래 큰 칸에 밥, 오른쪽 아래 큰 칸에 국그릇, 위쪽 왼쪽·가운데 칸에 주찬과 반찬, 오른쪽 위 사각 칸에 김치를 담습니다. 원형식판은 왼쪽 큰 원형 칸에 주메뉴, 오른쪽 아래 원형 칸에 국그릇을 놓도록 별도 배치 지시를 사용합니다.

학생생활관은 점심·저녁 메뉴에 `돈가스`, `돈까스`, `커틀릿`, `파스타`, `스파게티`가 있으면 원형식판, 나머지는 일반식판을 요청합니다. 승선생활관은 아침·점심·저녁, 교직원식당은 점심·저녁에 일반식판을 요청합니다. `src/tray-profiles.ts`의 `RESTAURANT_TRAYS`에서 식당별 설정을 분리하고 있습니다. 전용 식판을 추가할 때는 새 프로필에 식판 형태 프롬프트(`prompt`), 음식 배치(`servingLayout`), 가로 1000 기준 세로 비율(`height`), `version`을 정의하면 됩니다. `ROUND_MENU_PATTERN`에서 원형식판 메뉴 판별을 조정합니다.

식판이 생성 화면의 약 94%를 차지하고, 음식은 사용 중인 칸의 80~90%를 채우도록 요청합니다. 식판 테두리와 칸막이를 얇게 해 음식 영역을 넓히며, 국그릇도 해당 칸을 넉넉히 채우도록 합니다. 배경은 아침 흰색(`#ffffff`), 점심 아이보리(`#f5f1e7`), 저녁 파란색(`#2259b1`)을 요청 앞부분에 명시하고, 바깥 여백에 그림자·그라데이션·테이블 무늬를 만들지 않도록 지시합니다. 생성 후 이미지 가장자리와 연결된 바깥 배경만 해당 끼니의 정확한 색으로 맞춥니다. 노란 식판 테두리 안쪽의 음식·국그릇은 유지하며, 스토리 표시 시 이미지 바깥쪽 2.5% 여백에만 부드러운 투명 경계를 적용해 배경과 이어지게 합니다.

사진은 메뉴 오른쪽에 220~420px 너비로 배치합니다. 긴 메뉴는 줄바꿈하며, 모든 끼니에 공통으로 적용할 수 있는 가장 큰 글자 크기(72~28px)를 먼저 선택한 다음 사진 크기를 정합니다. 사진과 텍스트를 모두 최소 크기로 줄여도 들어가지 않는 식단은 게시 전 렌더링 실패로 처리합니다.

빈 식단·휴무 안내는 생성하지 않습니다. `우유or두유` 같은 선택 메뉴는 첫 선택지로 표현하고, `밥/김치`처럼 함께 제공되는 항목은 별도 음식 항목으로 전달합니다. 스토리에 표시하는 메뉴 원문은 바꾸지 않습니다. 메뉴 정리·번역·생성 프롬프트는 `src/food-images.ts`에서 관리합니다.

메뉴 번역은 30초, 이미지 생성은 요청당 90초 제한이며, 최대 동시 2개로 실행합니다. 번역 항목 수·영어 응답을 검증하며 번역이 실패하면 해당 사진을 제외합니다. 이미지 생성 요청의 통신 오류·429·5xx는 한 번 재시도하고 인증 오류는 재시도하지 않습니다. 설정 누락이나 번역·생성·이미지 검증 실패가 발생하면 해당 끼니의 음식 사진만 제외하고 기존 식단을 게시합니다. `.run.json`과 Actions Summary의 `aiImages`에는 `generated`·`cached`·`skipped`·`failed` 상태를 남깁니다. AI 사진 실패만으로 CLI를 실패 종료하거나 정상 게시를 재실행하지 않습니다.

완성 사진 PNG는 `output/food-cache/`에 저장하고 Actions 실행 사이에도 캐시를 복원합니다. 식당·날짜·끼니·메뉴·식판 설정·모델·프롬프트가 같으면 전체/단일 끼니 미리보기와 실제 게시에서 재사용합니다. 해당 파일을 지우면 다시 생성합니다. 원본 메뉴 JSON에는 큰 이미지 데이터 대신 크기와 캐시 파일 경로를 남기고, 렌더링 HTML에는 이미지를 포함합니다. Actions Artifact에도 완성 사진 PNG를 보관합니다. 이전 칸별 합성 사진과 캐시 키를 분리해 옛 이미지를 재사용하지 않습니다.

## 자동화: 예약은 두 개

| 시간 (Asia/Seoul) | Workflow | 순서 |
| --- | --- | --- |
| 매일 07:00 | `daily.yml` | 당일 기숙사 전체 → 승선생활관 전체 → 학식 → 교직원 전체 Story |
| 매일 18:00 | `weekly.yml` | 일요일에는 다음 주, 월~토에는 해당 주의 세 게시물을 확인하고 미래의 빈 끼니에 식단이 추가된 종류만 게시 |

Story와 게시물은 독립적으로 실행됩니다. 주말 대상 학식·교직원 Story는 건너뛰고 기숙사·승선생활관은 매일 처리합니다. 정상 조회에서 메뉴가 없으면 실제 게시에서도 `등록된 식단 없음` 안내 이미지를 올립니다. 학교가 미운영 안내를 메뉴 칸에 넣으면 그 문구를 그대로 표시합니다. HTTP·파싱·응답 날짜 오류를 빈 식단으로 처리하지 않습니다.

Story 실행 결과는 Actions Summary와 `.run.json`에 남습니다. 실패는 `fetch`·`render`·`publish` 단계로 구분하고, 정상 빈 식단 게시도 표시합니다. 게시 후 기록 저장/활성 Story 확인에 실패하면 `published`와 게시물 ID를 보존하고 경고를 남깁니다. 이 경고도 확인이 필요하므로 CLI는 종료 코드 1을 반환합니다. 성공/경고 항목을 포함한 전체 배치를 다시 실행하면 중복 게시되므로 실패한 식당만 선택하세요. 게시 응답이 유실된 경우에는 계정과 `.publish.json`부터 확인하세요.

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

일요일 게시물 URL:

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

- **Daily KMOU Stories**: `restaurant`, `meal`, `date`, `preview`. `restaurant=all`, `meal=all`이면 네 식당 전체를 실행합니다.
- **KMOU Weekly Feed**: `restaurant` (`all`, `combined`, `badaro`, `dormitory`), `date` 또는 `week`, `preview`, `force`.

Daily의 preview 기본값은 false, Weekly의 기본값은 true입니다. 실제 게시하려면 preview를 해제합니다. 동일 계정의 게시 workflow는 하나의 대기열을 공유합니다.

```bash
gh workflow run daily.yml --ref main -f preview=true -f date=2026-09-21
gh workflow run weekly.yml --ref main -f restaurant=all -f preview=true -f week=2026-W39
```

## 인증 설정

미리보기에는 인증 정보가 필요 없습니다. 실제 게시 시 `.env.example`을 참고해 `.env`를 작성하고 GitHub **Settings → Secrets and variables → Actions**에 같은 이름의 Secrets를 등록합니다.

| 변수 | 역할 |
| --- | --- |
| `IG_ACCESS_TOKEN` | Instagram 게시 토큰 |
| `IG_USER_ID` | 게시 계정 ID |
| `SUPABASE_URL` | Supabase 프로젝트 주소 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 키 |
| `SUPABASE_BUCKET` | Public 버킷 이름, 보통 `stories` |
| `SUPABASE_SECRET_KEY` | 선택. 설정하면 service_role 키보다 우선 |

인증 변수 이름은 유지합니다. 실행 옵션은 CLI나 Actions 입력으로만 전달하며 인증 정보는 로그·Git에 저장하지 않습니다.

```bash
npm run check-setup
npm run secrets:sync -- sihyeon10222/kmou_meal
```

## 게시 정책

- Story는 같은 날짜에도 재게시할 수 있습니다. 이미지와 게시 기록은 실행별 UUID 경로를 사용합니다.
- 주간 게시물은 ISO 주차·게시물 종류별로 마지막 게시 식단 원본과 해시를 기록합니다. 일요일 18시부터 토요일 18시까지 매일 확인하며, 한국시간 내일 이후의 빈 끼니(학식은 분식코너·정식 각각)에 메뉴가 처음 생긴 종류만 새로 게시합니다. 메뉴 수정·삭제 또는 오늘까지의 식단 추가는 재게시하지 않습니다. 재게시할 때 오늘까지는 기존 게시 내용을 유지하고 내일부터는 최신 식단을 반영합니다. 최초 게시도 미래 메뉴가 없으면 `대기`로 기록합니다. 원본이 없는 기존 기록은 자동 재게시하지 않으며 새 방식으로 최초 게시한 주차부터 적용합니다. 한 종류의 조회·게시 실패는 다른 종류를 막지 않습니다.
- 주간 이미지 제목은 기숙사·승선생활관·학식·교직원식당으로 표시하며, 제목과 날짜는 같은 줄에 72px로 배치합니다. 날짜는 `9/28 ~ 10/4`처럼 식당 이름 바로 오른쪽에 24px 간격으로 표시합니다. 재게시 이미지의 식당 이름 아래와 본문에는 한국시간 실행 날짜의 변경 안내를 추가합니다. 파노라마의 날짜·변경 안내는 첫 번째 이미지에만 표시합니다. `--force`는 수동 재게시를 허용하며 기존 게시물이 있으면 변경 안내를 표시합니다. `--date`와 `--week`는 대상 주차만 정하고 변경일·미래 판단에는 실제 실행 날짜를 사용합니다.
- `combined`: 월~금 학식 분식코너·정식(양식·라면 제외), 교직원 아침·점심·저녁을 각각 3:4 이미지로 만듭니다. 한 식당에 메뉴가 전혀 없으면 다른 식당의 이미지만 한 장 게시하고, 나중에 메뉴가 생기면 두 장짜리 캐러셀로 재게시합니다.
- `badaro`, `dormitory`: 각각 월~일 아침·점심·저녁 파노라마 캐러셀입니다. 모든 주간 이미지의 빈 끼니는 `등록된 식단 없음`으로 표시합니다.
- 기존 기숙사 성공 기록은 유지합니다. 과거 `snack`·`teacher` 개별 게시물 기록은 새 `combined` 게시물과 별개이므로 통합 게시물의 성공 기록으로 간주하지 않습니다.
- Supabase `_weekly/주차/식당/lock.json`으로 동시 게시를 막습니다. 결과가 불확실하면 잠금을 유지합니다. Instagram과 실행 기록을 확인해 성공 기록을 복구하거나 미게시를 확인한 뒤 잠금을 해제합니다.
- 교체 게시 후에는 GitHub의 `KMOU 주간 게시물 교체 알림` 이슈에 기존·새 게시물 ID와 수동 삭제 안내를 남깁니다. 이 이슈를 구독하고 GitHub 알림을 켜야 알림을 받을 수 있습니다. Actions Summary에도 같은 삭제 안내를 표시합니다. 이슈 알림 실패는 다음 실행에서 재시도하며 새 게시물을 다시 올리지는 않습니다.
- Instagram `24/2207006`만 새 container로 한 번 복구합니다. 다른 오류나 게시 응답 유실은 자동 재게시하지 않습니다.
- 학교 식단 조회는 연결 제한 30초·본문을 포함한 요청 제한 45초로 실행합니다. 연결 끊김·타임아웃 및 HTTP 408/429/5xx는 최대 5회 시도하며, 2/4/8/16초에 작은 무작위 지연을 더해 재시도합니다. `Retry-After`가 있으면 그만큼 기다리되 60초를 초과하는 경우 명시적으로 실패합니다. 영구 HTTP 오류와 파싱 오류는 재시도하지 않습니다.
- Instagram GET 조회는 연결 오류·타임아웃·HTTP 408/429/5xx에 최대 3회 시도합니다. 1/2초 지연과 서버 `Retry-After`를 적용하며 60초 초과 대기는 중단합니다. 인증·응답 구조 오류는 재시도하지 않습니다. 생성/게시 POST는 통신 오류 때 자동 재전송하지 않으며, 기존 24/2207006 오류의 한 번 복구만 적용합니다.
- 주간 기숙사·승선생활관 조회는 한 응답에 포함된 날짜를 같은 실행 안에서 재사용합니다. 응답에 없는 날짜는 별도 조회하며, 다음 실행은 항상 새 식단을 조회합니다. 재시도 로그에는 식당·대상 날짜·시도 횟수와 복구 성공 여부가 표시되고, 최종 실패 원인은 Actions Summary에도 남습니다. 학교 서버나 네트워크의 지속적인 장애는 실패로 보고하며 빈 식단으로 대신 게시하지 않습니다.
- Supabase Public 버킷에는 이미지·게시 기록이 저장됩니다. 비밀키는 기록하지 않습니다.

## 코드 구조와 검증

```text
cron-job.org → GitHub Actions → KMOU API / HTML 조회
→ Playwright 렌더링 → Supabase Storage → Instagram API
```

- `cli.ts`, `cli-options.ts`: 공통 명령과 옵션 해석
- `stories.ts`, `weekly.ts`: 실제 조회·렌더·게시 연결
- `run-stories.ts`, `run-weekly.ts`: 순차 실행·skip·실패 정책
- `publishing-services.ts`: 게시 서비스 지연 초기화
- `fetch-menu-text.ts`: 공통 조회 재시도
- `render-assets.ts`: 공통 폰트·HTML 처리
- `.github/actions/setup`: 공통 Node.js·Chromium 설치

```bash
npm run typecheck
npm test
npm run build
```

`npm run fetch-menu -- YYYY-MM-DD`는 기숙사 조회 진단 전용입니다.
