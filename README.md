# KMOU Meal

국립한국해양대학교의 **기숙사·승선생활관·학식·교직원식당 식단을 Instagram Story와 주간 피드로 만드는 자동화 프로젝트**입니다.

학교에서 제공하는 식단을 조회하고, 한글 폰트가 포함된 템플릿으로 이미지를 생성한 뒤 Supabase Storage와 Instagram API를 통해 게시합니다. 이미지 생성만 수행하는 미리보기도 제공합니다.

[Instagram @kmou_meal](https://www.instagram.com/kmou_meal/) · [폴더 구조](file-structure.md) · [자동화 설정](docs/operations/automation.md) · [게시 정책](docs/operations/publishing.md)

![KMOU Meal 결과물 예시](docs/assets/kmou-meal-showcase.jpg)

## 제공 기능

- **매일 Story**: 기숙사·승선생활관·교직원식당은 세 끼를 한 장에, 학식은 네 코너를 한 장에 표시합니다.
- **주간 피드**: 학식·교직원식당 통합 게시물과 두 생활관의 파노라마 캐러셀을 생성합니다.
- **식단 업데이트 반영**: 미래의 빈 끼니에 메뉴가 추가되면 해당 주간 게시물을 새로 게시하고 교체 안내를 남깁니다.
- **음식 일러스트**: 선택적으로 Cloudflare Workers AI의 음식 그림과 제공된 해양이 캐릭터를 합성합니다. 실패하면 기본 Story를 사용합니다.
- **운영 기록**: 이미지·식단 원본·게시 영수증·실행 결과를 저장하고 GitHub Actions Summary에 결과를 표시합니다.

| 식당 | Story | 주간 피드 |
| --- | --- | --- |
| 기숙사 `dormitory` | 매일 세 끼 또는 선택한 끼니 | 월~일, 2장 파노라마 |
| 승선생활관 `badaro` | 매일 세 끼 또는 선택한 끼니 | 월~일, 2장 파노라마 |
| 학식 `snack` | 평일 네 코너 | 월~금, 교직원식당과 통합 게시 |
| 교직원식당 `teacher` | 평일 세 끼 또는 선택한 끼니 | 월~금, 학식과 통합 게시 |

Story는 **1080×1920 JPEG**, 피드는 **1080×1440 JPEG**입니다. 생활관 주간 피드는 2160×1440 마스터를 정확히 반으로 나눈 두 장으로 구성합니다.

## 빠르게 시작하기

**Node.js 24.x**, npm과 Chromium이 필요합니다. 인증 정보 없이 식단 조회와 기본 미리보기를 사용할 수 있습니다.

```bash
git clone https://github.com/sihyeon10222/kmou_meal.git
cd kmou_meal
npm ci
npx playwright install chromium
npm run preview
```

Linux에서는 `npx playwright install --with-deps chromium`으로 브라우저와 시스템 라이브러리를 설치합니다. WebStorm에서는 프로젝트 폴더를 열고 내장 터미널에서 같은 명령을 실행합니다.

결과는 실행한 디렉터리의 `output/`에 저장됩니다. 템플릿·폰트·캐릭터 경로는 실행 디렉터리와 무관하게 해석합니다.

## 사용법

| 명령 | 동작 |
| --- | --- |
| `npm run preview` | 오늘 모든 식당 Story 미리보기 |
| `npm run story` | 오늘 모든 식당 Story 실제 게시 |
| `npm run feed -- --preview` | 대상 주간 피드 미리보기 |
| `npm run feed` | 대상 주간 피드 실제 게시 |

`npm start`는 `npm run story`와 같습니다. 실제 게시에는 아래 인증 설정이 필요합니다.

```bash
# 승선생활관 전체 Story 미리보기
npm run preview -- --restaurant badaro

# 지정한 날짜의 기숙사 저녁 미리보기
npm run preview -- --restaurant dormitory --meal dinner --date 2026-10-20

# 특정 주차의 학식·교직원식당 통합 피드 미리보기
npm run feed -- --preview --restaurant combined --week 2026-W43
```

| 옵션 | 사용 범위와 값 |
| --- | --- |
| `--restaurant` | Story: `all`, `dormitory`, `badaro`, `snack`, `teacher` / Feed: `all`, `combined`, `badaro`, `dormitory` |
| `--date YYYY-MM-DD` | 한국시간 기준 날짜. Feed는 월~토에 해당 주, 일요일에 다음 주를 선택 |
| `--preview` | 이미지 생성만 수행. Supabase·Instagram·게시 기록에 접근하지 않음 |
| `--meal` | Story 전용. `full`, `breakfast`, `lunch`, `dinner`. 개별 끼니는 식당을 지정해야 함 |
| `--art` | Story 전용. `generate`, `cache`, `off` |
| `--week YYYY-Www` | Feed 전용. `--date`와 함께 사용하지 않음 |
| `--force` | Feed 전용. 기존 성공 게시물의 수동 재게시 허용 |

음식 그림은 실제 게시에서 `generate`, 미리보기에서 `cache`가 기본입니다. `--art generate`는 미리보기에서도 Cloudflare 인증이 필요하며 새 생성 요청을 보낼 수 있습니다. 자세한 캐시·합성 방식은 [음식 일러스트 문서](docs/architecture/story-art.md)를 참고하세요.

## 실제 게시 설정

`.env.example`을 복사해 `.env`를 만들고 다음 값을 입력합니다. GitHub Actions로 운영할 때는 같은 이름의 Repository Secrets를 등록합니다.

| 환경변수 | 용도 |
| --- | --- |
| `IG_ACCESS_TOKEN` | Instagram 게시 토큰 |
| `IG_USER_ID` | 게시 계정의 숫자 ID |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 키 |
| `SUPABASE_BUCKET` | 이미지·게시 기록을 저장할 Public 버킷 |
| `SUPABASE_SECRET_KEY` | 선택. 설정하면 service role 키보다 우선 |
| `CLOUDFLARE_ACCOUNT_ID` | 선택. 음식 일러스트 생성용 계정 ID |
| `CLOUDFLARE_API_TOKEN` | 선택. Workers AI 실행 토큰 |

게시 계정은 현재 `@kmou_meal`로 검증합니다. 다른 계정에서 운영하려면 백엔드의 [계정 검증](src/backend/integrations/instagram/client.ts)을 함께 변경해야 합니다. 비밀값은 Git에 커밋하지 않습니다.

```bash
npm run check-setup
npm run secrets:sync -- sihyeon10222/kmou_meal
```

`check-setup`은 Instagram 계정과 Supabase 버킷을 조회합니다. `secrets:sync`는 로컬 환경변수를 GitHub Secrets에 등록하며 로그인된 GitHub CLI(`gh`)가 필요합니다.

## 자동화와 게시 정책

운영 예약은 **Asia/Seoul 기준 매일 07:00 Story, 매일 18:00 주간 피드 확인**입니다. 예약은 cron-job.org가 GitHub Actions의 `workflow_dispatch`를 호출하는 방식이며, 저장소 workflow에 자체 `schedule`은 없습니다. 별도 예약 설정이 필요합니다.

- 정상 조회의 빈 Story 식단은 `등록된 식단 없음` 이미지로 게시합니다. 조회·파싱 오류는 실패로 처리합니다.
- 주간 피드는 미래의 빈 끼니에 메뉴가 추가된 경우 자동 재게시합니다. 메뉴 수정·삭제만으로는 자동 재게시하지 않습니다.
- Story 재실행은 새 게시입니다. 실패 복구 시 해당 식당만 선택합니다.
- 교체된 주간 게시물의 이전 게시물은 수동으로 삭제합니다. GitHub 이슈와 Actions Summary에 안내가 남습니다.

입력 본문·예약 설정은 [자동화 가이드](docs/operations/automation.md), 잠금·오류 복구·디자인 계약은 [게시 정책](docs/operations/publishing.md)에 정리했습니다.

## 코드 구조와 개발

```text
src/frontend/  HTML·CSS·브라우저 레이아웃·폰트·일러스트
src/backend/   CLI·식단 수집·렌더링 실행·저장·외부 게시
src/shared/    공통 데이터 계약·날짜 계산
fixtures/      미리보기와 벤치마크가 함께 쓰는 디자인 예시
scripts/       개발 미리보기·자산 생성·운영 도구
tests/        프론트엔드·백엔드·공통 로직 검증
docs/         운영 안내·구조 설명·분석 기록
```

프론트엔드는 이미지 안에 들어갈 화면을 구성합니다. 백엔드는 그 화면을 Chromium에서 실행해 이미지로 저장합니다. 상세 트리·의존성 규칙·기존 파일 이동표는 [file-structure.md](file-structure.md)를 참고하세요.

```bash
npm run typecheck
npm run lint
npm run build
```

빌드는 이전 `dist/`를 정리하고 TypeScript 코드와 정적 자산을 `dist/`에 함께 생성합니다. 빌드 후 CLI 경로는 `node dist/backend/cli/main.js`이며, 예를 들어 `node dist/backend/cli/main.js story --preview`로 실행합니다. 실행 환경에는 의존성과 Chromium도 필요합니다.

테스트는 명시적으로 실행할 때 `npm test`를 사용합니다. CI는 `typecheck → lint → test → build` 순서를 유지합니다. 프론트엔드·공통 코드의 서버 의존성은 별도 타입 검사와 ESLint로 제한합니다.

디자인 예시 미리보기:

```bash
npx tsx scripts/preview/weekly-design.ts
npx tsx scripts/preview/story-art.ts
```

첫 명령은 `output/weekly-redesign/index.html`, 둘째는 `output/story-ai/index.html`을 만듭니다. 고정 예시 식단과 저장된 음식 그림을 사용하며 실제 게시를 실행하지 않습니다.

과거 최적화 측정과 장애 분석은 [audits](docs/audits)에, 이전 요구사항은 [archive](docs/archive)에 보관합니다. 현재 정책은 README와 운영 문서를 기준으로 확인하세요.

## 자산과 출처

국민연금체와 Pretendard를 로컬에 포함해 외부 폰트 다운로드 없이 렌더링합니다. 폰트별 안내와 라이선스는 [fonts](src/frontend/assets/fonts)에 있습니다. 해양이 캐릭터는 제공된 원본을 합성에 사용하며 생성형 AI에 전송하지 않습니다. 사용자 제공 배경 원본은 [디자인 참고 자료](docs/design-references)에 보관합니다.
