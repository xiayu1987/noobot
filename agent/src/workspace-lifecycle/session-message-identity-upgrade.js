/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import {
  resolveSessionTreeChain,
  isSessionTreeNodeRegistered,
} from "@noobot/workspace-protocol/session-tree";
import { parseWorkspaceSessionTree } from "@noobot/workspace-protocol/session-store";
import {
  MESSAGE_IDENTITY_STORE,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
  SESSION_MESSAGE_RECORD_MIGRATION_INVALID,
  assertSessionScopeIdentity,
  isCanonicalParentSessionId,
  isCanonicalSessionId,
  migrateSessionDocumentIdentity,
} from "@noobot/session-protocol";
import { isLegacyEventEnvelope, validateEventEnvelope } from "@noobot/event-protocol/envelope";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  migrateLegacyAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import {
  SESSION_REPAIR_DATA_REJECTION_CODES,
  reconcileCompletedTurnOrphanToolCalls,
  reconcileCompletedTurnSummaryMarks,
  resegmentMigratedCheckpointBaselines,
  runAtomicSessionRepair,
} from "@noobot/session-repair";
import { isPlainObject } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session/session-artifact-files.js";
import { requireStorageService } from "../session/storage-service.js";
import {
  normalizeSessionEntity,
  normalizeSessionTreeEntity,
} from "../session/entities/session-entity.js";
import { normalizeSessionDocumentForCurrentProtocol } from "../session/session-document-normalization.js";
import {
  SESSION_ARTIFACT_PREDECESSOR,
  readSessionArtifact,
  readSessionArtifactForRepair,
  writeSessionArtifact,
} from "../session/session-artifact-store.js";
import {
  authorityOutboxRecordsFromOutbox,
  readAuthorityOutboxRecords,
  replaceAuthorityOutboxRecords,
} from "../session/authority-outbox-store/outbox-journal.js";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { backupRewrittenFiles } from "./session-rewrite-backup.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../shared/storage/json-file-reader.js";
import { ignoreSessionProgress, walkSessionManifestDirectories } from "./session-directory-walk.js";

