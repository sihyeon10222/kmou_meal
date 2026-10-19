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

Story 전용: `--meal full|breakfast|lunch|dinner`. 기본은 `full`이며 끼니를 선택할 때는 식당도 지정합니다. Snack은 항상 네 코너 한 장입니다. `--art generate|cache|off`로 음식 일러스트 생성을 제어합니다. CLI 옵션 → `STORY_ART_MODE` → 기본값 순서이며, 기본값은 실제 게시 `generate`, 로컬 미리보기 `cache`입니다.

Feed 전용: `--week YYYY-Www`로 정확한 주차를 지정하거나 `--force`로 성공한 게시물을 재게시합니다. `--date`와 `--week`는 동시에 지정하지 않습니다.
주간 게시물은 메뉴가 있는 식당부터 게시합니다. 빈 날짜는 `등록된 식단 없음`으로 표시하고, 한 식당이 통째로 비어 있으면 통합 게시물에서 그 식당 이미지는 제외합니다. 게시한 식단에서 한국시간 내일 이후의 빈 끼니에 메뉴가 추가된 경우에만 새 게시물을 올리고 이전 게시물은 수동으로 삭제합니다. 메뉴 수정·삭제만으로는 자동 재게시하지 않지만, 재게시할 때는 지난 날짜·당일을 포함한 주간 전체를 최신 식단으로 반영합니다.

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

디자인을 수정할 때마다 `npx tsx scripts/preview-weekly-design.ts`로 주간 게시물과 스토리 미리보기를 다시 생성합니다. `output/weekly-redesign/index.html`에서 네 식당의 주간 일반·빈 식단·재게시 원본과 파노라마 분할 이미지, 스토리 일반·전체/일부 빈 식단·분량 편차·긴 메뉴·개별 끼니를 확인할 수 있습니다. 이미지 주소에 생성 버전을 붙여 이전 이미지가 캐시에 남지 않게 합니다. 미리보기는 고정된 예시 식단을 사용하며 실제 게시를 실행하지 않습니다.

학식 Story의 두 열은 긴 메뉴명 때문에 화면 밖으로 늘어나지 않도록 고정된 폭 안에서 글자 크기를 조절합니다. 최소 글자 크기에서도 담을 수 없는 식단은 게시 전에 실패하며, 진단용 `.failed.png`·`.failed.html`과 원본 `.menu.json`을 Artifact에 보관합니다.

### 해양이 음식 일러스트

기숙사·승선생활관·교직원식당 Story에는 점심·저녁에서 AI가 고른 음식 한 가지씩을 해양이 위의 말풍선으로 표시합니다. 학식과 아침 단독 Story는 제외합니다. 한 끼만 있거나 점심·저녁 단독 Story이면 말풍선 하나를 표시하며, 빈 식단·미운영 안내는 음식 후보에서 제외합니다.

