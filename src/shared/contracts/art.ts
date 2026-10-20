export type StoryArtMode = 'off' | 'cache' | 'generate';

export function artMode(value: string | undefined, fallback: StoryArtMode): StoryArtMode {
  if (value === undefined || value === '') return fallback;
  if (value !== 'off' && value !== 'cache' && value !== 'generate') throw new Error('Story art: off / cache / generate');
  return value;
}

