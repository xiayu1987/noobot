/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { MIGRATION_UNMAPPABLE_CODE, createMigrationError } from "@noobot/shared/migration";
import {
  MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND,
  migrateModelContextSnapshot,
} from "@noobot/context-protocol/policy/snapshot-migration";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
} from "../session/session-artifact-files.js";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { ignoreSessionProgress, walkSessionManifestDirectories } from "./session-directory-walk.js";

const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT;

async function listSnapshotFiles(sessionDir) {
  const directory = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.modelMessageSnapshotsDir);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

function parseSnapshot(text, filePath) {
  try {
    return JSON.parse(text);
  } catch {
    throw createMigrationError({
      kind: MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND,
      reason: "invalid_json",
      details: { filePath },
    });
  }
}

async function upgradeSnapshotFile({ base, backupBase, filePath }) {
  const snapshot = parseSnapshot(await readFile(filePath, "utf8"), filePath);
  const result = migrateModelContextSnapshot(snapshot);
  if (!result.migrated) return null;
  const relativePath = path.relative(base, filePath);
  const backupPath = path.join(backupBase, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(filePath, backupPath);
  await writeFileAtomic({
    filePath,
    content: `${JSON.stringify(result.document, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
  return {
    path: relativePath,
    fromVersion: result.fromVersion,
    toVersion: result.toVersion,
    backupPath,
  };
}

async function upgradeSessionSnapshots({ base, backupBase, sessionDir, quarantined }) {
  const migrated = [];
  for (const filePath of await listSnapshotFiles(sessionDir)) {
    try {
      const result = await upgradeSnapshotFile({ base, backupBase, filePath });
      if (result) migrated.push(result);
    } catch (error) {
      quarantined.push(
        await quarantineMigrationUnit({
          base,
          kind: QUARANTINE_KIND,
          relativePath: path.relative(base, filePath),
          error,
          move: error?.code === MIGRATION_UNMAPPABLE_CODE,
        }),
      );
    }
  }
  return migrated;
}

export async function upgradeModelContextSnapshots({
  base,
  backupBase,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("model context snapshot upgrade requires scopedSessionRoots");
  }
  const migrated = [];
  const quarantined = [];
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root))) {
      migrated.push(
        ...(await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () => upgradeSessionSnapshots({ base, backupBase, sessionDir, quarantined }),
        )),
      );
      onSessionProcessed();
    }
  }
  return { migrated, quarantined };
}
