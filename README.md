# KMOU Meal

국립한국해양대학교 **기숙사 식당 · 학식 스낵코너 · 교직원 식당**의 식단을 조회해 Instagram **Story와 주간 피드**로 게시하는 Node.js + TypeScript 프로젝트입니다. Story는 1080 × 1920, 주간 피드는 1080 × 1440 JPEG를 사용합니다.

## 작동 흐름

```text
cron-job.org → GitHub Actions → KMOU 식단 조회·정리
→ Playwright 이미지 렌더링 → Supabase Storage → Instagram API 게시
```

| 구성 | 역할 |
| --- | --- |
| Node.js 24 / TypeScript | 실행 모드, 대상 날짜, 식당별 순차 처리 |
| KMOU 식단 API / Cheerio | 기숙사 식단 조회, 학식 POST HTML 파싱 및 가격 제거 |
| HTML / CSS / Playwright / Sharp | 한글 식단 이미지 렌더링과 주간 파노라마 분할 |
| Supabase Storage | 이미지 공개 URL과 실행별 게시 기록 저장 |
| Instagram Login API | Story·단일 피드·캐러셀 container 생성, 게시 및 결과 확인 |
| cron-job.org / GitHub Actions | 한국시간 예약 호출 및 클라우드 실행 |

## 빠른 시작: 업로드 없이 미리보기

Node.js **24.x**와 npm이 필요합니다. 저장소 접근 권한이 있는 계정으로 복제합니다.

```bash
git clone https://github.com/sihyeon10222/kmou_meal.git
cd kmou_meal
npm ci
npx playwright install chromium

# 오늘 세 식당의 점심 이미지 생성
npm run preview -- today_lunch_batch

# 개별 식당 이미지 생성
npm run preview -- today_snack
npm run preview -- today_teacher_full
npm run preview -- today_dormitory_full
npm run preview -- today_dormitory_breakfast
npm run preview -- today_teacher_breakfast
```

Linux에서 Chromium 시스템 라이브러리 설치가 필요하면 `npx playwright install --with-deps chromium`을 사용합니다.

**모든 `npm run preview`는 Supabase 업로드와 Instagram 게시를 하지 않으며, 인증 정보 없이 실행할 수 있습니다.** 식단 조회를 위한 인터넷 연결은 필요합니다. 주말 대상 스낵·교직원 식당은 미리보기에서도 건너뜁니다.

결과는 `output/`에 저장됩니다.

- `YYYY-MM-DD-모드.jpg`: 생성된 이미지
- 같은 이름의 `.html`: 디자인 확인용 페이지
- `.json`: 식단 데이터와 실행 결과; 실제 게시 시 게시 기록도 저장

WebStorm에서는 **File → Open**으로 프로젝트 폴더를 열고, **Settings → Languages & Frameworks → JavaScript Runtime**에서 Node.js 24를 선택합니다. **View → Tool Windows → Terminal**에서 위 명령을 실행하고 `output/`의 이미지를 열면 됩니다. 설정 항목 이름은 WebStorm 버전에 따라 Node.js로 표시될 수 있습니다.

## 실행 명령과 모드

```bash
npm run preview -- <모드> [YYYY-MM-DD]  # 이미지 생성만
npm start -- <모드> [YYYY-MM-DD]        # 실제 업로드·게시
```

날짜는 **기준일**이며 생략하면 한국시간 오늘을 사용합니다. `today_`는 기준일, `tomorrow_`는 기준일 다음 날의 식단을 처리합니다. 모드를 생략하면 `RUN_MODE` 환경변수, 그마저 없으면 `tomorrow_full_batch`를 사용합니다.

```bash
# 2026-09-18의 교직원 전체 식단 미리보기
npm run preview -- today_teacher_full 2026-09-18

# 기준일 다음 날인 2026-09-21의 세 식당 미리보기
npm run preview -- tomorrow_full_batch 2026-09-20

# 오늘 기숙사 점심 실제 게시 (인증 설정 필요)
npm start -- today_dormitory_lunch

# 기본 모드: 내일 세 식당 전체 식단 실제 게시
npm start
```

