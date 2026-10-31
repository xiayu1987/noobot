/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path, isAbsolutePathAnyPlatform, PATH_REF_VIEWS } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import {
  FILE_MUTATION_PROTOCOL,
  FILE_MUTATION_VERSION,
  assertFileMutationResult,
  createFileMutationLocator,
  projectMutationRefs,
} from "@noobot/file-mutation-protocol";
import {
  SESSION_REPAIR_DATA_REJECTION_CODES,
  runAtomicSessionRepair,
} from "@noobot/session-repair";
import { isPlainObject } from "@noobot/shared/value";
import { SESSION_ARTIFACT_READ_REJECTION_CODES } from "@noobot/session-protocol";
import { TOOL_NAME } from "../tools/constants/index.js";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../shared/storage/json-file-reader.js";
import { resolveSessionGeneratedDataRoot } from "../session/session-generated-data.js";
import { requireStorageService } from "../session/storage-service.js";
import {
  SESSION_ARTIFACT_PREDECESSOR,
  readSessionArtifact,
  writeSessionArtifact,
} from "../session/session-artifact-store.js";
import { backupRewrittenFiles } from "./session-rewrite-backup.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";

const UPGRADE_INVALID_CODE = "WORKSPACE_SESSION_MUTATION_REFS_UPGRADE_INVALID";
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MUTATION_REFS;
const MIGRATION_NOW = () => new Date().toISOString();

