const seoulDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date는 순간을 의미하며, 한국에서 해당 순간의 날짜를 사용합니다. */
export function seoulDate(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('유효하지 않은 날짜입니다.');
  const parts = seoulDateFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('존재하지 않는 날짜입니다.');
  }
  return date;
}
