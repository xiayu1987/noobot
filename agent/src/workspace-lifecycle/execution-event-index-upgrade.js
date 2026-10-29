/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import {
  EXECUTION_EVENT_INDEX_ERROR_CODE,
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
  EXECUTION_EVENT_SEGMENT_ERROR_CODE,
  requireSessionExecutionIndex,
  upgradeLegacyV2SessionExecutionIndex,
  upgradeLegacyV2TurnExecutionIndex,
} from "@noobot/session-protocol/execution-event-index";
import { runAtomicSessionRepair } from "@noobot/session-repair";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session/session-artifact-files.js";
import { requireStorageService } from "../session/storage-service.js";
import {
  readExecutionSegmentState,
  readRegisteredExecutionTurns,
  resolveExecutionEventsDir,
  resolveExecutionTurnDir,
  writeExecutionTurnIndex,
  writeSessionExecutionIndex,
} from "../session/session-artifact-execution-logs.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../shared/storage/json-file-reader.js";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { backupRewrittenFiles } from "./session-rewrite-backup.js";
import { ignoreSessionProgress, walkSessionManifestDirectories } from "./session-directory-walk.js";

const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.EXECUTION_EVENT_INDEX;

const DATA_REJECTION_CODES = new Set([
  ...Object.values(EXECUTION_EVENT_INDEX_ERROR_CODE),
  ...Object.values(EXECUTION_EVENT_SEGMENT_ERROR_CODE),
  PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED,
]);

function readSessionIndexDocument(storageService, sessionDir) {
  return storageService.readOptionalJson(
    path.join(resolveExecutionEventsDir(sessionDir), EXECUTION_EVENT_INDEX_FILE),
  );
}

async function rewriteStagedIndexes({ storageService, stagingDir, sessionIndex }) {
  for (const { dialogProcessId } of sessionIndex.turns) {
    const turnDir = resolveExecutionTurnDir(stagingDir, dialogProcessId);
    const legacy = await storageService.readJson(path.join(turnDir, EXECUTION_EVENT_INDEX_FILE));
    await writeExecutionTurnIndex({
      storageService,
      turnDir,
      index: upgradeLegacyV2TurnExecutionIndex(legacy, dialogProcessId),
    });
  }
  await writeSessionExecutionIndex({ storageService, sessionDir: stagingDir, index: sessionIndex });
}

async function validateStagedIndexes({ storageService, stagingDir }) {
  for (const turn of await readRegisteredExecutionTurns({
    storageService,
    sessionDir: stagingDir,
  })) {
    for (const segment of turn.index.segments) {
      await readExecutionSegmentState({ turnDir: turn.turnDir, file: segment.file });
    }
  }
}

async function upgradeSessionDirectory({ storageService, base, backupBase, sessionDir }) {
  const document = await readSessionIndexDocument(storageService, sessionDir);
  if (document === null) return null;
  if (document.schemaVersion === EXECUTION_EVENT_INDEX_SCHEMA_VERSION) {
    requireSessionExecutionIndex(document);
    return null;
  }

  const sessionIndex = upgradeLegacyV2SessionExecutionIndex(document);
  let files = [];
  await runAtomicSessionRepair({
    sessionDir,
    repair: async (stagingDir) => {
      await rewriteStagedIndexes({ storageService, stagingDir, sessionIndex });
    },
    validate: async (stagingDir) => {
      await validateStagedIndexes({ storageService, stagingDir });
      files = await backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir });
    },
  });
  return { sessionDir: path.relative(base, sessionDir), turns: sessionIndex.turns.length, files };
}

export async function upgradeExecutionEventIndexes({
  base,
  backupBase,
  scopedSessionRoots,
  storageService,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("execution event index upgrade requires scopedSessionRoots");
  }
  requireStorageService(storageService, "execution event index upgrade");
  const sessions = [];
  const quarantined = [];
  for (const root of [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]) {
    for await (const sessionDir of walkSessionManifestDirectories(path.join(base, root))) {
      try {
        const result = await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () => upgradeSessionDirectory({ storageService, base, backupBase, sessionDir }),
        );
        if (result) sessions.push(result);
      } catch (error) {
        if (!DATA_REJECTION_CODES.has(error.code)) throw error;
        quarantined.push(
          await quarantineMigrationUnit({
            base,
            kind: QUARANTINE_KIND,
            relativePath: path.relative(base, sessionDir),
            error,
          }),
        );
      }
      onSessionProcessed();
    }
  }
  return { sessions, quarantined };
}
