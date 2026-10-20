import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
export async function readOptional(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); } catch (error) { if (!missing(error)) throw error; }
}
export async function save(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes); await rename(temporary, path);
}