### 배치 모드 3개

| 모드 | 처리 순서 |
| --- | --- |
| `today_lunch_batch` | 오늘 기숙사 점심 → 스낵 → 교직원 점심 |
| `today_dinner_batch` | 오늘 기숙사 저녁 → 교직원 저녁 |
| `tomorrow_full_batch` | 내일 기숙사 전체 → 스낵 → 교직원 전체 |

### 개별 Story 모드 18개

| 식당 / 구성 | 오늘 | 내일 |
| --- | --- | --- |
| 기숙사 아침 | `today_dormitory_breakfast` | `tomorrow_dormitory_breakfast` |
| 기숙사 점심 | `today_dormitory_lunch` | `tomorrow_dormitory_lunch` |
| 기숙사 저녁 | `today_dormitory_dinner` | `tomorrow_dormitory_dinner` |
| 기숙사 전체: 아침 + 점심 + 저녁 | `today_dormitory_full` | `tomorrow_dormitory_full` |
| 스낵: 양식·정식·라면·분식 한 장 | `today_snack` | `tomorrow_snack` |
| 교직원 아침 | `today_teacher_breakfast` | `tomorrow_teacher_breakfast` |
| 교직원 점심 | `today_teacher_lunch` | `tomorrow_teacher_lunch` |
| 교직원 저녁 | `today_teacher_dinner` | `tomorrow_teacher_dinner` |
| 교직원 전체: 아침 + 점심 + 저녁 | `today_teacher_full` | `tomorrow_teacher_full` |

### 기타 명령

| 명령 | 역할 |
| --- | --- |
| `npm run fetch-menu -- [YYYY-MM-DD]` | 기숙사 식단 조회 전용 |
| `npm run check-setup` | 게시 없이 Instagram 계정·Storage 설정 확인 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm test` | 파싱·날짜·실행·렌더링·게시 정책 테스트 |
| `npm run build` | TypeScript 컴파일 |

## 실제 게시 설정

미리보기만 사용할 때는 이 설정이 필요하지 않습니다.

```bash
cp .env.example .env
```

`.env`에 다음 값을 설정합니다. 기존 `.env`가 있다면 덮어쓰지 말고 필요한 값만 수정합니다.

| 변수 | 내용 |
| --- | --- |
| `IG_ACCESS_TOKEN` | Instagram Login API 게시 권한이 있는 Access Token |
| `IG_USER_ID` | 게시할 Instagram 계정 ID |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버용 service_role 키 |
| `SUPABASE_SECRET_KEY` | 선택: 서버용 Secret key. 설정하면 service_role보다 우선 |
| `SUPABASE_BUCKET` | Public 버킷 이름. 기본값 `stories` |

Supabase Storage에 Public 버킷을 준비하고 서버용 키를 사용합니다. `.env`와 비밀키는 Git에 커밋하지 않습니다.

```bash
npm run check-setup
npm start -- today_dormitory_lunch
```

이미지는 `날짜/모드/실행별UUID.jpg`, 게시 기록은 `_posts/날짜/모드/runId.json`으로 저장됩니다. Public 버킷이므로 게시 기록도 공개 URL로 접근할 수 있습니다. 기록에는 비밀키를 저장하지 않습니다.

## 자동화: cron-job.org + GitHub Actions

GitHub 자체 `schedule` 대신 cron-job.org가 GitHub의 `workflow_dispatch` API를 호출합니다. 로컬 PC나 WebStorm이 꺼져 있어도 실행됩니다.

**Daily KMOU Batch**는 기존 `daily.yml` 주소와 `run_mode` 입력을 유지합니다. 기존 cron-job.org 요청 URL·본문·예약 시각은 변경할 필요가 없습니다. 22:00 배치의 기숙사 full은 아침·점심·저녁을 모두 포함합니다. **일요일의 `tomorrow_full_batch`는 다음 주 피드 3종을 먼저 완료한 뒤 Story를 실행합니다.** 아침 단독 모드는 수동 실행용이며 자동 아침 배치는 추가하지 않습니다.

| 예약 시각 (Asia/Seoul) | `run_mode` |
| --- | --- |
| 매일 10:00 | `today_lunch_batch` |
| 매일 16:00 | `today_dinner_batch` |
| 매일 22:00 | `tomorrow_full_batch` |

### 1. GitHub Secrets 등록

저장소의 **Settings → Secrets and variables → Actions → New repository secret**에 위 환경변수를 등록합니다. 또는 GitHub CLI로 로그인한 뒤 로컬 `.env` 값을 동기화합니다.

```bash
gh auth login
npm run secrets:sync -- OWNER/REPOSITORY
```

저장소 인자를 생략하면 `sihyeon10222/kmou_meal`에 등록합니다. 동기화는 값이 있는 항목만 등록하며, 사용을 중단한 Secret은 GitHub에서 직접 삭제해야 합니다.

### 2. cron-job.org 예약 작업 등록

위 표에 맞춰 작업 3개를 등록하고 시간대를 **Asia/Seoul**로 설정합니다. 기존 작업이 있다면 수정하여 중복 등록을 피합니다.

- 메서드: `POST`
- URL: `https://api.github.com/repos/OWNER/REPOSITORY/actions/workflows/daily.yml/dispatches`
- 인증: 대상 저장소의 **Actions 읽기/쓰기** 권한이 있는 fine-grained PAT

