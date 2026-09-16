# KMOU Meal

국립한국해양대학교 학생생활관 식단을 **위쪽 점심 / 아래쪽 저녁**으로 구성한 **1080×1920 JPEG**로 만들고, Supabase Storage를 거쳐 **@kmou_meal Instagram Story**로 매일 게시합니다. 조식은 제외합니다.
Node.js 24 + TypeScript + Playwright / GitHub Actions / Supabase / Instagram Login API를 사용합니다.
인계 문서의 기존 Instagram 계정·권한과 `stories` Public 버킷을 그대로 사용합니다.

## WebStorm에서 실행

1. **File → Open…**에서 `/Users/sihyeon/WebstormProjects/kmou_meal`을 엽니다.
2. **WebStorm → Settings… → Languages & Frameworks → JavaScript Runtime**에서 Node.js 24를 선택합니다. 버전에 따라 **Node.js** 항목이며 설정 검색창에서 찾을 수 있습니다.
3. **View → Tool Windows → Terminal**을 엽니다.

현재 Mac에서 `node`를 찾지 못하면 먼저 실행합니다.

```bash
export PATH="$HOME/Library/Application Support/JetBrains/WebStorm2026.2/node/versions/24.21.0/bin:$PATH"
```

새로 받은 프로젝트에서 최초 한 번:

```bash
npm ci
npx playwright install chromium
```

자주 쓰는 명령:

```bash
npm run fetch-menu                   # 오늘 중식·석식 JSON
npm run preview                      # 오늘 이미지 생성만
npm run preview -- 2026-09-16         # 지정 날짜 이미지 생성만
npm run check-setup                   # 계정/키/Public 버킷 확인, 게시하지 않음
npm start                            # 오늘 실제 Story 게시 (동일 날짜 중복 방지)
npm run typecheck
npm test
npm run build
```

이미지는 `output/YYYY-MM-DD.jpg`, 디자인 확인용 HTML은 같은 폴더의 `.html`입니다.
HTML은 폰트를 포함하므로 용량이 크며 Git에 저장하지 않습니다.

## 디자인 수정

`templates/story.html`에서 색상, 간격, 폰트 크기를 수정하고 `npm run preview`로 확인합니다.
위 960px은 크림색 점심 영역, 아래 960px은 남색 저녁 영역입니다.
Noto Sans KR 폰트를 저장소에 포함하여 Mac과 GitHub Linux에서 한글을 동일하게 렌더링합니다.
긴 메뉴는 글자 크기를 자동으로 줄입니다. 최소 크기에서도 넘치면 메뉴를 잘라서 게시하지 않고 실패합니다.

## 로컬 환경 변수와 Supabase

현재 `.env`가 있으면 그대로 사용합니다. 새 환경에서만 `.env.example`을 `.env`로 복사합니다.
실제 키는 채팅, 스크린샷, Git에 넣지 않습니다.

