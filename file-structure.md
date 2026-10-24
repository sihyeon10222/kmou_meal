# 파일 구조와 작업 기준

이 문서는 현재 저장소의 파일 배치와 모듈 의존성 기준입니다. 작업 전에 이 문서와 `AGENTS.md`를 읽고, 파일 위치나 책임을 바꾸면 같은 작업에서 이 문서도 갱신합니다.

## 구성 원칙

하나의 Node.js 프로젝트 안에서 화면 구성, 서버 실행, 공통 데이터 계약을 분리합니다. 프론트엔드는 Story·피드 이미지의 HTML/CSS와 브라우저 레이아웃을 담당합니다. 독립적인 웹 서버나 웹 대시보드는 현재 제공하지 않습니다.

| 영역 | 책임 | 의존할 수 있는 영역 |
| --- | --- | --- |
| `src/frontend` | HTML 문자열, CSS, DOM 측정·배치, 실행 자산 | frontend 내부, shared |
| `src/backend` | CLI, 정책 실행, 외부 API, Chromium·Sharp, 파일·캐시 저장 | backend 내부, frontend, shared |
| `src/shared` | 데이터 계약, 실행 모드 값, 날짜 계산 | shared 내부 |
| `fixtures/design` | 디자인 미리보기·벤치마크·테스트 공용 예시 | 소스의 공개 함수와 계약 |
| `tests` | 기능·렌더링·전송 회귀 검증 | 소스, fixtures, 테스트 도우미 |
| `scripts` | 빌드·미리보기·자산 생성·운영 보조 | 소스, fixtures |

frontend/shared에서 Node.js 모듈, 서비스 SDK, 서버 환경변수, backend 구현을 가져오지 않습니다. shared에서 frontend를 가져오지 않습니다. 이 규칙은 ESLint와 `tsconfig.frontend.json`으로 검사합니다. 브라우저의 `page.evaluate`로 실행하는 함수는 외부 클로저에 의존하지 않도록 유지합니다.

## 폴더 트리

```text
kmou_meal/
├── AGENTS.md
├── file-structure.md
├── README.md
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.check.json / tsconfig.frontend.json
├── eslint.config.js
├── .env.example / .nvmrc / .gitignore
├── src/
│   ├── frontend/
│   │   ├── story/
│   │   │   ├── html.ts                 # 주입된 자산으로 HTML 생성
│   │   │   ├── template.html
│   │   │   ├── layout.ts               # 글자 측정·안전영역 검사
│   │   │   ├── measure-art.ts          # 장식 배치용 DOM 측정
│   │   │   ├── art-placement.ts        # 순수 좌표·충돌 계산
│   │   │   └── styles/                 # base·snack·dormitory·teacher
│   │   ├── weekly/
│   │   │   ├── html.ts
│   │   │   ├── layout.ts               # 요일별 두 단계 글자 크기·공통 행 높이
│   │   │   └── styles.css
│   │   ├── shared/
│   │   │   ├── design.css              # 공통 디자인 토큰
│   │   │   └── escape-html.ts
│   │   └── assets/
│   │       ├── fonts/                  # 실행 폰트·라이선스
│   │       └── illustrations/          # 캐릭터·고정 제목 이미지
│   ├── backend/
│   │   ├── cli/                        # main·options·check-setup·fetch-menu
│   │   ├── config/                     # env·publishing·paths
│   │   ├── bootstrap/
│   │   │   └── publishing-services.ts # 외부 게시 서비스 지연 조립
│   │   ├── features/
│   │   │   ├── story/                  # execute·run·modes·data·post·summary
│   │   │   └── weekly/                 # execute·run·fetch·caption·snapshot·post
│   │   ├── integrations/
│   │   │   ├── kmou/                   # residence·coop·transport
│   │   │   ├── instagram/client.ts
│   │   │   ├── supabase/storage.ts
│   │   │   ├── cloudflare/food-ai.ts
│   │   │   └── github/weekly-notifications.ts
│   │   ├── rendering/
│   │   │   ├── browser.ts
│   │   │   ├── assets.ts
│   │   │   ├── story-renderer.ts
│   │   │   ├── weekly-renderer.ts
│   │   │   └── art/                    # decorate·cache·image-processing
│   │   │                              # bubble-compositor·measure-layout
│   │   └── support/safe-error.ts
│   └── shared/
│       ├── contracts/                  # menu·story·weekly·publishing·art
│       └── dates.ts
├── fixtures/design/                    # story-design·weekly-design
├── tests/
│   ├── frontend/                       # HTML·CSS·이미지 레이아웃
│   ├── backend/                        # 게시·조회·수명·실행 정책
│   ├── shared/                         # 날짜 계산
│   ├── fixtures/                       # 학교 응답 HTML·JSON
│   └── helpers/                        # menus·menu-retries
├── scripts/
│   ├── preview/                        # story-art·weekly-design·weekly-updates
│   ├── assets/render-story-art-headings.ts
│   ├── ops/                            # build.mjs·sync-secrets.ts
│   └── benchmark.ts
├── docs/
│   ├── architecture/                   # 구조·음식 일러스트
│   ├── operations/                     # 자동화·게시 운영
│   ├── requirements/                   # 현재 주간 정책
│   ├── audits/                         # 과거 최적화·장애 분석
│   ├── archive/                        # 대체된 과거 요구사항
│   ├── design-references/              # 실행에서 제외하는 제공 원본
│   └── assets/                         # GitHub 소개 이미지
├── .github/actions/setup/
├── .github/workflows/                  # ci·daily·weekly
├── output/                             # 실행 디렉터리 기준 생성 결과
├── .cache/story-art/                    # 음식 선택·이미지 캐시
└── dist/                               # 코드·실행 자산 빌드 결과
```