요청 헤더:

```text
Authorization: Bearer <PAT>
Accept: application/vnd.github+json
Content-Type: application/json
X-GitHub-Api-Version: 2022-11-28
```

요청 본문 (각 작업의 `run_mode`를 표에 맞게 변경):

```json
{
  "ref": "main",
  "inputs": {
    "run_mode": "today_lunch_batch",
    "preview_only": "false"
  }
}
```

예약 요청 성공은 GitHub의 실행 요청 접수를 뜻합니다. 실제 게시 성공은 Actions 로그에서 확인합니다. 자동화를 중지하려면 cron-job.org의 세 작업을 비활성화합니다.

### 수동 실행과 결과 확인

1. 여러 식당을 실행하려면 **Actions → Daily KMOU Batch → Run workflow**에서 `run_mode`로 세 배치 중 하나를 선택합니다.
2. 한 장만 실행하려면 **Actions → Manual KMOU Story → Run workflow**에서 `day`(today/tomorrow), `restaurant`(dormitory/snack/teacher), `meal`(breakfast/lunch/dinner/full)을 선택합니다. Snack은 끼니 선택에 관계없이 네 코너를 한 장으로 생성합니다. Branch는 `main`입니다.
3. 특정 날짜를 실행하려면 **기준 날짜 YYYY-MM-DD**에 날짜를 입력합니다. 비워두면 한국시간 오늘을 기준으로 실행합니다. `tomorrow_` 모드는 입력한 기준 날짜의 다음 날을 처리합니다.
4. 이미지 확인만 하려면 **이미지만 생성하고 게시하지 않기**를 체크합니다. 해제하면 실제 게시합니다. Manual은 기본 체크, Batch는 기존 자동화와 동일하게 기본 해제입니다.
5. 실행 결과의 `publish` 작업 로그와 **Artifacts → story-실행번호**를 확인합니다. 이미지와 JSON 기록은 7일 보관됩니다.

GitHub CLI에서도 게시 없이 실행할 수 있습니다.

```bash
gh workflow run daily.yml --ref main \
  -f run_mode=today_lunch_batch -f base_date=2026-09-18 -f preview_only=true

gh workflow run manual-story.yml --ref main \
  -f day=today -f restaurant=dormitory -f meal=breakfast \
  -f base_date=2026-09-18 -f preview_only=true

gh run list --workflow daily.yml --limit 10
```

