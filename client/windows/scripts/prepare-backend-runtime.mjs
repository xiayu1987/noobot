import { cp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const outRoot = path.join(repoRoot, 'client/windows/build/backend-runtime');
const backendRoot = path.join(outRoot, 'backend');

const runtimeWorkspaces = ['service', 'agent', 'shared', 'i18n'];
const ignore = /(^|[/\\])(?:node_modules|\.git|__tests__|test|tests|\.cache|dist|coverage)([/\\]|$)|\.(?:map|md)$/i;

function log(message) {
  console.log(`[prepare-backend] ${message}`);
}

function fail(message, error) {
  console.error(`\n[prepare-backend] ERROR: ${message}`);
  if (error) {
    console.error(error?.stack || error?.message || error);
  }
  console.error('\n[prepare-backend] Diagnostic context:');
  console.error(`  platform: ${process.platform}`);
  console.error(`  node: ${process.version}`);
  console.error(`  cwd: ${process.cwd()}`);
  console.error(`  repoRoot: ${repoRoot}`);
  console.error(`  outRoot: ${outRoot}`);
  console.error(`  backendRoot: ${backendRoot}`);
  process.exit(1);
}

async function assertExists(targetPath, label) {
  try {
    await access(targetPath);
  } catch (error) {
    fail(`${label} not found: ${targetPath}`, error);
  }
}

async function copyDir(name) {
  const from = path.join(repoRoot, name);
  const to = path.join(backendRoot, name);
  await assertExists(from, `Source directory ${name}`);
  log(`Copying ${name}: ${from} -> ${to}`);
  await cp(from, to, {
    recursive: true,
    filter: (src) => !ignore.test(path.relative(from, src)),
  });
}

function run(command, args, options) {
  log(`Running: ${command} ${args.join(' ')}`);
  log(`Command cwd: ${options.cwd}`);
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...(options.env || {}),
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`Failed to start command: ${command}`, result.error);
  if (result.status !== 0) {
    console.error(`\n[prepare-backend] Command failed with exit code ${result.status ?? 'unknown'}: ${command} ${args.join(' ')}`);
    if (result.signal) console.error(`[prepare-backend] Signal: ${result.signal}`);
    process.exit(result.status || 1);
  }
}

async function main() {
  log(`repoRoot=${repoRoot}`);
  log(`backendRoot=${backendRoot}`);
  log(`Node=${process.version}; platform=${process.platform}; arch=${process.arch}`);

  log(`Cleaning ${outRoot}`);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(backendRoot, { recursive: true });

  for (const name of runtimeWorkspaces) {
    await copyDir(name);
  }

  log('Writing runtime package.json');
  const rootPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const servicePkg = JSON.parse(await readFile(path.join(repoRoot, 'service/package.json'), 'utf8'));
  await writeFile(path.join(backendRoot, 'package.json'), JSON.stringify({
    name: 'noobot-backend-runtime',
    version: rootPkg.version,
    private: true,
    workspaces: runtimeWorkspaces,
    overrides: servicePkg.overrides || {},
  }, null, 2));

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCommand, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--fund=false'], {
    cwd: backendRoot,
  });

  await assertExists(path.join(backendRoot, 'service/app.js'), 'Prepared backend entry');
  await assertExists(path.join(backendRoot, 'node_modules/express/package.json'), 'Prepared backend dependency express');
  log(`Prepared backend runtime: ${backendRoot}`);
}

main().catch((error) => fail('Unexpected failure while preparing backend runtime', error));