- 해양이는 제공된 `assets/illustrations/haeyangi.png` 원본을 그대로 사용하며 AI에 전송하거나 다시 생성하지 않습니다. 메뉴 선택은 Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, 음식 그림 생성은 `@cf/black-forest-labs/flux-2-klein-9b`를 사용합니다. 끼니별 선택을 JSON 스키마의 필수 항목으로 지정하고, 인덱스가 실제 식단에 속하는지 검사합니다. 점심·저녁이 모두 있는데 한 끼가 누락된 캐시는 재사용하지 않습니다.
- 개발 기본 해상도는 음식당 **512×512**입니다. AI는 음식 그림만 생성하며, 말풍선·Lunch/Dinner 글자·해/달 아이콘은 고정 템플릿으로 직접 합성합니다. Lunch/Dinner 글자는 Story 알약과 같은 내장 국민연금체 Bold를 사용하며 `scripts/render-story-art-headings.ts`로 투명 PNG를 생성해 실행 환경의 설치 폰트에 의존하지 않습니다. 해/달은 글자 왼쪽의 동일한 좌표에 배치하고, 음식은 제목 아래의 정해진 영역 안에 넣어 여백을 확보합니다. 자홍색 외부 배경만 투명하게 제거하며 해상도는 `createStoryArt`의 `size` 옵션(256/512/768/1024)으로 변경할 수 있습니다.
- 기존 스토리를 먼저 완성한 뒤 메뉴 줄·알약·헤더의 실제 영역을 측정합니다. 장식 전체 폭은 **최대 610px, 최소 312px**, 글자와의 거리는 최소 **16px**이며 오른쪽 점심·저녁 영역의 빈 공간에 배치합니다. 말풍선은 기존 250px에서 **최대 300px(1.2배)**로 확대하고, Lunch는 왼쪽 아래, Dinner는 오른쪽 위에 배치합니다. Dinner는 1.3배 시안보다 150px 아래로 내려 해양이와의 거리를 줄입니다. 점심·저녁 장식은 식당별 박스 높이 대신 승인된 승선생활관 미리보기의 공통 캔버스 위치를 우선 사용합니다. 해양이는 기존 340px 기준보다 1.3배인 최대 442px로 표시하고, 오른쪽 위치를 유지하며 메뉴와 겹치면 장식 전체를 축소합니다. 연결 원의 좁은 영역도 별도로 검사합니다. 메뉴 글자·상하 가운데 정렬·박스 배치는 바꾸지 않습니다. 최소 크기도 들어가지 않으면 AI 호출 없이 장식을 생략합니다.
- 말풍선과 해양이를 잇는 동그라미는 흰색 안쪽과 점심·저녁 테두리색을 사용한 3개 원을 머리 방향으로 점점 작게 합성합니다. 글자·아이콘·동그라미 배치 변경에는 AI 재생성이 필요하지 않습니다.
- 메뉴 선택과 원본 생성 결과는 `.cache/story-art/`에 저장합니다. 선택은 메뉴 목록별, 이미지는 음식명·끼니·모델·스타일 버전·해상도별로 재사용합니다. 날짜·식당·합성 위치만 바뀌면 같은 이미지를 재활용하며, 투명 배경 처리와 크기 변경에도 새 생성이 필요 없습니다. GitHub Actions에서는 실행 간에 이 캐시를 복원·저장합니다. 캐시가 만료되면 `generate`에서만 다시 생성합니다.
- 인증 누락, 선택 오류, 타임아웃, 생성·투명화 오류는 해당 장식을 생략하고 **기존 스토리 게시를 계속**합니다. 비용이 중복 발생할 수 있는 이미지 요청의 자동 재시도는 하지 않습니다. `.art.json`에 선택 메뉴·생략 사유·배치·호출/캐시 횟수를 남기고, 적용된 경우 `.base.jpg`도 보관합니다.

```bash
# 최초 음식 그림 생성 + 디자인 미리보기 (Instagram 업로드 없음)
npx tsx scripts/preview-story-art.ts generate
# 이후 배치·크기 검토는 저장된 음식 그림만 재사용
npx tsx scripts/preview-story-art.ts
# 실제 학교 메뉴를 조회하되 새 음식 그림도 생성하는 미리보기
npm run preview -- --restaurant dormitory --art generate
```