## 주간 피드

매주 **일요일 22:00 KST**, 기존 cron-job.org 저녁 요청 하나로 아래 순서를 실행합니다. 별도 예약 작업을 추가하지 않습니다.

```text
교직원 주간 피드 → 학식 주간 피드 → 기숙사 주간 캐러셀
→ 기존 tomorrow_full_batch Story (기숙사 → 학식 → 교직원)
```

| 종류 | 날짜 | 포함 메뉴 | 이미지 |
| --- | --- | --- | --- |
| `teacher` | 다음 주 월~금 | Breakfast / Lunch / Dinner | 1080 × 1440 한 장 |
| `snack` | 다음 주 월~금 | 분식코너 / 정식 | 1080 × 1440 한 장 |
| `dormitory` | 다음 주 월~일 | Breakfast / Lunch / Dinner | 1080 × 1440 두 장 캐러셀 |

요일은 왼쪽부터 순서대로 배치합니다. 메뉴가 없는 날짜·끼니·코너도 유지하며 `메뉴 없음`을 표시합니다. 평일 공휴일도 동일합니다. 학식 주간 피드에는 양식·라면코너를 넣지 않습니다. 캡션 날짜 범위와 식당별 해시태그는 자동 생성합니다.

기숙사는 **2160 × 1440 PNG 마스터**를 한 번 렌더링하고 x=1080에서 그대로 잘라 두 JPEG를 만듭니다. 월~일을 같은 구조와 폭으로 배치하고 날짜 범위는 제목 바로 아래에 둡니다. 목요일도 다른 요일과 동일하며 중앙에서 메뉴 글자가 잘리는 것이 의도된 파노라마입니다. 분할 위치에 맞춘 텍스트 이동·축소·복제나 별도 여백을 넣지 않습니다.

### 로컬 실행

```bash
# 오늘을 기준으로 다음 주 세 식당 이미지 생성 (인증 정보 불필요)
npm run preview:weekly

# 기준일 2026-09-20의 다음 주: 9/21~9/27
npm run preview:weekly -- --base-date 2026-09-20

# 정확한 ISO 주차와 식당 지정
npm run preview:weekly -- --week 2026-W39 --kind dormitory

# 실제 게시: 성공한 동일 주차·종류는 skip
npm run weekly -- --week 2026-W39 --kind all

# 수동 강제 재게시
npm run weekly -- --week 2026-W39 --kind teacher --force

# 일요일 전체 순서 미리보기: 피드 3종 → 다음 날 Story 배치
npm run preview -- tomorrow_full_batch 2026-09-20
```

`--kind`는 `teacher`, `snack`, `dormitory`, `all` 중 선택합니다. `--base-date`는 **그 날짜가 속한 주의 다음 주**를 뜻하며, 생략하면 한국시간 오늘입니다. `--week YYYY-Www`가 있으면 기준일보다 우선합니다. 연말·연초는 ISO 주차의 연도를 사용합니다. Preview는 `--force`가 있어도 게시·업로드·게시 기록 조회를 하지 않습니다.

결과는 `output/YYYY-Www-종류-weekly.jpg`, 기숙사는 `-1.jpg`, `-2.jpg`와 `-master.png`로 저장합니다. HTML·메뉴 JSON·실행 결과도 함께 생성합니다.

### GitHub Actions 수동 실행

**Actions → Manual KMOU Weekly Feed → Run workflow**에서 다음을 선택합니다.

1. `kind`: 종류 또는 `all`
2. `base_date`: 기준일, 또는 `target_week`: 정확한 대상 ISO 주차
3. `preview_only`: 기본 체크. 해제하면 실제 게시합니다.
4. `force_publish`: 기본 해제. 체크하면 이미 성공한 주차·종류도 다시 게시합니다.

