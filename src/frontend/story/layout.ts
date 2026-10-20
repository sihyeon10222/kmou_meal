/** Runs inside Chromium; keep its helpers self-contained for page.evaluate. */
export async function layoutStory(): Promise<void> {
  await document.fonts.ready;
  if (!document.fonts.check('500 50px Meal', '기숙사 식단')) throw new Error('한글 폰트 로딩 실패');
  const height = 1920, padding = 32, gap = 32, tolerance = 1;
  // A 48px pill extends 24px into its card; reserve another 40px before menu ink.
  const verticalPadding = 64;
  const story = document.querySelector<HTMLElement>('.story')!;
  const root = story.querySelector<HTMLElement>('.sections')!;
  const sections = [...root.querySelectorAll<HTMLElement>('.meal')];
  if (!sections.length) throw new Error('Story 메뉴 영역이 없습니다.');
  const snack = story.classList.contains('snack');
  const columns = snack ? 2 : 1;
  const rowCount = Math.ceil(sections.length / columns);
  const context = document.createElement('canvas').getContext('2d')!;
  const metrics = new Map<string, TextMetrics>();
  // Measure painted glyphs, excluding the font's invisible ascent/descent space.
  const ink = (element: Element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Empty notices have their own cap, including beside nonempty meals.
      const style = getComputedStyle(node.parentElement!);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.font = font;
      let offset = 0;
      for (const char of node.textContent ?? '') {
        const end = offset + char.length;
        if (char.trim()) {
          const key = `${font}:${char}`;
          let metric = metrics.get(key);
          if (!metric) { metric = context.measureText(char); metrics.set(key, metric); }
          range.setStart(node, offset); range.setEnd(node, end);
          const rect = range.getBoundingClientRect();
          const baseline = rect.top + metric.fontBoundingBoxAscent;
          top = Math.min(top, baseline - metric.actualBoundingBoxAscent);
          bottom = Math.max(bottom, baseline + metric.actualBoundingBoxDescent);
          left = Math.min(left, rect.left - metric.actualBoundingBoxLeft);
          right = Math.max(right, rect.left + metric.actualBoundingBoxRight);
        }
        offset = end;
      }
    }
    return { top, bottom, left, right };
  };

  const header = story.querySelector<HTMLElement>('header')!;
  const title = header.querySelector<HTMLElement>('h1')!;
  const date = header.querySelector<HTMLElement>('.date')!;
  header.style.paddingTop = `${Math.max(0, 188 - Math.min(ink(title).top, ink(date).top))}px`;
  header.style.left = `${header.offsetLeft + 64 - ink(title).left}px`;
  const headingGap = parseFloat(getComputedStyle(header).columnGap);
  const titleBounds = ink(title);
  const visibleLeftMargin = titleBounds.left - story.getBoundingClientRect().left;
  header.style.columnGap = `${headingGap + visibleLeftMargin - (ink(date).left - titleBounds.right)}px`;
  const headerBottom = Math.max(ink(title).bottom, ink(date).bottom);
  const firstLabel = sections[0]!.querySelector<HTMLElement>('h2')!;
  // The label straddles the boundary; place its visible top 32px after the header.
  root.style.top = `${root.offsetTop + headerBottom + gap - ink(firstLabel).top}px`;
  const available = height - padding - root.getBoundingClientRect().top - gap * (rowCount - 1);
  sections.forEach((section, index) => {
    section.style.left = snack && index % 2 ? `calc((100% + ${gap}px) / 2)` : '0';
  });
  const typography = (menu: HTMLElement, size: number) => {
    menu.style.fontSize = `${size}px`;
    menu.style.gap = `${Math.max(8, Math.round(size * .16))}px`;
  };
  const measure = (section: HTMLElement, size: number, centered = false) => {
    const menu = section.querySelector<HTMLElement>('.menu')!;
    typography(menu, size);
    menu.style.top = `${verticalPadding}px`;
    const first = ink(menu.firstElementChild!);
    menu.style.top = `${verticalPadding + section.getBoundingClientRect().top + verticalPadding - first.top}px`;
    const bounds = ink(menu);
    const box = section.getBoundingClientRect();
    if (centered) menu.style.top = `${parseFloat(menu.style.top) + (box.height - 2 * verticalPadding - (bounds.bottom - bounds.top)) / 2}px`;
    // Horizontal fit is independent of the final vertical centering.
    const fits = bounds.left >= box.left + padding - tolerance
      && bounds.right <= box.right - padding + tolerance
      && menu.scrollWidth <= menu.clientWidth + tolerance;
    return { content: bounds.bottom - bounds.top, fits };
  };
  const rowsFor = (sizes: number[]) => Array.from({ length: rowCount }, (_, index) =>
    Math.max(...sizes.slice(index * columns, (index + 1) * columns)));
  const allEmpty = sections.every(section => !section.querySelector('.dish:not(.empty)'));
  let size = allEmpty ? 36 : 48;
  let rows: number[] = [];
  for (; size >= 28; size--) {
    const measured = sections.map(section => measure(section, size));
    rows = rowsFor(measured.map(item => item.content));
    const fitsHeight = snack
      ? rows.every(row => row + 2 * verticalPadding <= available / rowCount)
      : rows.reduce((sum, row) => sum + row + 2 * verticalPadding, 0) <= available;
    if (measured.every(item => item.fits) && fitsHeight) break;
  }
  if (size < 28) throw new Error('메뉴가 이미지 영역을 초과합니다. 최소 글자 크기와 여백에서도 들어가지 않습니다.');
  const total = rows.reduce((sum, row) => sum + row, 0);
  const spare = available - total - 2 * verticalPadding * rowCount;
  const heights = rows.map(row => snack || allEmpty ? available / rowCount : row + 2 * verticalPadding + spare * row / total);
  const starts = heights.map((_, index) => heights.slice(0, index).reduce((sum, value) => sum + value + gap, 0));
  if (snack) heights.forEach((value, index) => root.style.setProperty(`--snack-row-${index + 1}`, `${value}px`));
  sections.forEach((section, index) => {
    const row = Math.floor(index / columns);
    section.style.top = `${starts[row]}px`;
    section.style.height = `${heights[row]}px`;
    measure(section, size, true);
  });

  const safe = root.getBoundingClientRect();
  if (Math.min(ink(title).top, ink(date).top) < 188 - tolerance
    || Math.abs(ink(date).left - ink(title).right - visibleLeftMargin) > tolerance
    || ink(date).right > 1080 - 64 + tolerance) throw new Error('Story 제목과 날짜가 겹치거나 안전 영역을 초과합니다.');
  sections.forEach((section, index) => {
    const box = section.getBoundingClientRect();
    const menu = section.querySelector<HTMLElement>('.menu')!;
    const bounds = ink(menu);
    const label = section.querySelector<HTMLElement>('h2')!;
    const labelBox = label.getBoundingClientRect();
    const previousRow = sections[index - columns]?.getBoundingClientRect();
    if (box.left < safe.left - tolerance || box.right > safe.right + tolerance || box.bottom > safe.bottom + tolerance
      || bounds.top < box.top + verticalPadding - tolerance || bounds.bottom > box.bottom - verticalPadding + tolerance
      || Math.abs((bounds.top - box.top) - (box.bottom - bounds.bottom)) > tolerance
      || labelBox.right > box.right - padding + tolerance || labelBox.bottom + 40 > bounds.top + tolerance
      || (previousRow && labelBox.top < previousRow.bottom) || !measure(section, size, true).fits) {
      throw new Error(`메뉴 레이아웃이 안전 영역을 초과합니다: ${section.className}`);
    }
  });
}
