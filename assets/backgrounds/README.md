# Menu backgrounds

Original PNGs supplied by the user on 2026-10-11; no image edits.

- `dormitory-badaro.png`: `BG_기숙사, 승선생활관.png` (사용자 제공 원본) (2160×1440), for dormitory and Badaro weekly posts.
- `snack-teacher.png`: `Background.zip` → `BG_학식, 기숙사식당.png` (1080×1440), for cafeteria and staff restaurant weekly posts, as explicitly requested.
- `story.png`: `BG_스토리.png` (1080×1920), for every restaurant's stories.

All three images are repository assets required by GitHub Actions. The renderer reads them relative to its module, never from Downloads or the working directory, and embeds them as data URLs in the HTML. Both source execution and the compiled `dist/` renderer use the same repository assets. No network request or signed image URL is needed during rendering.

Images use centered `background-size: cover` at their original aspect ratios.
Transparency, blur and highlights belong to the cards and labels, not the photo.
