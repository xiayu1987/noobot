import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const outRoot = path.join(repoRoot, 'client/windows/build/backend-runtime');
const backendRoot = path.join(outRoot, 'backend');

const ignore = /(^|[/\\])(?:node_modules|\.git|__tests__|test|tests|\.cache|dist|coverage)([/\\]|$)|\.(?:map|md)$/i;
async function copyDir(name) {
  await cp(path.join(repoRoot, name), path.join(backendRoot, name), {
    recursive: true,
    filter: (src) => !ignore.test(path.relative(path.join(repoRoot, name), src)),
  });
}

await rm(outRoot, { recursive: true, force: true });
await mkdir(backendRoot, { recursive: true });
for (const name of ['service', 'agent', 'shared', 'i18n']) await copyDir(name);

const rootPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
await writeFile(path.join(backendRoot, 'package.json'), JSON.stringify({
  name: 'noobot-backend-runtime',
  version: rootPkg.version,
  private: true,
  workspaces: ['service', 'agent', 'shared', 'i18n'],
  overrides: JSON.parse(await readFile(path.join(repoRoot, 'service/package.json'), 'utf8')).overrides || {},
}, null, 2));

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts'], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Prepared backend runtime: ${backendRoot}`);
