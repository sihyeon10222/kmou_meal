# 해양이

`haeyangi.png`는 사용자가 제공한 `KMOUAI/해양이캐릭터.png` 원본입니다.
캐릭터는 생성형 AI 입력으로 전송하지 않고 투명 여백 제거·비율 유지 리사이즈·합성에만 사용합니다.
음식 그림만 Cloudflare Workers AI에서 생성합니다. 말풍선·해/달·연결 원은 로컬에서 합성합니다.

`docs/design-references/food-bubble-reference.png`는 사용자가 추가로 제공한 점심 말풍선 예시를 최대 448px로 축소한 디자인 참고 이미지입니다. 실행 중 읽거나 AI에 전송하지 않습니다.

`story-lunch-heading.png`와 `story-dinner-heading.png`는 `scripts/assets/render-story-art-headings.ts`에서 내장 국민연금체로 만든 제목입니다. 음식 이미지와 별도로 합성하므로 AI 재생성 없이 동일한 제목을 유지합니다.
