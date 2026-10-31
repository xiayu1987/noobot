/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { runAtomicSessionRepair } from "@noobot/session-repair";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_READ_REJECTION_CODES,
  assertSessionManifestLayout,
} from "@noobot/session-protocol";
import {
  assertStoredCheckpointReceipts,
  checkpointIdentityError,
} from "@noobot/session-protocol/summary-checkpoint-storage";
import {
  buildStoredCheckpointReceipts,
  readCheckpointReceiptProjection,
} from "../session/session-artifact-session/checkpoint-receipts.js";
import { readVerifiedSnapshot } from "../session/session-artifact-session/turn-materializer.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { backupRewrittenFiles } from "./session-rewrite-backup.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../shared/storage/json-file-reader.js";

const UPGRADE_CODE = "WORKSPACE_SESSION_CHECKPOINT_IDENTITY_UPGRADE_INVALID";

async function planUpgrade({ storageService, sessionDir }) {
  const file = path.join(sessionDir, "session.json");
  const raw = await readFile(file, "utf8");
  let session;
  try {
    session = JSON.parse(raw);
  } catch (cause) {
    throw Object.assign(checkpointIdentityError("manifest is not JSON"), { cause });
  }
  if (session.schemaVersion === SESSION_ARTIFACT_SCHEMA_VERSION) {
    assertSessionManifestLayout(session);
    assertStoredCheckpointReceipts(session);
    await readCheckpointReceiptProjection({ storageService, sessionDir, session });
    return null;
  }
  if (session.schemaVersion !== 18) throw checkpointIdentityError("migration requires schema 18");
  for (const turn of session.turnOrder) {
    let previousCheckpointHash = "";
    for (const index of turn.summarySnapshots) {
      const { payload } = await readVerifiedSnapshot({
        storageService,
        sessionDir,
        index,
        previousCheckpointHash,
      });
      if (JSON.stringify(index.messageUids) !== JSON.stringify(payload.summarizedMessageUids))
        throw checkpointIdentityError(`legacy index UID mismatch: ${index.file}`);
      previousCheckpointHash = index.contentHash;
    }
  }
  const stored = await buildStoredCheckpointReceipts({ storageService, sessionDir, session });
  const turnOrder = stored.turnOrder.map((turn) => ({
    ...turn,
    summarySnapshots: turn.summarySnapshots.map(({ messageUids: _messageUids, ...index }) => index),
  }));
  return assertSessionManifestLayout({
    ...stored,
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    turnOrder,
  });
}

export async function migrateSessionCheckpointIdentity({
  storageService,
  sessionDir,
  base,
  backupBase,
}) {
  if (!(await planUpgrade({ storageService, sessionDir }))) return null;
  let files;
  await runAtomicSessionRepair({
    sessionDir,
    repair: async (stagingDir) => {
      const next = await planUpgrade({ storageService, sessionDir: stagingDir });
      await writeFile(
        path.join(stagingDir, "session.json"),
        `${JSON.stringify(next, null, 2)}\n`,
        "utf8",
      );
    },
    validate: async (stagingDir) => {
      if (await planUpgrade({ storageService, sessionDir: stagingDir }))
        throw checkpointIdentityError("migration did not converge");
      files = await backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir });
    },
  });
  return { sessionDir: path.relative(base, sessionDir), files };
}

export async function upgradeSessionCheckpointIdentity({
  base,
  backupBase,
  scopedSessionRoots,
  storageService,
  onSessionProcessed = ignoreSessionProgress,
}) {
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_CHECKPOINT_IDENTITY,
    upgrade: ({ sessionDir }) =>
      migrateSessionCheckpointIdentity({ storageService, sessionDir, base, backupBase }),
    quarantineCode: UPGRADE_CODE,
    normalizeError: (error) => {
      if (
        [
          ...SESSION_ARTIFACT_READ_REJECTION_CODES,
          PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED,
        ].includes(error.code)
      )
        return Object.assign(
          new Error("checkpoint identity migration rejected", { cause: error }),
          { code: UPGRADE_CODE },
        );
      return error;
    },
    onSessionProcessed,
  });
}