const LEGACY_FILE_MUTATION_VERSION = 2;
const FILE_MUTATION_TOOLS = new Set([TOOL_NAME.WRITE_FILE, TOOL_NAME.PATCH_FILE]);
const DATA_REJECTION_CODES = new Set([
  ...SESSION_REPAIR_DATA_REJECTION_CODES,
  ...SESSION_ARTIFACT_READ_REJECTION_CODES,
  PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED,
]);

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session mutation refs upgrade failed: ${reason}`);
  error.code = UPGRADE_INVALID_CODE;
  error.details = { reason, ...details };
  if (cause) error.cause = cause;
  return error;
}

function asUpgradeError(error, details) {
  if (error?.code === UPGRADE_INVALID_CODE || !DATA_REJECTION_CODES.has(error?.code)) return error;
  return upgradeError(error.code, details, error);
}

function legacyLocator(logicalPath) {
  return createFileMutationLocator({
    view: isAbsolutePathAnyPlatform(logicalPath) ? PATH_REF_VIEWS.HOST : PATH_REF_VIEWS.WORKSPACE,
    path: logicalPath,
  });
}

function migrateLegacyMutation(mutation, details) {
  if (!isPlainObject(mutation) || typeof mutation.path !== "string" || !mutation.path) {
    throw upgradeError("legacy_mutation_path_missing", details);
  }
  const { path: logicalPath, aggregate = null, ...rest } = mutation;
  if (aggregate !== null && (!isPlainObject(aggregate) || aggregate.path !== logicalPath)) {
    throw upgradeError("legacy_aggregate_path_mismatch", { ...details, mutationId: mutation.id });
  }
  const { path: _aggregatePath, ...aggregateRest } = aggregate || {};
  return {
    ...rest,
    locator: legacyLocator(logicalPath),
    aggregate: aggregate === null ? null : aggregateRest,
  };
}

function assertCurrentEnvelope(value, details) {
  try {
    return assertFileMutationResult(value);
  } catch (cause) {
    throw upgradeError("file_mutation_rejected", details, cause);
  }
}

function migrateEnvelope(value, details) {
  if (value?.version === FILE_MUTATION_VERSION) {
    return { value: assertCurrentEnvelope(value, details), changed: false };
  }
  if (value?.version !== LEGACY_FILE_MUTATION_VERSION || !Array.isArray(value.mutations)) {
    throw upgradeError("file_mutation_version_unsupported", {
      ...details,
      version: value?.version,
    });
  }
  const next = {
    ...value,
    version: FILE_MUTATION_VERSION,
    mutations: value.mutations.map((mutation) => migrateLegacyMutation(mutation, details)),
  };
  return { value: assertCurrentEnvelope(next, details), changed: true };
}

async function listRecordFiles(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readMutationRecords(sessionDir) {
  const root = resolveSessionGeneratedDataRoot(sessionDir, "fileMutations");
  const records = new Map();
  for (const name of await listRecordFiles(root)) {
    const filePath = path.join(root, name);
    const details = { file: name };
    let raw;
    try {
      raw = JSON.parse(await readFile(filePath, "utf8"));
    } catch (cause) {
      throw upgradeError("file_mutation_record_not_json", details, cause);
    }
    const { value, changed } = migrateEnvelope(raw, details);
    const id = value.mutations[0].id;
    if (value.mutations.length !== 1 || `${id}.json` !== name) {
      throw upgradeError("file_mutation_record_identity_mismatch", details);
    }
    records.set(id, { filePath, record: value, changed });
  }
  return records;
}

function assertRecordedMutation(mutation, records, details) {
  const stored = records.get(mutation.id);
  if (!stored)
    throw upgradeError("file_mutation_record_missing", { ...details, mutationId: mutation.id });
  const { locator } = stored.record.mutations[0];
  if (locator.view !== mutation.locator.view || locator.path !== mutation.locator.path) {
    throw upgradeError("file_mutation_record_locator_mismatch", {
      ...details,
      mutationId: mutation.id,
    });
  }
}

function parseToolResult(message, details) {
  if (typeof message.content !== "string") throw upgradeError("tool_result_not_text", details);
  let result;
  try {
    result = JSON.parse(message.content);
  } catch (cause) {
    throw upgradeError("tool_result_not_json", details, cause);
  }
  if (!isPlainObject(result)) throw upgradeError("tool_result_not_object", details);
  return result;
}

function rebuildMutationRefs(message, records) {
  if (message.role !== "tool" || !FILE_MUTATION_TOOLS.has(message.toolName)) return [];
  if (message.mutationRefs !== undefined) return [];
  const details = { messageUid: message.messageUid, toolName: message.toolName };
  const result = parseToolResult(message, details);
  if (result.ok !== true || result.dryRun === true) return [];
  if (result.protocol !== FILE_MUTATION_PROTOCOL) {
    throw upgradeError("tool_result_protocol_missing", details);
  }
  if (!Array.isArray(result.mutations))
    throw upgradeError("tool_result_mutations_missing", details);
  if (!result.mutations.length) return [];
  const { value } = migrateEnvelope(
    { protocol: result.protocol, version: result.version, ok: true, mutations: result.mutations },
    details,
  );
  for (const mutation of value.mutations) assertRecordedMutation(mutation, records, details);
  return projectMutationRefs(value);
}

async function planSession({ storageService, sessionDir }) {
  const records = await readMutationRecords(sessionDir);
  const session = await readSessionArtifact({ storageService, sessionDir });
  if (!session) throw upgradeError("session_artifact_missing", {});
  let rebuiltMessages = 0;
  const messages = session.messages.map((message) => {
    const mutationRefs = rebuildMutationRefs(message, records);
    if (!mutationRefs.length) return message;
    rebuiltMessages += 1;
    return { ...message, mutationRefs };
  });
  const migratedRecords = [...records.values()].filter((item) => item.changed);
  return { session: { ...session, messages }, rebuiltMessages, migratedRecords };
}

function isPlanEmpty(plan) {
  return !plan.rebuiltMessages && !plan.migratedRecords.length;
}

async function applyPlan({ storageService, stagingDir, plan }) {
  for (const { filePath, record } of plan.migratedRecords) {
    await writeFileAtomic({
      filePath,
      content: JSON.stringify(record),
      writeFile,
      rename,
      remove: rm,
    });
  }
  if (!plan.rebuiltMessages) return;
  await writeSessionArtifact({
    storageService,
    sessionDir: stagingDir,
    sessionPayload: plan.session,
    atomic: true,
    now: MIGRATION_NOW,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
  });
}

async function upgradeSessionDirectory({ storageService, base, backupBase, sessionDir }) {
  if (isPlanEmpty(await planSession({ storageService, sessionDir }))) return null;
  let report = null;
  await runAtomicSessionRepair({
    sessionDir,
    repair: async (stagingDir) => {
      const plan = await planSession({ storageService, sessionDir: stagingDir });
      await applyPlan({ storageService, stagingDir, plan });
      report = {
        rebuiltMessages: plan.rebuiltMessages,
        migratedRecords: plan.migratedRecords.length,
      };
    },
    validate: async (stagingDir) => {
      if (!isPlanEmpty(await planSession({ storageService, sessionDir: stagingDir }))) {
        throw upgradeError("upgrade_not_canonical", {});
      }
      report.files = await backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir });
    },
  });
  return { sessionDir: path.relative(base, sessionDir), ...report };
}

export async function upgradeSessionMutationRefs({
  base,
  backupBase,
  scopedSessionRoots,
  storageService,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("session mutation refs upgrade requires scopedSessionRoots");
  }
  requireStorageService(storageService, "session mutation refs upgrade");
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: QUARANTINE_KIND,
    upgrade: ({ sessionDir }) =>
      upgradeSessionDirectory({ storageService, base, backupBase, sessionDir }),
    quarantineCode: UPGRADE_INVALID_CODE,
    normalizeError: (error, relativePath) => asUpgradeError(error, { sessionDir: relativePath }),
    onSessionProcessed,
  });
}
