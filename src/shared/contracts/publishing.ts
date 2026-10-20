import type { StoryMode } from './story.js';
import type { WeeklyKind, WeeklyPage } from './weekly.js';

export interface PostRecord {
  runId: string;
  date: string;
  mode: StoryMode;
  status: 'posting' | 'published' | 'failed';
  startedAt: string;
  imagePath: string;
  containerId?: string;
  containerIds?: string[];
  mediaId?: string;
  publishedAt?: string;
  error?: string;
}

export interface WeeklyRecord {
  week: string; kind: WeeklyKind; runId: string; status: 'preparing' | 'publishing' | 'published' | 'failed';
  startedAt: string; containerIds: string[]; images: string[]; caption: string;
  mediaId?: string; publishedAt?: string; error?: string;
  menuHash?: string;
  menuSnapshot?: WeeklyPage[];
  supersededMediaIds?: string[];
  pendingNotifications?: WeeklyReplacementNotice[];
  sourceEmptyNotified?: boolean;
}
export interface WeeklyReplacementNotice {
  runId: string; week: string; kind: WeeklyKind; oldMediaId: string; newMediaId?: string;
}