## 변경할 파일을 고르는 방법

- Story의 모양은 `frontend/story`, 주간 피드의 모양은 `frontend/weekly`를 수정합니다. 공통 색상은 `frontend/shared/design.css`를 사용합니다.
- 조회·skip·재게시 판단은 `backend/features`에 둡니다. 학교 응답 파싱과 HTTP 요청은 `backend/integrations/kmou`에 둡니다.
- 외부 서비스가 추가되면 `backend/integrations/<서비스>`에 구현하고, 실행에 필요한 연결은 bootstrap 또는 해당 feature에서 조립합니다.
- 공통 데이터 형태는 `shared/contracts`에 둡니다. HTML에 사용할 데이터에도 서버 인증값이나 클라이언트 객체를 포함하지 않습니다.
- AI 요청은 Cloudflare 연동, 캐시는 `rendering/art/cache.ts`, 픽셀 처리는 `image-processing.ts`, 합성은 `bubble-compositor.ts`로 나눕니다.
- Story 렌더러는 AI 장식 결과를 `onArtReport`로 실행 계층에 전달합니다. 실행 계층은 게시 결과와 장식 결과를 함께 `.run.json`과 Actions Summary에 기록하며, 장식 실패와 실제 게시 실패를 구분합니다.
- 디자인 샘플은 `fixtures/design`, 실제 응답·오류 재현 자료는 `tests/fixtures`에 둡니다. 개발 스크립트에서 테스트 도우미를 가져오지 않습니다.
- 참고 이미지는 `docs/design-references`, 실행에 필요한 이미지는 `frontend/assets`에 둡니다. 폰트 이동 시 라이선스를 함께 보존합니다.

## 진입점과 빌드

| 명령 | 진입점 |
| --- | --- |
| `npm run story`, `npm start` | `src/backend/cli/main.ts story` |
| `npm run feed` | `src/backend/cli/main.ts feed` |
| `npm run preview` | `src/backend/cli/main.ts story --preview` |
| `npm run fetch-menu` | `src/backend/cli/fetch-menu.ts` |
| `npm run check-setup` | `src/backend/cli/check-setup.ts` |
| `npm run build` | `scripts/ops/build.mjs` |

실행 진입점에서만 `config/env.ts`를 가져와 `.env`를 읽습니다. 공통 함수나 HTML 생성 함수를 import하는 것만으로 환경 로딩이나 게시 초기화를 수행하지 않습니다.