이미지는 **Artifacts → weekly-실행번호**에서 확인합니다. 일요일 Daily Batch가 생성한 주간 이미지·마스터도 해당 배치의 Story artifact에 포함됩니다. 세 workflow는 동일한 게시 대기열을 사용합니다.

```bash
gh workflow run weekly.yml --ref main \
  -f kind=all -f target_week=2026-W39 -f preview_only=true
```

### 중복 방지와 실패 복구

- 주간 피드만 **ISO 주차 + 종류**별 성공 기록으로 중복을 막습니다. 수동 실행도 동일하며 `--force`로 재게시할 수 있습니다. 기존 Story 재게시 정책은 그대로입니다.
- Supabase `_weekly/주차/종류/success.json`은 실제 Instagram publish 성공 후에만 저장합니다. 기록 조회 실패나 손상은 미게시로 간주하지 않고 실패 종료합니다.
- 피드 하나가 실패하면 후속 피드와 Story를 실행하지 않습니다. 재실행은 성공한 피드를 skip하고 남은 피드를 순서대로 처리합니다. 세 종류가 모두 게시 또는 성공 기록에 따른 skip 상태여야 Story로 넘어갑니다.
- `_weekly/주차/종류/lock.json`으로 로컬·Actions 동시 게시를 방지합니다. 정상 종료와 명확한 미게시 실패 때 해제하며, 네트워크 응답 유실·성공 기록 저장 실패·실행 강제 종료 시 잠금을 유지합니다. `force`도 진행 중인 잠금을 무시하지 않습니다.
- 잠금이 남으면 Instagram 계정과 `output/*.publish.json`, Supabase `attempts/`의 container/media ID를 확인합니다. **이미 게시된 것이 확인되면 해당 게시 성공 기록을 `success.json`으로 복구한 후**, 게시되지 않았음이 확인되면 그대로, Supabase Storage에서 해당 `lock.json`을 삭제하고 재실행합니다. 결과가 불확실한 동안 잠금을 삭제하지 않습니다.
- 기존과 동일하게 `24/2207006`만 새 container로 한 번 복구합니다. 그 외 API 오류·네트워크 오류를 자동 재게시하지 않습니다.

실제 피드 업로드에는 기존 Instagram Login 게시 권한과 Supabase 설정을 사용합니다. 3:4 JPEG를 그대로 전달하며 다른 비율로 자동 변환하지 않습니다. API가 거절하면 실패로 기록하므로 최초 실제 운영 게시에서 계정의 이미지 규격 수용 여부도 확인해야 합니다.

## Story 메뉴 없음·실패·재게시 정책

- **대상 날짜가 토·일이면** 스낵·교직원 식당을 건너뜁니다. 기숙사는 처리합니다. 금요일 밤 배치는 기숙사만, 일요일 밤 배치는 세 식당을 처리합니다.
- 평일 공휴일은 건너뛰지 않습니다. 메뉴가 없는 끼니·코너에는 **메뉴 없음**을 표시하고 나머지 메뉴는 유지합니다. 별도 공휴일 API나 늦은 등록 재조회는 사용하지 않습니다.
- 잘못된 날짜, API 오류, 예상한 학식 표 구조가 없는 응답은 실패로 처리합니다. 정상 표에 메뉴 행이 없는 경우는 빈 메뉴입니다.
- 학식 조회의 연결 오류·시간 초과·본문 수신 실패와 HTTP 408/429/5xx는 1초, 2초 간격으로 최대 3회 시도합니다. 각 시도의 제한 시간은 15초이며, 모두 실패하면 오류로 종료합니다. 이 재시도는 식단 조회에만 적용되므로 이미 게시한 Story를 다시 게시하지 않습니다.
- 배치는 순차 실행하며 한 Story가 실패해도 다음 Story를 처리합니다. 실패가 하나라도 있으면 최종 실행은 실패 종료하고 `.run.json`에 결과를 남깁니다.
- **같은 날짜·모드를 다시 실행해도 새 Story를 게시합니다.** 실패한 식당만 복구하려면 개별 모드를 실행합니다. 배치 전체를 재실행하면 이미 성공한 식당도 재게시됩니다.
- Instagram 게시 오류 `code=24 / subcode=2207006`에 한해 새 container로 한 번 복구합니다. 다른 오류나 네트워크 응답 유실은 자동 재게시하지 않습니다.
- 실패 상태만으로 미게시를 단정할 수 없습니다. 재실행 전 Instagram과 실행 기록을 확인합니다. 게시 성공 뒤 검증·기록 저장이 실패하면 기존 media ID를 유지합니다.
- 모든 식당은 메뉴량을 측정해 section 높이와 글자 크기를 자동 조절합니다. 메뉴가 적은 영역은 더 크게, 많은 영역은 overflow가 생기지 않는 범위에서 줄입니다. 최소 크기에서도 넘치면 내용을 자르지 않고 게시 전에 실패합니다.

