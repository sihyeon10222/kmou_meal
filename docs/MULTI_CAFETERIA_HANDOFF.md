# 3종 식당 확장 완료 상태 — 2026-09-19

기준: 사용자가 제공한 `KMOU_Multi_Cafeteria_Expansion_Handoff_2026-09-19.md`.

## 구현

- `fetch-coop-menu.ts`: 같은 학식 페이지에 날짜 POST → Cheerio HTML 파싱. th 제목으로 스낵/교직원 표 식별, 4/3개의 td가 있는 메뉴 행 추출. 가격 제외. 표가 없으면 오류, 메뉴 행만 없으면 빈 메뉴.
- `story-modes.ts`: 14개 Story + 3개 batch. 기준일은 한국 날짜이며 tomorrow는 하루를 더함. 주말 판별은 대상 날짜 기준. 개별 실행도 주말 학식 skip.
- `run-stories.ts`: 기숙사 → 스낵 → 교직원 순차 처리. 한 Story 실패 후 다음 Story 계속. 최종 실행은 실패 종료하고 run JSON에 모든 결과 저장. 학식은 한 배치에서 한 번 조회.
- 렌더링: 1080×1920, 공통 팔레트/폰트/헤더/푸터. 스낵은 비대칭 4영역 한 장. 교직원 full은 조식/중식/석식 한 장. 빈 영역은 `등록된 식단 없음` 유지. 글자 축소 후에도 넘치면 오류; 메뉴 삭제 없음.
- 기존 runId별 재게시 허용, Instagram 24/2207006 한 번 복구, Storage 공개 URL 검증 유지.

## 운영

cron-job.org의 기존 작업을 직접 편집하고 페이지 재진입으로 저장 확인:

| 작업 | 한국시간 | 입력 |
| --- | --- | --- |
| kmou_today_lunch | 10:00 | today_lunch_batch |
| kmou_today_dinner | 16:00 | today_dinner_batch |
| kmou_tomorrow_full | 22:00 | tomorrow_full_batch |

세 작업 모두 활성화, Asia/Seoul, 기존 POST URL·헤더 유지. 본문은 `run_mode`와 `preview_only:false` 사용.
GitHub 자체 schedule 없음. 이전 story_mode 요청도 대응 batch로 변환하는 호환 필드 유지. 수동 실행은 run_mode만 사용.

## 검증

- typecheck / 35 tests / build 통과.
- 실제 2026-09-18 HTML의 7개 분류 추출 및 렌더링 성공. 2026-09-19 토요일 원본은 7개 배열이 모두 빈 값임을 확인.
- 평일 점심 3장 / 저녁 2장 / 다음날 full 3장 preview 성공.
- 금요일 밤의 토요일 대상은 기숙사만 생성, 일요일 밤의 월요일 대상은 3종 생성 확인.
- 자동 복구·재게시·실패 후 다음 식당 게시·주말 skip·평일 공휴일 empty는 모의 테스트 포함.
- GitHub Actions 미리보기 성공: https://github.com/sihyeon10222/kmou_meal/actions/runs/35365344072 (구현 커밋 5c1a07d). 실행 당일은 토요일이므로 학식 skip, 기숙사 이미지와 Artifact 생성.
- 이번 변경 검증에서는 Instagram 실제 추가 게시를 실행하지 않음. 새 배치의 정기 실게시 결과는 다음 예약 실행에서 확인 가능.

## 재실행

실패한 식당만 `npm start -- today_teacher_lunch` 같은 개별 모드로 실행할 수 있음.
전체 배치를 다시 실행하면 앞서 성공한 식당도 재게시됨. 이전 게시 기록을 지울 필요 없음.
모든 `npm run preview -- <run_mode> [기준일]`은 게시하지 않음.
