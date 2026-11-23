/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { resolvePartitionMigrationBudget } from "@noobot/session-protocol/session-reader";
import { fsLstat } from "../shared/storage/fs-adapter.js";
import {
  readPartitionMigrationReceipt,
  withSessionStorageAuthorityLock,
} from "../session/session-storage-authority.js";
import { readSessionDirectory } from "./session-directory-walk.js";
import { withExclusiveImmutableMigrationSource } from "./immutable-session-migration-source.js";
import { migrateImmutableSessionToPartition } from "./migrate-immutable-session-to-partition.js";
import { assertWorkspaceQuarantineEmpty } from "./migration-quarantine.js";
async function* sessionDirectories(directory, isRoot) {
  const { authority, legacyDocument, children } = await readSessionDirectory(directory);
  if (authority !== null) {
    if (isRoot || legacyDocument)
      throw Object.assign(new Error(`Unsupported session placement or predecessor: ${directory}`), {
        code: "SESSION_STORAGE_UPGRADE_BLOCKED",
      });
    yield { sessionDir: directory, authority };
  }
  for (const entry of children) yield* sessionDirectories(path.join(directory, entry.name), false);
}

async function readMigrationDirectory(directory) {
  let entry;
  try {
    entry = await fsLstat(directory);
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    return false;
  }
  if (!entry.isDirectory()) throw new TypeError(`Migration root is not a directory: ${directory}`);
  return true;
}

async function assertMigrationRoot(workspace, relative) {
  let directory = workspace;
  for (const segment of relative.split("/")) {
    directory = path.join(directory, segment);
    if (!(await readMigrationDirectory(directory))) return false;
  }
  return true;
}

export async function* discoverMigrationSessions(workspace, roots) {
  for (const root of roots) {
    if (!(await assertMigrationRoot(workspace, root))) continue;
    yield* sessionDirectories(path.join(workspace, root), true);
  }
}

async function inventoryPartitionSession(sessionDir, limits, { nativePartition, receipts }) {
  const receipt = await withSessionStorageAuthorityLock(sessionDir, () =>
    readPartitionMigrationReceipt(sessionDir, null, limits),
  );
  if (receipt === null) nativePartition.push(sessionDir);
  else receipts.push({ sessionDir, ...receipt });
}

export async function upgradeSessionPartitionStorage({
  base: workspace,
  scopedSessionRoots,
  targetStorageBudget,
  onSessionProcessed,
  signal,
}) {
  signal?.throwIfAborted();
  await assertWorkspaceQuarantineEmpty(workspace);
  const options = resolvePartitionMigrationBudget(targetStorageBudget);
  const pending = [];
  const receipts = [];
  const nativePartition = [];
  const roots = new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]);
  for await (const { sessionDir, authority } of discoverMigrationSessions(workspace, roots)) {
    signal?.throwIfAborted();
    if (authority === "partition") {
      await inventoryPartitionSession(sessionDir, options.targetStorageBudget.journalLimits, {
        nativePartition,
        receipts,
      });
      onSessionProcessed();
      continue;
    }
    const expectedSource = await withExclusiveImmutableMigrationSource(
      { sessionDir, expectedSource: null, signal },
      ({ identity }) => identity,
    );
    pending.push({ sessionDir, expectedSource });
  }
  for (const item of pending) {
    const receipt = await migrateImmutableSessionToPartition({ ...options, ...item, signal });
    receipts.push({ sessionDir: item.sessionDir, ...receipt });
    onSessionProcessed();
  }
  receipts.sort((left, right) => left.sessionDir.localeCompare(right.sessionDir));
  return { receipts, nativePartition: nativePartition.sort() };
}
