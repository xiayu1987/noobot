/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import { clientFilePath as path } from "../../path-resolver.js";

const execute = promisify(execFile);
const entry = new URL("../../electron/main.js", import.meta.url).href;
const thresholds = new URL("../../../../shared/time-thresholds.js", import.meta.url).href;
const source = `
  import assert from 'node:assert/strict';
  import { EventEmitter } from 'node:events';
  import { registerHooks } from 'node:module';
  const root = process.argv[1];
  const handlers = new Map();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, getPath: () => root,
    whenReady: () => new Promise(() => {}), isReady: () => false,
  });
  globalThis.desktopTest = { app, handlers, root };
  process.resourcesPath = root;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'electron') return { url: 'test:electron', shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === 'test:electron') return {
        format: 'module', shortCircuit: true,
        source: 'export const app = globalThis.desktopTest.app; export const dialog = {}; export const ipcMain = { handle: (name, handler) => globalThis.desktopTest.handlers.set(name, handler) };',
      };
      if (url.endsWith('/runtime/logging.js')) return {
        format: 'module', shortCircuit: true,
        source: 'export function appendEarlyLog() {} export function installEarlyDiagnostics() {} export function createStartupLogger() { return new Proxy({}, { get: () => () => {} }); }',
      };
      if (url.endsWith('/runtime/config.js')) return {
        format: 'module', shortCircuit: true,
        source: 'export function createDesktopConfigManager() { return { ensureDesktopGlobalConfig: () => ({ workspaceRootPath: globalThis.desktopTest.root, superAdmin: {} }), saveConfigParamValues: () => {} }; }',
      };
      return next(url, context);
    },
  });
  await import(${JSON.stringify(entry)});
  const { TIME_THRESHOLDS } = await import(${JSON.stringify(thresholds)});
  assert.throws(() => TIME_THRESHOLDS.tools.processSettleGraceMs, /must be initialized/);
  const save = handlers.get('noobot:save-config-params');
  if (process.argv[2] === 'invalid') {
    assert.throws(() => save(null, {}), /invalid JSON/);
    process.exit(0);
  }
  save(null, {});
  assert.equal(TIME_THRESHOLDS.tools.processSettleGraceMs, 7000);
  save(null, {});
  assert.equal(TIME_THRESHOLDS.tools.processSettleGraceMs, 7000);
  process.exit(0);
`;

for (const invalid of [false, true]) {
  test(`desktop entry initializes workspace runtime parameters on first config load (invalid: ${invalid})`, async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-runtime-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      path.join(root, "runtime-params.json"),
      invalid
        ? "{invalid"
        : JSON.stringify({
            schemaVersion: 1,
            revision: 0,
            overrides: { "time.tools.processSettleGraceMs": 7000 },
            history: [],
          }),
    );
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    await execute(
      process.execPath,
      ["--input-type=module", "-e", source, root, invalid ? "invalid" : "valid"],
      { env },
    );
  });
}
