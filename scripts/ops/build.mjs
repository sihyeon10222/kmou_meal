import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
const compiler = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root))], {
  cwd: fileURLToPath(root), stdio: 'inherit',
});
if (compiler.error) throw compiler.error;
if (compiler.status !== 0) process.exit(compiler.status ?? 1);

// TypeScript emits browser code; keep its HTML, CSS, fonts and artwork alongside it.
const frontend = new URL('src/frontend/', root);
for (const entry of await readdir(frontend, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || entry.name.endsWith('.ts')) continue;
  const source = pathToFileURL(join(entry.parentPath, entry.name));
  const assetPath = relative(fileURLToPath(frontend), fileURLToPath(source));
  const destination = pathToFileURL(join(fileURLToPath(dist), 'frontend', assetPath));
  await mkdir(new URL('./', destination), { recursive: true });
  await cp(source, destination);
}
