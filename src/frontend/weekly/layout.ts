/** Runs in the renderer's browser, after the weekly HTML has loaded. */
export async function layoutWeekly(): Promise<void> {
  await document.fonts.ready;
  if (!document.fonts.check('500 24px Meal', '식단')) throw new Error('주간 한글 폰트 로딩 실패');

  const sheet = document.querySelector<HTMLElement>('.sheet')!;
  const headerInset = parseFloat(getComputedStyle(sheet).getPropertyValue('--header-inset'));
  const headerGap = parseFloat(getComputedStyle(sheet).getPropertyValue('--header-gap'));
  const header = document.querySelector<HTMLElement>('header')!;
  const title = header.querySelector<HTMLElement>('h1')!;
  const date = header.querySelector<HTMLElement>('.range')!;
  const notice = header.querySelector<HTMLElement>('.update-notice');
  const calendar = document.querySelector<HTMLElement>('.calendar')!;
  const context = document.createElement('canvas').getContext('2d')!;
  const ink = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    const metrics = context.measureText(element.textContent!);
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    const baseline = box.top + metrics.fontBoundingBoxAscent;
    return { top: baseline - metrics.actualBoundingBoxAscent,
      bottom: baseline + metrics.actualBoundingBoxDescent,
      left: box.left - metrics.actualBoundingBoxLeft, right: box.left + metrics.actualBoundingBoxRight };
  };

  // Use visible glyphs, not the font's invisible leading, for the outer inset.
  const initialTitle = ink(title);
  header.style.top = `${header.offsetTop + headerInset - initialTitle.top}px`;
  header.style.left = `${header.offsetLeft + headerInset - initialTitle.left}px`;
  const heading = header.querySelector<HTMLElement>('.heading-row')!;
  const headingGap = parseFloat(getComputedStyle(heading).columnGap);
  const titleBounds = ink(title);
  const visibleLeftMargin = titleBounds.left - sheet.getBoundingClientRect().left;
  heading.style.columnGap = `${headingGap + visibleLeftMargin - (ink(date).left - titleBounds.right)}px`;
  const headerBottom = Math.max(ink(title).bottom, ink(date).bottom);
  if (notice) {
    // Reuse the existing header/weekday gap; a repost never adds a header row.
    const bounds = ink(notice);
    const space = headerGap - 8; // Weekday ink is lifted 8px inside its band.
    const noticeHeight = bounds.bottom - bounds.top;
    if (noticeHeight > space) throw new Error('주간 변경 안내가 헤더 여백을 초과합니다.');
    const top = headerBottom + (space - noticeHeight) / 2;
    notice.style.top = `${parseFloat(getComputedStyle(notice).top) + top - bounds.top}px`;
  }
  for (const element of [title, date, ...(notice ? [notice] : [])]) {
    if (ink(element).right > sheet.clientWidth - headerInset + 1) throw new Error('주간 제목이 이미지 영역을 초과합니다.');
  }
  calendar.style.top = `${headerBottom + headerGap}px`;

  const days = [...document.querySelectorAll<HTMLElement>('.day')];
  const cellsByDay = days.map(day => [...day.querySelectorAll<HTMLElement>('.cell')]);
  const rowCount = cellsByDay[0]!.length;
  const rows = Array.from({ length: rowCount }, (_, index) => cellsByDay.map(cells => cells[index]!));
  const weekdays = days.map(day => day.querySelector<HTMLElement>('.weekday')!);
  const dayTitleHeight = Math.max(...weekdays.map(node => ink(node).bottom - ink(node).top));
  const rowGap = parseFloat(getComputedStyle(days[0]!).rowGap);
  const available = calendar.getBoundingClientRect().height - dayTitleHeight - rowGap * rowCount;
  const overflow = () => new Error('주간 메뉴가 최소 글자 크기에서도 영역을 초과합니다.');
  const setSize = (cells: HTMLElement[], size: number) => cells.forEach(cell => {
    cell.querySelector<HTMLElement>('.menu')!.style.fontSize = `${size}px`;
  });
  const fitsWidth = (cell: HTMLElement) => {
    const menu = cell.querySelector<HTMLElement>('.menu')!;
    const box = menu.getBoundingClientRect();
    if (menu.scrollWidth > menu.clientWidth + 1) return false;
    return [...menu.querySelectorAll('p')].every(item => {
      const range = document.createRange();
      range.selectNodeContents(item);
      return [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1);
    });
  };

  // Measure naturally sized copies in the same column so borders and widths match.
  const measurements = rows.map(cells => {
    const copies = cells.map(cell => {
      const copy = cell.cloneNode(true) as HTMLElement;
      copy.style.cssText = `position:fixed;visibility:hidden;left:0;top:0;width:${cell.getBoundingClientRect().width}px;height:auto;`;
      cell.parentElement!.append(copy);
      return copy;
    });
    try {
      setSize(copies, 18);
      let needsWrap = false;
      copies.forEach((copy, index) => {
        const menu = copy.querySelector<HTMLElement>('.menu')!;
        const originalParts = cells[index]!.querySelectorAll('.menu-part');
        copy.querySelectorAll<HTMLElement>('.menu-part').forEach((part, partIndex) => {
          if (part.getBoundingClientRect().width > menu.getBoundingClientRect().width + 1) {
            part.classList.add('can-wrap');
            originalParts[partIndex]!.classList.add('can-wrap');
            needsWrap = true;
          }
        });
      });
      if (!copies.every(fitsWidth)) throw overflow();
      const minimum = Math.max(...copies.map(copy => copy.getBoundingClientRect().height));
      // An ordinary menu name may wrap only when it cannot fit at the minimum.
      let targetSize = needsWrap ? 18 : cells.every(cell => cell.querySelector('.empty')) ? 24 : 30;
      for (; targetSize >= 18; targetSize--) {
        setSize(copies, targetSize);
        if (copies.every(fitsWidth)) break;
      }
      if (targetSize < 18) throw overflow();
      const target = Math.max(...copies.map(copy => copy.getBoundingClientRect().height));
      const content = Math.max(...copies.map(copy => {
        const style = getComputedStyle(copy);
        return copy.getBoundingClientRect().height - parseFloat(style.paddingTop)
          - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
      }));
      return { minimum, target, targetSize, content };
    } finally { copies.forEach(copy => copy.remove()); }
  });

  const totalMinimum = measurements.reduce((sum, row) => sum + row.minimum, 0);
  if (available < totalMinimum) throw overflow();
  const allEmpty = rows.every(cells => cells.every(cell => cell.querySelector('.empty')));
  const totalTarget = measurements.reduce((sum, row) => sum + row.target, 0);
  const totalContent = measurements.reduce((sum, row) => sum + row.content, 0);
  const growth = totalTarget - totalMinimum;
  const heights = measurements.map(row => {
    if (allEmpty) return available / rowCount;
    if (available >= totalTarget) return row.target + (available - totalTarget) * row.content / totalContent;
    return row.minimum + (available - totalMinimum) * (row.target - row.minimum) / growth;
  });
  days.forEach(day => {
    day.style.gridTemplateRows = `${dayTitleHeight}px ${heights.map(height => `${height}px`).join(' ')}`;
  });
  // Lift only weekday ink 8px to separate it from the floating meal label.
  // Card geometry and the header's layout band remain unchanged.
  weekdays.forEach(node => {
    const band = node.parentElement!.getBoundingClientRect();
    const bounds = ink(node);
    node.style.transform = `translateY(${band.top + (dayTitleHeight - bounds.bottom + bounds.top) / 2 - bounds.top - 8}px)`;
  });
  const surfaces = [...sheet.querySelectorAll<HTMLElement>('.meal-surface')];
  rows.forEach((cells, index) => {
    const first = cells[0]!.getBoundingClientRect();
    const last = cells.at(-1)!.getBoundingClientRect();
    surfaces[index]!.style.cssText = `left:${first.left}px;top:${first.top}px;width:${last.right - first.left}px;height:${first.height}px;`;
  });
  const fitsHeight = (cell: HTMLElement) => {
    const style = getComputedStyle(cell);
    const contentBottom = cell.getBoundingClientRect().bottom
      - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
    return cell.querySelector<HTMLElement>('.menu')!.getBoundingClientRect().bottom <= contentBottom + 0.1;
  };
  rows.forEach((cells, index) => {
    let size = measurements[index]!.targetSize;
    for (; size >= 18; size--) {
      setSize(cells, size);
      if (cells.every(cell => fitsWidth(cell) && fitsHeight(cell))) break;
    }
    if (size < 18) throw overflow();
  });

  const table = calendar.getBoundingClientRect();
  for (const cells of rows) {
    const label = cells[0]!.querySelector<HTMLElement>('h2')!.getBoundingClientRect();
    const menu = cells[0]!.querySelector('.menu')!.getBoundingClientRect();
    if (label.bottom > menu.top || label.right > table.right || label.top < table.top) {
      throw new Error('주간 끼니 라벨이 메뉴 또는 식단표 영역과 겹칩니다.');
    }
    const first = cells[0]!.getBoundingClientRect();
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      const day = cell.closest('.day')!.getBoundingClientRect();
      if (box.bottom > table.bottom + 1 || box.left < day.left - 1 || box.right > day.right + 1
        || Math.abs(box.top - first.top) > 1 || Math.abs(box.bottom - first.bottom) > 1) {
        throw new Error('주간 메뉴 영역이 날짜 칸 또는 식단표를 침범합니다.');
      }
    }
  }
}
