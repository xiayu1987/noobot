/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { IMMUTABLE_SESSION_HEAD_FILE } from "@noobot/session-protocol/immutable-storage";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { MIGRATION_UNMAPPABLE_CODE, createMigrationError } from "@noobot/shared/migration";
import {
  MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND,
  migrateModelContextSnapshot,
  restoreSnapshotPhaseSummaryBodies,
} from "@noobot/session-repair";
import { readSessionArtifact } from "../session/session-artifact-store.js";
import { ImmutableSessionStore } from "../session/session-artifact-session/immutable-session-store.js";
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
    if (error?.code === "ENOENT") return [];
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

async function upgradeSnapshotFile({
  base,
  backupBase,
  filePath,
  readMessage,
  restoreSummaryBodies,
}) {
  const snapshot = parseSnapshot(await readFile(filePath, "utf8"), filePath);
  const result = migrateModelContextSnapshot(snapshot);

  const document = restoreSummaryBodies
    ? await restoreSnapshotPhaseSummaryBodies(result.document, readMessage)
    : result.document;
  if (
    !result.migrated &&
    document.messages.every(
      (message, index) => message.content === snapshot.messages[index].content,
    )
  )
    return null;
  const relativePath = path.relative(base, filePath);
  const backupPath = path.join(backupBase, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(filePath, backupPath);
  await writeFileAtomic({
    filePath,
    content: `${JSON.stringify(document, null, 2)}\n`,
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

async function upgradeSessionSnapshots({
  base,
  backupBase,
  sessionDir,
  quarantined,
  storageService,
  restoreSummaryBodies,
}) {
  const migrated = [];
  let reader;
  const readMessage = async (uid) => {
    if (!reader) {
      if (await storageService.exists(path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE))) {
        const store = await ImmutableSessionStore.open({ sessionDir });
        const snapshot = await store.snapshot();
        reader = async (key) => (await store.get(snapshot, "messages", key))?.message;
      } else {
        const session = await readSessionArtifact({ storageService, sessionDir });
        const messages = new Map(session.messages.map((message) => [message.messageUid, message]));
        reader = async (key) => messages.get(key);
      }
    }
    return reader(uid);
  };
  for (const filePath of await listSnapshotFiles(sessionDir)) {
    try {
      const result = await upgradeSnapshotFile({
        base,
        backupBase,
        filePath,
        readMessage,
        restoreSummaryBodies,
      });
      migrated.push(...(result === null ? [] : [result]));
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
  storageService,
  onSessionProcessed = ignoreSessionProgress,
  restoreSummaryBodies = false,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("model context snapshot upgrade requires scopedSessionRoots");
  }
  const migrated = [];
  const quarantined = [];
  for (const root of new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots])) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root), {
      includeImmutable: true,
    })) {
      migrated.push(
        ...(await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () =>
            upgradeSessionSnapshots({
              base,
              backupBase,
              sessionDir,
              quarantined,
              storageService,
              restoreSummaryBodies,
            }),
        )),
      );
      onSessionProcessed();
    }
  }
  return { migrated, quarantined };
}