const UPGRADE_INVALID_CODE = "WORKSPACE_SESSION_MESSAGE_IDENTITY_UPGRADE_INVALID";
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY;
const MIGRATION_NOW = () => new Date().toISOString();

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session message identity upgrade failed: ${reason}`);
  error.code = UPGRADE_INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

const DATA_REJECTION_CODES = new Set([
  ...SESSION_REPAIR_DATA_REJECTION_CODES,
  PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED,
  SESSION_MESSAGE_RECORD_MIGRATION_INVALID,
  SESSION_ERROR_CODE.COMMAND_RECEIPT_INVALID,
  SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT,
]);

function isProtocolRejection(error) {
  return DATA_REJECTION_CODES.has(error?.code);
}

function asUpgradeError(error, details) {
  if (error?.code === UPGRADE_INVALID_CODE || !isProtocolRejection(error)) return error;
  return upgradeError(error.code, details, error);
}

async function readSessionTree(base) {
  const file = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const raw = await readFile(file, "utf8");
  return normalizeSessionTreeEntity(parseWorkspaceSessionTree({ raw, file }));
}

function treeScopeOf({ tree, sessionRoot, sessionDir, sessionId }) {
  if (!isCanonicalSessionId(sessionId)) throw upgradeError("session_id_missing", {});
  if (!isSessionTreeNodeRegistered(tree, sessionId)) {
    throw upgradeError("session_tree_node_missing", { sessionId });
  }
  const chain = resolveSessionTreeChain(tree, sessionId);
  if (path.join(sessionRoot, ...chain) !== sessionDir) {
    throw upgradeError("session_tree_location_mismatch", { sessionId });
  }
  return { sessionId, parentSessionId: chain.length > 1 ? chain.at(-2) : "" };
}

function migrateOutboxRecord(record, index) {
  const values = Object.values(AUTHORITY_OUTBOX_JOURNAL_OP);
  if (!isPlainObject(record) || !values.includes(record.op)) {
    throw upgradeError("outbox_record_invalid", { index });
  }
  if (record.op !== AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) return { record, changed: false };
  const migrated = migrateSessionDocumentIdentity(record, MESSAGE_IDENTITY_STORE.OUTBOX);
  const validation = validateEventEnvelope(migrated.document.envelope);
  if (!validation.valid) {
    throw upgradeError("outbox_envelope_invalid", { index, errors: validation.errors });
  }
  if (migrated.document.envelope.identity.eventId !== record.eventId) {
    throw upgradeError("outbox_event_id_mismatch", { index });
  }
  return { record: migrated.document, changed: migrated.changed };
}

function legacyOutboxEventIds(records) {
  return new Set(
    records
      .filter(
        (record) =>
          isPlainObject(record) &&
          record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT &&
          isLegacyEventEnvelope(record.envelope),
      )
      .map((record) => record.eventId),
  );
}

async function migrateOutboxJournal(stagingDir, legacyOutbox) {
  let records = await readAuthorityOutboxRecords(stagingDir);
  let changed = false;
  if (legacyOutbox.length) {
    if (records.length) throw upgradeError("legacy_outbox_conflicts_with_journal", {});
    records = authorityOutboxRecordsFromOutbox(migrateLegacyAuthorityEventOutbox(legacyOutbox));
    changed = true;
  }
  const droppedEventIds = legacyOutboxEventIds(records);
  const kept = records.filter(
    (record) => !isPlainObject(record) || !droppedEventIds.has(record.eventId),
  );
  changed ||= kept.length !== records.length;
  const migrated = kept.map(migrateOutboxRecord);
  changed ||= migrated.some((item) => item.changed);
  if (changed) {
    await replaceAuthorityOutboxRecords(
      stagingDir,
      migrated.map((item) => item.record),
    );
  }
  return { records: migrated.length, changed, droppedEventIds: [...droppedEventIds] };
}

async function repairStagedSession({ storageService, stagingDir, expectScope }) {
  const source = await readSessionArtifactForRepair({ storageService, sessionDir: stagingDir });
  if (!source) throw upgradeError("session_artifact_missing", {});
  const scope = await expectScope(source);
  const migration = normalizeSessionDocumentForCurrentProtocol(source, { now: MIGRATION_NOW });
  await writeSessionArtifact({
    storageService,
    sessionDir: stagingDir,
    sessionPayload: migration.document,
    atomic: true,
    now: MIGRATION_NOW,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.LEGACY_REWRITE,
  });
  const outbox = await migrateOutboxJournal(stagingDir, migration.legacyAuthorityEventOutbox);
  await resegmentMigratedCheckpointBaselines({ sessionDir: stagingDir });
  return {
    scope,
    fromSchemaVersion: source.schemaVersion,
    migrations: migration.migrations,
    droppedCommandReceiptIds: migration.droppedCommandReceiptIds,
    outbox,
  };
}

async function validateStagedSession({ storageService, stagingDir, scope }) {
  const session = await readSessionArtifact({ storageService, sessionDir: stagingDir });
  if (!session) throw upgradeError("session_artifact_missing", {});
  const normalized = normalizeSessionEntity(session, { now: MIGRATION_NOW });
  assertSessionScopeIdentity({ session: normalized, ...scope });
  if (normalized.schemaVersion !== SESSION_ARTIFACT_SCHEMA_VERSION) {
    throw upgradeError("schema_version_not_current", { schemaVersion: normalized.schemaVersion });
  }
  if (reconcileCompletedTurnOrphanToolCalls(normalized).changed) {
    throw upgradeError("orphan_tool_calls_not_canonical", {});
  }
  if (reconcileCompletedTurnSummaryMarks(normalized).changed) {
    throw upgradeError("summary_marks_not_canonical", {});
  }
  const records = await readAuthorityOutboxRecords(stagingDir);
  if (records.map(migrateOutboxRecord).some((item) => item.changed)) {
    throw upgradeError("outbox_not_canonical", {});
  }
}

async function upgradeSessionDirectory({
  storageService,
  base,
  backupBase,
  sessionDir,
  expectScope,
}) {
  let report = null;
  await runAtomicSessionRepair({
    sessionDir,
    repair: async (stagingDir) => {
      report = await repairStagedSession({ storageService, stagingDir, expectScope });
    },
    validate: async (stagingDir) => {
      await validateStagedSession({ storageService, stagingDir, scope: report.scope });
      report.files = await backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir });
    },
  });
  if (!report.files.length) return null;
  const { scope, ...rest } = report;
  return { sessionDir: path.relative(base, sessionDir), sessionId: scope.sessionId, ...rest };
}

function defaultScopeResolver({ base, sessionRoot }) {
  let tree = null;
  return (sessionDir) => async (source) => {
    tree ||= await readSessionTree(base);
    return treeScopeOf({ tree, sessionRoot, sessionDir, sessionId: source.sessionId });
  };
}

function scopedScopeResolver() {
  return () => async (source) => {
    if (!isCanonicalSessionId(source.sessionId)) throw upgradeError("session_id_missing", {});
    if (!isCanonicalParentSessionId(source.parentSessionId)) {
      throw upgradeError("parent_session_id_not_canonical", { sessionId: source.sessionId });
    }
    return { sessionId: source.sessionId, parentSessionId: source.parentSessionId };
  };
}

export async function upgradeSessionMessageIdentity({
  base,
  backupBase,
  scopedSessionRoots,
  storageService,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session message identity upgrade requires scopedSessionRoots");
  }
  requireStorageService(storageService, "session message identity upgrade");
  const sessions = [];
  const quarantined = [];
  const roots = [
    { root: WORKSPACE_LAYOUT.SESSION_DIR, resolver: defaultScopeResolver },
    ...scopedSessionRoots.map((root) => ({ root, resolver: scopedScopeResolver })),
  ];
  for (const { root, resolver } of roots) {
    const sessionRoot = path.join(base, root);
    const scopeFor = resolver({ base, sessionRoot });
    for await (const sessionDir of walkSessionManifestDirectories(sessionRoot)) {
      const relativePath = path.relative(base, sessionDir);
      try {
        const result = await sessionMutationCoordinator.run(
          resolveSessionArtifactMutationLock(sessionDir),
          () =>
            upgradeSessionDirectory({
              storageService,
              base,
              backupBase,
              sessionDir,
              expectScope: scopeFor(sessionDir),
            }),
        );
        if (result) sessions.push(result);
      } catch (error) {
        const failure = asUpgradeError(error, { sessionDir: relativePath });
        if (failure.code !== UPGRADE_INVALID_CODE) throw failure;
        quarantined.push(
          await quarantineMigrationUnit({
            base,
            kind: QUARANTINE_KIND,
            relativePath,
            error: failure,
          }),
        );
      }
      onSessionProcessed();
    }
  }
  return { sessions, quarantined };
}
