/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  activateRuntimeParams,
  validateRuntimeParamsDocument,
} from "@noobot/shared/runtime-params";
import { requireOfflineWorkspacePartitionMigrationPlan } from "@noobot/session-protocol/session-reader";
import {
  prepareWorkspaceLayout,
  resolveWorkspaceBackupBase,
} from "../src/workspace-lifecycle/sections.js";
import { collectSessionPluginRoots } from "../src/extensions/plugins/session-plugin-runtime-provider.js";
import { StorageService } from "../src/session/storage-service.js";
import { ATOMIC_RENAME_RETRY_DELAYS_MS } from "../src/shared/storage/atomic-file-write.js";

async function upgradeWorkspace(input, signal) {
  const { workspaceDir, pluginRootDir, targetStorageBudget } =
    requireOfflineWorkspacePartitionMigrationPlan(input);
  if (!isAbsolute(workspaceDir) || !isAbsolute(pluginRootDir))
    throw new TypeError("Workspace and plugin directory paths must be absolute");
  const [base, pluginDirectory] = await Promise.all([
    realpath(workspaceDir),
    realpath(pluginRootDir),
  ]);
  if (!(await lstat(base)).isDirectory() || !(await lstat(pluginDirectory)).isDirectory())
    throw new TypeError("Workspace and plugin paths must be directories");
  const scopedSessionRoots = await collectSessionPluginRoots({ pluginRootDir: pluginDirectory });
  const storageService = new StorageService({
    atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
    platform: process.platform,
  });
  const backupBase = resolveWorkspaceBackupBase(base);
  return prepareWorkspaceLayout({
    base,
    backupBase,
    resetSections: [],
    created: false,
    scopedSessionRoots,
    storageService,
    targetStorageBudget,
    signal,
  });
}

const [operation, runtimeParamsFile, planFile, ...extra] = process.argv.slice(2);
if (operation !== "--upgrade-workspace" || !runtimeParamsFile || !planFile || extra.length !== 0)
  throw new TypeError(
    "Usage (offline): node agent/scripts/migrate-session-storage.js --upgrade-workspace <runtime-params.json> <migration-plan.json>",
  );

if (!isAbsolute(runtimeParamsFile)) throw new TypeError("runtime params path must be absolute");
activateRuntimeParams(
  validateRuntimeParamsDocument(JSON.parse(await readFile(runtimeParamsFile, "utf8"))),
);
const input = JSON.parse(await readFile(planFile, "utf8"));
const controller = new AbortController();
const { signal } = controller;
const interrupt = (name, exitCode) => {
  if (signal.aborted) return;
  process.exitCode = exitCode;
  controller.abort(new Error(`Session storage migration interrupted by ${name}`));
};
const onInterrupt = () => interrupt("SIGINT", 130);
const onTerminate = () => interrupt("SIGTERM", 143);
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
try {
  const report = await upgradeWorkspace(input, signal);
  signal.throwIfAborted();
  console.log(JSON.stringify(report));
} catch (error) {
  if (error !== signal.reason) throw error;
  console.error(error.message);
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}