| 이름 | 설정값 / 위치 |
| --- | --- |
| `IG_ACCESS_TOKEN` | 기존 Instagram Login 방식 Access Token |
| `IG_USER_ID` | `28356314417311156` |
| `SUPABASE_URL` | `https://hzzcxgmrwgzemfprupum.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 기존 서버용 service_role 키 |
| `SUPABASE_BUCKET` | `stories` |
| `SUPABASE_SECRET_KEY` | 선택: 새 sb_secret_... 키 사용 시 설정. 기존 service_role보다 우선 |

기존 버킷은 재생성할 필요가 없습니다. 키를 교체하거나 다른 환경에서 설정할 경우:

1. [Supabase 프로젝트](https://supabase.com/dashboard/project/hzzcxgmrwgzemfprupum) → **Settings → API Keys**를 엽니다.
2. 기존 `service_role` 키를 사용하거나 Secret keys 영역에서 서버 전용 Secret key를 만듭니다. `anon` / Publishable key는 이 서버의 업로드용 키가 아닙니다.
3. WebStorm의 `.env`에서 해당 변수에 키를 붙여 넣습니다.
4. Supabase 왼쪽 **Storage → stories**에서 **Public**인지 확인합니다. 별도 테이블·SQL·업로드 정책은 필요하지 않습니다. 서버 키로 업로드합니다.
5. `npm run check-setup`을 실행합니다.

이미지는 `stories/YYYY-MM-DD/<실행별 UUID>.jpg`, 게시 기록은 `stories/_posts/YYYY-MM-DD.json`에 저장합니다.
기록에는 날짜, 이미지 경로, 상태, container/media ID만 저장하며 비밀키는 저장하지 않습니다.
Public 버킷이므로 게시 기록도 URL을 아는 사람은 읽을 수 있습니다.

## GitHub Actions 설정과 운영

저장소: [sihyeon10222/kmou_meal](https://github.com/sihyeon10222/kmou_meal) (비공개)

`.github/workflows/daily.yml`은 기본 브랜치에서 매일 **07:10 KST**에 실행되도록 설정합니다.
UTC cron은 `10 22 * * *`이고 프로그램 날짜 계산은 명시적으로 `Asia/Seoul`을 사용합니다.
GitHub 스케줄은 대기열 상태에 따라 지연될 수 있으므로 정확한 시각을 보장하지는 않습니다.

### 비밀값 등록/갱신

이미 등록된 환경에서는 토큰을 바꿀 때만 아래 작업을 합니다.

CLI 방식 (이 Mac의 GitHub 로그인 사용):

```bash
gh auth status
npm run secrets:sync
```

이 명령은 `.env` 값을 표준 입력으로 GitHub Secret에 전달하며 비밀값을 출력하지 않습니다.
새 키와 기존 키가 모두 등록되어 있으면 `SUPABASE_SECRET_KEY`가 우선합니다. 새 키 사용을 중단할 때는 GitHub에서 해당 Secret을 삭제해야 합니다.

직접 클릭하여 등록하는 방법:

1. 저장소 → **Settings → Secrets and variables → Actions**.
2. **New repository secret**을 누릅니다.
3. **Name**에 위 표의 변수 이름, **Secret**에 `.env`의 해당 값만 입력합니다. 따옴표나 `NAME=`은 넣지 않습니다.
4. **Add secret**을 누릅니다. 기본 5개를 등록하거나 service_role 대신 `SUPABASE_SECRET_KEY`를 등록합니다.
5. 나중에 수정하려면 Secret 오른쪽 연필 아이콘 → 새 값 → **Update secret**.

### 수동 실행/실패 확인

1. 저장소 → **Actions → Daily KMOU Story**.
2. **Run workflow** → Branch `main`을 선택합니다.
3. 이미지 확인만 하려면 **이미지만 생성하고 게시하지 않기**를 체크합니다. 실제 게시하려면 해제합니다.
4. **Run workflow**를 누릅니다.
5. 실행 항목 → **publish** → 각 단계 로그를 확인합니다.
6. 실행 요약 아래 **Artifacts → story-실행번호**에서 JPEG와 식단/게시 기록 JSON을 내려받을 수 있습니다. 7일간 보관합니다.

자동 실행 중지: **Actions → Daily KMOU Story → 오른쪽 ⋯ → Disable workflow**.
다시 시작: 같은 화면에서 **Enable workflow**.
MacBook과 WebStorm이 꺼져 있어도 GitHub에서 실행됩니다.

## 중복 방지와 실패 복구

- 해당 날짜의 메뉴가 없거나 중식·석식이 모두 비어 있으면 정상적으로 건너뜁니다.
- 해당 날짜의 게시 기록이 `published`이면 재실행해도 게시하지 않습니다.
- GitHub concurrency와 Supabase의 `upsert:false` 기록 생성으로 동시 실행을 막습니다.
- 게시 POST는 응답이 유실돼도 자동 재전송하지 않습니다.
- 기록이 `posting`이면 이전 실행의 결과가 불명확하므로 자동 재게시하지 않고 실패합니다.

`posting` 오류 복구:

1. Actions 로그와 Artifacts의 `.publish.json`, Supabase **Storage → stories → _posts → 해당 날짜 JSON**을 확인합니다.
2. Instagram 앱에서 @kmou_meal의 Story가 올라왔는지 확인합니다.
3. 실제 게시가 확인됐다면 기록을 지우고 재실행하지 않습니다. container의 `PUBLISHED` 상태 또는 media ID를 확인해 기록을 복구해야 합니다.
4. 게시가 되지 않았다는 사실을 확인한 경우에만 `_posts/해당 날짜.json`을 삭제하고 그날 다시 실행합니다. 이미지 파일만 삭제해서는 게시 기록이 초기화되지 않습니다.

Storage 업로드 권한 오류는 서버 키를, Instagram code 190은 토큰 만료/무효화를 먼저 확인합니다.
토큰은 영구적이지 않습니다. Meta Developer 앱의 **Instagram → API setup with Instagram login → Generate access tokens**에서 필요한 경우 새 토큰을 만들고, `.env` 수정 → `npm run check-setup` → `npm run secrets:sync` 순서로 갱신합니다.
인계 문서의 App Secret 노출 건은 **2026-09-16 사용자 확인: Reset 완료**로 처리했습니다. 이 프로젝트는 App Secret을 저장하거나 사용하지 않습니다.

## 파일 구조

```text
src/
  fetch-menu.ts          # 한국 날짜, 최신 dietSeq, 중식·석식 정리
  render-story.ts        # HTML → 1080×1920 JPEG
  config.ts              # .env 읽기, 설정 검증, 비밀값 로그 차단
  upload-supabase.ts     # 이미지 업로드·공개 URL 검증·게시 기록
  publish-instagram.ts   # 계정 확인 → container → publish → 활성 Story 검증
  main.ts                # 전체 실행 / 미리보기
  check-setup.ts         # 게시 없이 설정 확인
  index.ts               # 식단 조회 CLI
templates/story.html
assets/fonts/           # Noto Sans KR + OFL 라이선스
scripts/sync-secrets.ts
tests/
.github/workflows/daily.yml
output/                 # Git 제외
```

API 참고: [Supabase 서버 키](https://supabase.com/docs/guides/getting-started/api-keys), [Instagram 게시](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/), [GitHub 스케줄](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
