# Bundled fonts

Stories and weekly posts use NationalPension (국민연금체), published by the
National Pension Service. `NPSfontRegular.woff2` is used for menu text and dates,
`NPSfontBold.woff2` for labels and emphasis, and `NPSfontExtraBold.woff2` for restaurant titles.
The renderer's `Meal` and `MealTitle` aliases refer to these local files.
The three files were downloaded unchanged from the user-specified
`https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2310@1.0/` URLs.
See `NPSfont-LICENSE.txt` for the usage summary and the
[publisher's release and usage notice](https://www.npsonair.kr/notice/detail.html?strIdx=2936).

`PretendardVariable.woff2` from [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9)
remains bundled as a fallback for characters outside NationalPension's glyph set.
Its license is in `Pretendard-LICENSE.txt`. All fonts are embedded locally in the generated HTML.

## Previous fonts

`NanumSquareRoundR.woff2`, `NanumSquareRoundB.woff2`, and `NanumSquareRoundEB.woff2`
were downloaded unchanged from `https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareRound/`.
Distributed under SIL OFL 1.1; see `NanumSquareRound-LICENSE.txt` and
[NAVER's license notice](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko).

`NotoSansKR.ttf` is the variable font from [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosanskr).
Distributed under the SIL Open Font License 1.1; see `OFL.txt`.
The bundled font makes Korean rendering independent of the runner's installed fonts.