토큰 만료·무효화 오류가 발생하면 Access Token을 갱신하고 `.env` 수정 → `npm run check-setup` → GitHub Secrets 갱신 순서로 적용합니다.

## 코드 구조와 디자인

```text
src/
  main.ts                 # CLI 진입점, preview/게시 분기
  weekly-cli.ts           # 주간 피드 수동/preview CLI
  weekly-data.ts          # ISO 주차, 날짜별 식단, 캡션
  weekly.ts               # 주간 실행 서비스 연결과 결과 저장
  run-weekly.ts           # 피드 순서, 중복 skip, Story 진입 조건
  render-weekly.ts        # 주간 표 렌더링과 파노라마 분할
  post-weekly.ts          # 주간 게시 잠금과 성공 기록
  story-modes.ts          # 모드, 날짜, 주말 규칙
  run-stories.ts          # 식당별 순차 처리와 실행 결과
  fetch-menu.ts          # 기숙사 식단 조회
  fetch-coop-menu.ts     # 학식 POST + Cheerio 파싱
  story-data.ts          # 식당별 메뉴 영역 구성
  render-story.ts        # HTML/CSS → JPEG
  upload-supabase.ts     # 이미지와 게시 기록 저장
  publish-instagram.ts   # Instagram API 게시 및 확인
  post-story.ts          # 실행별 게시 상태와 오류 복구
  config.ts              # 설정 검증
  check-setup.ts          # 게시 없이 연결 확인
  index.ts               # 기숙사 조회 CLI
templates/               # 공통 HTML/CSS와 식당별 레이아웃
assets/fonts/            # Noto Sans KR 및 OFL 라이선스
scripts/                 # Secrets 동기화, workflow 모드 해석
tests/                   # 테스트와 식단 fixture
.github/workflows/       # GitHub Actions 실행 설정
output/                  # 생성 결과 (Git 제외)
```

공통 헤더·푸터·폰트는 `templates/shared.css`와 `templates/story.html`에서 관리합니다. 식당별 디자인은 다음과 같습니다.

| 파일 | 구성 |
| --- | --- |
| `templates/dormitory.css` | 전체 식단: 헤더·아침 흰색, 점심 크림색, 저녁 파란색 |
| `templates/snack.css` | 전체 크림색의 양식·정식·라면·분식 4개 영역 |
| `templates/teacher.css` | 전체 식단: 헤더·아침 흰색, 점심 크림색, 저녁 파란색 |

세 식당 모두 공통 렌더러가 실제 메뉴 높이를 측정해 사용 가능한 공간을 나누고, 각 영역에 들어가는 가장 큰 글자 크기를 선택합니다. 스낵코너는 네 영역, 교직원 전체 식단은 Breakfast/Lunch/Dinner 영역을 메뉴 유무와 관계없이 유지합니다. 저장소에 포함된 Noto Sans KR을 사용해 로컬과 GitHub Actions에서 같은 폰트로 렌더링합니다. 디자인 수정 후 `npm run preview -- <모드> [기준일]`로 실제 결과를 확인합니다.
