# 작업 지침

- 사용자가 별도로 테스트 실행을 요청하지 않으면 테스트를 실행하지 않는다. 필요한 빌드와 설치만 수행하고, 테스트 미실행 사실을 결과에 명시한다.
- Xcode 관련 작업은 연결된 모든 기기에 빌드 및 설치한다.

## 파일 구조와 모듈 경계

- 작업 전에 루트의 [file-structure.md](file-structure.md)를 읽고 현재 파일 배치와 의존성 규칙을 따른다.
- `src/frontend`는 HTML·CSS·브라우저 레이아웃을, `src/backend`는 외부 조회·인증·렌더링 실행·저장·게시를 담당한다.
- `src/shared`에는 공통 데이터 계약과 순수 함수만 둔다. frontend/shared에서 backend·Node.js·외부 서비스 SDK를 참조하지 않는다.
- 파일을 추가·이동하거나 책임을 변경하면 같은 작업에서 `file-structure.md`를 갱신한다.
- 구조 변경 시 import, CLI, 빌드 정적 자산, 테스트 수집, workflow Artifact·캐시 경로와 현재 문서 링크를 함께 확인한다.
- 디자인 공용 예시는 `fixtures/design`, 실제 응답 회귀 자료는 `tests/fixtures`, 참고 원본은 `docs/design-references`에 둔다.
- 현재 정책은 README와 `docs/operations`, `docs/requirements`를 따른다. `docs/archive`와 과거 감사 문서는 현재 요구사항으로 적용하지 않는다.

## GitHub Actions Validate KMOU 실패 예방

- CI 정의는 `.github/workflows/ci.yml`을 확인한다. 현재 검증 순서는 `npm run typecheck && npm run lint && npm test && npm run build`이며, 앞 단계가 실패하면 뒤 단계는 실행되지 않는다. 빌드 성공만으로 CI 전체 성공을 단정하지 않는다.
- 실행 환경은 `.nvmrc`와 `package.json`에 맞는 Node.js 24, `npm ci`로 설치한 잠금 파일 기준 의존성을 사용한다. CI의 Chromium 설치 방식은 `.github/actions/setup/action.yml`을 따른다.
- 실패 로그는 마지막 종료 코드만 보지 말고 실패한 단계, 테스트 이름, assertion과 관련 소스를 함께 읽는다. 오류 처리 테스트에서 의도적으로 출력한 HTTP 오류·재시도 메시지를 실제 실패 원인으로 오인하지 않는다.
- 렌더링 CSS를 변경하기 전에 관련 `tests/frontend/render*.test.ts`를 읽고 색상·레이아웃 계약과 CSS 선택자 우선순위를 확인한다. 테스트 실행은 사용자가 요청한 경우에만 수행한다.
- 주간 재게시의 `.changed-menu`는 조식·중식·석식 모두 `.update-notice`와 같은 `var(--changed)` 색상을 사용한다. 현재 토큰은 `#ff5f5f` (`rgb(255, 95, 95)`)이다. `.cell.dinner .changed-menu` 같은 더 구체적인 선택자로 별도 색상을 덮어쓰지 않는다. 변경 메뉴의 배경은 투명하게 유지하고 일반 메뉴까지 변경 색상을 적용하지 않는다. 최초 게시에는 변경 강조를 적용하지 않는다.
- 2026-10-20 제공 로그(`logs_106864389820.zip`)의 실패 사례: typecheck와 lint는 통과했으나 `tests/render-weekly.test.ts`의 `replacement colors only changed dishes red, matching the update notice`가 실패했다(205개 중 204개 통과). `templates/weekly.css`의 석식 전용 `#ff7a73` 규칙이 공통 `var(--changed)`를 덮어쓴 것이 원인이다. 이와 같은 계약 위반은 원인 CSS에서 수정하며, 통과시키기 위해 assertion을 삭제하거나 CI 검증을 생략하지 않는다.

- 구조 개편 후 주간 CSS는 `src/frontend/weekly/styles.css`, 해당 회귀 검증은 `tests/frontend/render-weekly.test.ts`에 있다. 위 실패 사례의 옛 경로는 당시 기록이다.