`output/story-ai/index.html`에서 세 식당·학식 제외·빈 식단·한 끼·긴 메뉴 사례를 확인합니다. 기존 `output/weekly-redesign/index.html`도 저장된 음식 그림을 사용하며 이 비교 페이지로 연결됩니다. 일반 디자인 미리보기와 자동 테스트는 새 이미지를 생성하지 않습니다. Cloudflare 공식 [Klein API 안내](https://developers.cloudflare.com/changelog/post/2026-01-28-flux-2-klein-9b-workers-ai/)의 multipart 입력과 [요금표](https://developers.cloudflare.com/workers-ai/platform/pricing/)를 기준으로 구현했습니다.

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

- **Daily KMOU Stories**: `restaurant`, `meal`, `date`, `preview`, `art`. `restaurant=all`, `meal=all`이면 네 식당 전체를 실행합니다. `art` 기본값은 `generate`이며, Actions의 미리보기에서도 실제 음식 그림을 생성합니다. 반복 디자인 확인에는 `cache`, 장식 제외에는 `off`를 선택합니다.
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
| `CLOUDFLARE_ACCOUNT_ID` | 선택. Story 음식 일러스트용 Cloudflare 계정 ID |
| `CLOUDFLARE_API_TOKEN` | 선택. 해당 계정의 Workers AI 실행 권한을 가진 토큰 |

기본 미리보기에는 인증이 필요 없으며 `--art generate`로 새 그림을 생성할 때는 Cloudflare 인증이 필요합니다. 인증 정보는 로그·Git에 저장하지 않습니다.

```bash
npm run check-setup
npm run secrets:sync -- sihyeon10222/kmou_meal
```

## 게시 정책

- Story는 같은 날짜에도 재게시할 수 있습니다. 이미지와 게시 기록은 실행별 UUID 경로를 사용합니다.
- 일반 주간 게시물 본문에는 주차·식당 소개 문구를 넣지 않습니다. 지연 안내와 식당별 해시태그만 한 줄 띄워 작성합니다. 재게시 본문은 변경 안내·지연 안내·해시태그만 순서대로 한 줄씩 띄웁니다.
- 주간 게시물은 ISO 주차·게시물 종류별로 마지막 게시 식단 원본과 해시를 기록합니다. 일요일 18시부터 토요일 18시까지 매일 확인하며, 한국시간 내일 이후의 빈 끼니(학식은 양식코너·라면코너·분식코너·정식 각각)에 메뉴가 처음 생긴 종류만 새로 게시합니다. 메뉴 수정·삭제 또는 오늘까지의 식단 추가만으로는 자동 재게시하지 않습니다. 자동·수동 재게시 시 지난 날짜·당일·미래 날짜 모두 최신 조회 결과를 반영합니다. 예를 들어 수요일 재게시에는 화요일 수정본도 포함됩니다. 실제 게시한 최신 식단을 다음 비교 기준으로 저장합니다. 최초 게시도 미래 메뉴가 없으면 `대기`로 기록합니다. 원본이 없는 기존 기록은 자동 재게시하지 않으며 새 방식으로 최초 게시한 주차부터 적용합니다. 한 종류의 조회·게시 실패는 다른 종류를 막지 않습니다.
- 주간 이미지 제목은 기숙사·승선생활관·학식·교직원식당으로 72px로 표시합니다. 날짜는 `9/28 ~ 10/4`처럼 식당 이름 바로 오른쪽에 실제 글자 기준 64px 간격, 64px 크기로 같은 기준선에 배치합니다. 재게시 이미지의 식당 이름 아래에는 한국시간 실행 날짜의 변경 안내를 빨간색 28px로 추가하며 본문에도 변경일을 표시합니다. 파노라마 헤더는 전체 원본 너비를 기준으로 배치하며 가운데 절단선을 피하지 않습니다. `--force`는 수동 재게시를 허용하며 기존 게시물이 있으면 변경 안내를 표시합니다. `--date`와 `--week`는 대상 주차만 정하고 변경일·미래 판단에는 실제 실행 날짜를 사용합니다.
- 주간 게시물과 Story는 내장 국민연금체 폰트와 `#F6F8FB` 단색 배경을 사용합니다. 메뉴 박스는 아침 `#FFFFFF`, 점심·학식 모든 코너 `#DAE9FF`, 저녁 `#2259B1`의 불투명 단색이며, 블러 없이 48px 둥근 모서리를 사용하며, 상단 하이라이트·하단 음영과 은은한 바깥 그림자로 입체감을 줍니다. 일반 메뉴 글자는 `#183D44`, 저녁은 흰색입니다. 주간 저녁 박스의 요일별 세로 구분선은 흰색 28%로 표시합니다. 경계 라벨은 흰색 덮임 22%, 3px 블러와 그림자를 유지합니다. 식당 이름은 국민연금체 ExtraBold 800으로 표시하며 없는 문자는 내장 Pretendard로 보완합니다. 폰트는 실행 폴더와 무관하게 HTML에 내장하고 배경 사진은 읽지 않으므로 GitHub Actions에서도 외부 다운로드 없이 렌더링합니다.
- 주간 끼니 제목은 행 왼쪽 상단 경계에 한 번만 표시하며 나머지 요일에 제목 공간을 남기지 않습니다. 제목의 실제 글자 상단·좌측 여백은 64px입니다. 이름 72px·날짜 64px 사이 간격은 실제 글자 기준 64px, 재게시 안내는 기존 제목·요일 사이 여백 안에 배치해 헤더 높이나 표 위치를 변경하지 않습니다. 요일은 Mon~Sun만 28px로 표시하며 원래 위치에서 글자만 8px 위로 이동해 헤더 끝까지 56px, 아래 박스 경계까지 32px를 확보합니다. 표의 좌우·하단 여백과 끼니 행 사이는 24px입니다. 셀은 위 32px, 좌우·아래 최소 16px를 확보하고 같은 끼니는 모든 요일에서 행 높이와 메뉴 크기를 공유합니다. 메뉴는 18~30px, 자간 0, 줄간격 1.4, 항목 간격 0.25em으로 한 줄을 우선합니다. `+` 추가 구성은 별도 줄로 내려갈 수 있으며 일반 메뉴명은 18px에서도 가로로 들어가지 않을 때만 줄바꿈합니다. 분량이 많은 끼니에 더 높은 행을 배분합니다. `등록된 식단 없음`은 칸 안에서 좌우 가운데 정렬하고 한 줄과 최대 24px를 유지하되 파노라마에서는 30px로 표시합니다. 전체 빈 식단은 행 높이를 균등 배분하고 최소 크기에서도 넘치면 렌더링을 실패시킵니다.
- Story는 48px 둥근 박스와 경계 라벨을 사용합니다. 끼니·코너 라벨은 36px 글자, 48px 높이와 좌우 18px 안쪽 여백으로 표시합니다. 알약 하단부터 메뉴까지 최소 40px를 확보하기 위해 메뉴의 상하 여백은 최소 64px로 둡니다. 헤더 상단 164px를 유지하고 실제 글자가 188px보다 위에 나타나지 않게 보정하며 제목의 실제 좌측 여백과 식당 이름·날짜 사이 간격은 각각 64px입니다. 박스 바깥 좌우·하단 및 행 사이 간격은 32px이며 메뉴 내부 사방 최소 여백도 32px입니다. 헤더 실제 글자 끝에서 첫 라벨까지 32px를 둡니다. 한 이미지의 일반 메뉴 크기는 28~48px 범위에서 통일하고 자간 0, 줄간격 1.25, 항목 간격은 기존 크기 비례 규칙을 사용합니다. 빈 식단 안내는 부분적으로 빈 경우에도 최대 36px로 제한합니다. 메뉴의 실제 글자 상하 여백을 같게 가운데 정렬하며 박스 높이는 내용에 비례해 배분합니다. 학식은 열·행 사이 간격을 모두 32px로 통일하고 같은 높이의 두 행을 유지합니다. 빈 식단 안내는 줄바꿈 없이 상하·좌우 가운데 정렬하며 모두 비어 있으면 높이를 균등 배분합니다. 일반 메뉴명은 줄바꿈하지 않으며 `+` 앞에서만 분리할 수 있고 최소 크기에서도 넘치면 게시 전에 실패합니다.
- `combined`: 월~금 학식은 위에서부터 양식코너 → 라면코너 → 분식코너 → 정식 순서로 한 장에 표시하고, 교직원 아침·점심·저녁은 별도의 3:4 이미지로 만듭니다. 각 코너의 메뉴량에 따라 행 높이와 메뉴 글자 크기를 자동 조절합니다. 한 식당에 메뉴가 전혀 없으면 다른 식당의 이미지만 한 장 게시하고, 나중에 메뉴가 생기면 두 장짜리 캐러셀로 재게시합니다.
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
- `render-browser.ts`: 지연 실행·재연결·종료를 관리하는 공통 Chromium 수명 관리
- `render-weekly.ts`: 배치 안에서 브라우저를 재사용하고 이미지마다 독립된 페이지를 해제
- `.github/actions/setup`: 공통 Node.js·Chromium 설치

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

타입 검사는 `src/`뿐 아니라 `scripts/`와 `tests/`에도 적용하며, 빌드 출력은 기존처럼 `src/`만 `dist/`에 생성합니다. CI와 두 게시 workflow도 같은 검증을 실행합니다.

`npm run benchmark -- current`는 고정 식단으로 주간 전체·장식 없는 Story 4장·모의 식단 조회를 측정하고 `output/benchmark/current/results.json`에 시간·브라우저/캡처 횟수·이미지 SHA-256을 저장합니다. 한 번 준비 실행 후 다섯 번의 중앙값을 사용하며 외부 조회·업로드·AI 생성을 실행하지 않습니다. 이전 결과와 이미지 바이트까지 비교하려면 `npm run benchmark -- current 경로/before/results.json`으로 실행합니다. [전체 코드 분석과 최적화 결과](docs/OPTIMIZATION_AUDIT_2026-10-12.md)에 변경 근거와 측정 조건을 기록했습니다.

`npm run fetch-menu -- YYYY-MM-DD`는 기숙사 조회 진단 전용입니다.

재게시 시 마지막 성공 기록의 원본과 비교해 지난 날짜·당일·미래 날짜의 끼니에 새로 추가되거나 수정된 메뉴 항목만 변경 안내와 같은 빨간색(`#FF5F5F`)으로 표시합니다. 순서 이동·공백만 바뀐 항목과 그대로 유지된 항목은 원래 색을 유지합니다. 비교 원본이 없는 기록에서는 메뉴 차이를 추정하지 않습니다. 강조 정보는 렌더링에만 사용하고 성공 기록의 식단 원본과 해시에는 포함하지 않습니다.