빌드는 프로젝트의 `dist/`를 정리하고 `src/`를 컴파일한 뒤 frontend의 정적 파일을 같은 상대 위치에 복사합니다. `backend/config/paths.ts`는 `import.meta.url`을 기준으로 frontend 자산을 찾으므로 소스 실행과 빌드 실행에 동일한 경로 규칙을 적용합니다. 배포에는 `dist`, 런타임 의존성, Chromium이 필요합니다. `output`과 `.cache`는 호출한 작업 디렉터리를 기준으로 생성합니다.

타입 검사는 src·scripts·tests·fixtures를 포함하며 frontend/shared는 Node 전역 타입 없이 한 번 더 검사합니다. ESLint는 빌드 스크립트도 검사합니다. `npm test`는 backend·frontend·shared 아래의 테스트를 수집합니다. 테스트 파일을 더 깊은 폴더로 옮기면 수집 명령을 함께 갱신합니다. CI 검증 순서와 테스트 assertion을 구조 변경 때문에 생략하지 않습니다.

## 기존 파일 이동표

아래의 기존 파일명은 모두 과거 `src/` 루트 기준입니다.

| 기존 파일 | 현재 위치 |
| --- | --- |
| cli.ts / cli-options.ts | backend/cli/main.ts / options.ts |
| index.ts / check-setup.ts | backend/cli/fetch-menu.ts / check-setup.ts |
| config.ts | backend/config/env.ts·publishing.ts, backend/support/safe-error.ts |
| dates.ts | shared/dates.ts |
| stories.ts / run-stories.ts | backend/features/story/execute.ts / run.ts |
| story-modes.ts / story-data.ts | backend/features/story/modes.ts / data.ts, shared/contracts |
| post-story.ts / story-summary.ts | backend/features/story/post.ts / summary.ts |
| weekly.ts / run-weekly.ts / post-weekly.ts | backend/features/weekly/execute.ts / run.ts / post.ts |
| weekly-data.ts | shared/contracts/weekly.ts, shared/dates.ts, backend/features/weekly/fetch.ts·caption.ts |
| weekly-snapshot.ts | backend/features/weekly/snapshot.ts |
| weekly-notifications.ts | backend/integrations/github/weekly-notifications.ts |
| fetch-menu.ts / fetch-coop-menu.ts / fetch-menu-text.ts | backend/integrations/kmou/residence.ts / coop.ts / transport.ts |
| publish-instagram.ts / upload-supabase.ts / cloudflare-ai.ts | backend/integrations/instagram/client.ts / supabase/storage.ts / cloudflare/food-ai.ts |
| publishing-services.ts | backend/bootstrap/publishing-services.ts |
| render-story.ts / render-weekly.ts | backend/rendering/*-renderer.ts, frontend/story/html.ts·weekly/html.ts |
| render-browser.ts / render-assets.ts | backend/rendering/browser.ts / assets.ts, frontend/shared/escape-html.ts |
| layout-story.ts / layout-weekly.ts | frontend/story/layout.ts / frontend/weekly/layout.ts |
| story-art.ts / story-art-bubble.ts | backend/rendering/art/decorate.ts·cache.ts·image-processing.ts / bubble-compositor.ts |
| story-art-layout.ts | frontend/story/art-placement.ts·measure-art.ts, backend/rendering/art/measure-layout.ts |

기존 `templates/`는 `frontend/story`·`frontend/weekly`·`frontend/shared`로, 실행용 `assets/`는 `frontend/assets`로 이동했습니다. 과거 감사 문서의 파일명은 당시 기록으로 유지합니다.

## 구조 피드백과 확장 기준

화면·외부 서비스·공통 데이터의 변경 위치를 나누고, 날짜 표시 때문에 학교 조회 코드를 가져오던 의존성을 제거했습니다. 현재는 단일 배치 실행 단위이므로 npm 프로젝트 하나를 유지합니다. 독립적인 웹서비스가 필요해지면 frontend를 `apps/web`, 배치를 `apps/worker`, 데이터 계약을 공통 패키지로 분리하는 구성을 검토합니다.

성능 재측정, 외부 통신 병렬화, 캐시 보관 기간 변경은 별도 변경으로 다룹니다. 구조 변경만으로 실제 게시 속도나 장애율이 개선됐다고 단정하지 않습니다.
