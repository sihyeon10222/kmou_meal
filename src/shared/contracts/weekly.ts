import type { MenuSection } from './menu.js';

export const WEEKLY_KINDS = ['combined', 'badaro', 'dormitory'] as const;
export type WeeklyKind = typeof WEEKLY_KINDS[number];
export type WeeklyPageKind = 'snack' | 'teacher' | 'badaro' | 'dormitory';
export interface WeeklyRange { monday: string; dates: string[]; week: string }
export interface WeeklyData {
  kind: WeeklyKind;
  week: string;
  monday: string;
  caption: string;
  updatedOn?: string;
  /** Rendering-only restaurant differences from the last successful post. */
  updatedKinds?: WeeklyPageKind[];
  /** Rendering-only differences from the last successful post; not stored in menu snapshots. */
  menuChanges?: { kind: WeeklyPageKind; date: string; section: string; indexes: number[] }[];
  pages: WeeklyPage[];
}
export interface WeeklyPage {
  kind: WeeklyPageKind;
  days: { date: string; sections: MenuSection[] }[];
}

export interface WeeklyImages { images: string[]; master?: string }
