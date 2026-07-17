/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { clientFilePath as path } from "../path-resolver.js";
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getDesktopRipgrepPackages, getRipgrepBinaryRelativePath } from './desktop-ripgrep-packages.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const desktopProjectDir = process.env.NOOBOT_DESKTOP_PROJECT_DIR || process.cwd();
const desktopTargetArch = process.env.NOOBOT_DESKTOP_ARCH || process.env.npm_config_arch || process.arch;
const outRoot = path.join(desktopProjectDir, 'build/backend-runtime');
const backendRoot = path.join(outRoot, 'backend');

const runtimeWorkspaces = [
  'service',
  'agent',
  'agent-proxy',
  'model-proxy',
  'shared',
  'runtime-events',
  'sanitize',
  'i18n',
  'workflow',
  'plugin/noobot-plugin-harness',
  'plugin/noobot-plugin-workflow',
];
const runtimeAssetDirs = ['user-template'];
const ignore = /(^|[/\\])(?:node_modules|\.git|__tests__|test|tests|\.cache|dist|coverage)([/\\]|$)|\.(?:map|md)$/i;
const privateConfigFileNames = new Set(['global.config.json', 'config.json', 'agent-proxy.config.json', 'model-proxy.config.json']);

function shouldCopyRuntimeFile(fromRoot, src) {
  const relativePath = path.relative(fromRoot, src);
  const normalizedRelativePath = relativePath.split(path.sep).join('/');
  if (normalizedRelativePath.startsWith('src/system-core/system-prompt/')) return true;
  if (ignore.test(relativePath)) return false;
  if (privateConfigFileNames.has(path.basename(src))) return false;
  return true;
}

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
  console.error(`  desktopTargetArch: ${desktopTargetArch}`);
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
    filter: (src) => shouldCopyRuntimeFile(from, src),
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

function getNpmCommand() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      argsPrefix: [process.env.npm_execpath],
      label: `${process.execPath} ${process.env.npm_execpath}`,
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
    label: process.platform === 'win32' ? 'npm.cmd' : 'npm',
  };
}

async function main() {
  log(`repoRoot=${repoRoot}`);
  log(`backendRoot=${backendRoot}`);
  log(`Node=${process.version}; platform=${process.platform}; arch=${process.arch}; targetArch=${desktopTargetArch}`);

  log(`Cleaning ${outRoot}`);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(backendRoot, { recursive: true });

  for (const name of runtimeWorkspaces) {
    await copyDir(name);
  }

  for (const name of runtimeAssetDirs) {
    await copyDir(name);
  }

  log('Writing runtime package.json');
  const rootPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const servicePkg = JSON.parse(await readFile(path.join(repoRoot, 'service/package.json'), 'utf8'));
  const agentPkg = JSON.parse(await readFile(path.join(repoRoot, 'agent/package.json'), 'utf8'));
  const desktopPkg = JSON.parse(await readFile(path.join(desktopProjectDir, 'package.json'), 'utf8'));
  await writeFile(path.join(backendRoot, 'package.json'), JSON.stringify({
    name: 'noobot-backend-runtime',
    version: rootPkg.version,
    private: true,
    workspaces: runtimeWorkspaces,
    overrides: servicePkg.overrides || {},
  }, null, 2));

  const npmCommand = getNpmCommand();
  log(`npm runner: ${npmCommand.label}`);
  run(npmCommand.command, [...npmCommand.argsPrefix, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--fund=false'], {
    cwd: backendRoot,
  });

  // npm filters optional dependencies by CPU. electron-builder also targets the
  // current architecture by default, so bundle the matching binary only.
  const ripgrepVersion = agentPkg.dependencies?.['@vscode/ripgrep'];
  if (!ripgrepVersion) fail('agent dependency @vscode/ripgrep is missing');
  const ripgrepPackages = getDesktopRipgrepPackages(desktopPkg.name, ripgrepVersion, desktopTargetArch);
  if (!ripgrepPackages.length) {
    fail(`No bundled ripgrep package mapping for ${desktopPkg.name} on ${desktopTargetArch}`);
  } else {
    run(npmCommand.command, [
      ...npmCommand.argsPrefix,
      'install',
      '--no-save',
      '--force',
      '--ignore-scripts',
      '--no-audit',
      '--fund=false',
      ...ripgrepPackages,
    ], { cwd: backendRoot });
    await Promise.all(ripgrepPackages.map((packageSpec) =>
      assertExists(path.join(backendRoot, getRipgrepBinaryRelativePath(packageSpec)), `Bundled ripgrep binary ${packageSpec}`)));
  }

  await assertExists(path.join(backendRoot, 'service/app.js'), 'Prepared backend entry');
  await assertExists(path.join(backendRoot, 'agent/src/system-core/system-prompt/base.md'), 'Prepared backend system prompt');
  await assertExists(path.join(backendRoot, 'agent/src/system-core/system-prompt/base.zh-CN.md'), 'Prepared backend Chinese system prompt');
  await assertExists(path.join(backendRoot, 'agent/src/system-core/system-prompt/base.en-US.md'), 'Prepared backend English system prompt');
  await assertExists(path.join(backendRoot, 'node_modules/noobot-agent/package.json'), 'Prepared backend dependency noobot-agent');
  await assertExists(path.join(backendRoot, 'node_modules/@noobot/sanitize/package.json'), 'Prepared backend dependency @noobot/sanitize');
  await assertExists(path.join(backendRoot, 'node_modules/express/package.json'), 'Prepared backend dependency express');
  log(`Prepared backend runtime: ${backendRoot}`);
}

main().catch((error) => fail('Unexpected failure while preparing backend runtime', error));
