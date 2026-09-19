import { resolveBatchMode, resolveManualStoryMode } from '../src/story-modes.js';
import { validateDate } from '../src/dates.js';

const baseDate = process.env.INPUT_BASE_DATE?.trim();
if (baseDate) validateDate(baseDate);

const kind = process.env.INPUT_KIND ?? 'batch';
if (kind !== 'batch' && kind !== 'manual') throw new Error('지원하지 않는 워크플로입니다.');
const mode = kind === 'manual'
  ? resolveManualStoryMode(process.env.INPUT_DAY ?? '', process.env.INPUT_RESTAURANT ?? '', process.env.INPUT_MEAL ?? '')
  : resolveBatchMode(process.env.INPUT_MODE || undefined);
console.log(mode);
