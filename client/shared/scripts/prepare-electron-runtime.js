/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { clientFilePath as path } from "../path-resolver.js";
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const desktopProjectDir = process.env.NOOBOT_DESKTOP_PROJECT_DIR || process.cwd();
const outRoot = path.join(desktopProjectDir, 'build/electron');
const sharedElectronRoot = path.join(repoRoot, 'client/shared/electron');
const entryPoint = path.join(desktopProjectDir, 'src/main.js');
const preloadSource = path.join(sharedElectronRoot, 'preload.cjs');
const startupSource = path.join(sharedElectronRoot, 'startup');
const startupFallbackSource = path.join(sharedElectronRoot, 'startup.html');

function log(message) {
  console.log(`[prepare-electron] ${message}`);
}

function fail(message, error) {
  console.error(`\n[prepare-electron] ERROR: ${message}`);
  if (error) console.error(error?.stack || error?.message || error);
  console.error('\n[prepare-electron] Diagnostic context:');
  console.error(`  cwd: ${process.cwd()}`);
  console.error(`  repoRoot: ${repoRoot}`);
  console.error(`  desktopProjectDir: ${desktopProjectDir}`);
  console.error(`  outRoot: ${outRoot}`);
  process.exit(1);
}

async function assertExists(targetPath, label) {
  try {
    await stat(targetPath);
  } catch (error) {
    fail(`${label} not found: ${targetPath}`, error);
  }
}

async function copyIfExists(from, to, options = {}) {
  try {
    await stat(from);
  } catch {
    return false;
  }
  await rm(to, { recursive: true, force: true });
  await cp(from, to, options);
  return true;
}

async function main() {
  await assertExists(entryPoint, 'Electron main entry');
  await assertExists(preloadSource, 'Electron preload source');

  log(`Cleaning ${outRoot}`);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  log(`Bundling ${entryPoint}`);
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: path.join(outRoot, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: false,
    external: ['electron', 'node:*'],
    logLevel: 'info',
  });

  log(`Copying preload: ${preloadSource}`);
  await cp(preloadSource, path.join(outRoot, 'preload.cjs'));

  const copiedStartup = await copyIfExists(startupSource, path.join(outRoot, 'startup'), { recursive: true });
  if (copiedStartup) log(`Copied startup runtime: ${startupSource}`);
  const copiedFallback = await copyIfExists(startupFallbackSource, path.join(outRoot, 'startup.html'));
  if (copiedFallback) log(`Copied startup fallback: ${startupFallbackSource}`);

  await assertExists(path.join(outRoot, 'main.js'), 'Bundled Electron main');
  await assertExists(path.join(outRoot, 'preload.cjs'), 'Bundled Electron preload');
  log(`Prepared Electron runtime: ${outRoot}`);
}

main().catch((error) => fail('Unexpected failure while preparing Electron runtime', error));
