/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { resolveWorkspaceSessionLocation } from "@noobot/runtime-events";
import { projectSystemRuntimeTurnProgress } from "@noobot/agent-config-protocol";
import {
  createModelContextSnapshot,
  hydrateModelContextSnapshot,
  normalizeSnapshotIdentity,
  SNAPSHOT_REQUIRED_IDENTITY_FIELDS,
} from "@noobot/context-protocol/policy/snapshot";
import {
  inspectContextMessageIdentity,
  readContextMessageField,
} from "@noobot/context-protocol/message/codec";
import { MESSAGE_BLOCK_LANES } from "@noobot/context-protocol/agent-context/schema";
import { isPlainObject, text } from "@noobot/shared/value";
import { requireActiveModelContext } from "../active-model-context.js";
import { emitEvent } from "../../events/emitter.js";
import { SESSION_ARTIFACT_FILE_NAMES } from "../../session/session-artifact-files.js";

function snapshotFileSegment(value = "") {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function resolveSnapshotLocation(identity = {}, globalConfig = {}) {
  const workspaceRoot = text(globalConfig?.workspaceRoot);
  if (!workspaceRoot) {
    throw new TypeError("model message snapshot requires globalConfig.workspaceRoot");
  }
  const location = await resolveWorkspaceSessionLocation({
    workspaceRoot,
    userId: identity.userId,
    sessionId: identity.sessionId,
  });
  if (!location.sessionDir) return location;
  const fileName = `${snapshotFileSegment(identity.dialogProcessId)}__${snapshotFileSegment(identity.turnScopeId)}.json`;
  return {
    file: path.join(
      location.sessionDir,
      SESSION_ARTIFACT_FILE_NAMES.modelMessageSnapshotsDir,
      fileName,
    ),
  };
}

function snapshotSkipReason(location = {}) {
  return location.deleted ? "session_deleted" : "session_missing";
}

function countSnapshotMessages(messageBlocks) {
  const systemCount = messageBlocks.system.length;
  const historyCount = messageBlocks.history.length;
  const incrementalCount = messageBlocks.incremental.length;
  return {
    messageCount: systemCount + historyCount + incrementalCount,
    systemCount,
    historyCount,
    incrementalCount,
  };
}

function summarizeSnapshotRoundIdentity(messageBlocks) {
  const summary = {};
  const partialMessageKeys = [];
  const missingScopedMessageKeys = [];
  let unidentifiedMessageCount = 0;
  for (const blockName of MESSAGE_BLOCK_LANES) {
    const blockSummary = { total: 0, complete: 0, missing: 0, partial: 0 };
    for (const message of messageBlocks[blockName]) {
      blockSummary.total += 1;
      const { key } = inspectContextMessageIdentity(message);
      if (!key) unidentifiedMessageCount += 1;
      const dialogProcessId = readContextMessageField(message, "dialogProcessId");
      const turnScopeId = readContextMessageField(message, "turnScopeId");
      const presentCount = Number(Boolean(dialogProcessId)) + Number(Boolean(turnScopeId));
      if (presentCount === 2) blockSummary.complete += 1;
      else if (presentCount === 1) {
        blockSummary.partial += 1;
        if (key) partialMessageKeys.push(key);
      } else {
        blockSummary.missing += 1;
        if (key && blockName !== "system") missingScopedMessageKeys.push(key);
      }
    }
    summary[blockName] = blockSummary;
  }
  return {
    blocks: summary,
    unidentifiedMessageCount,
    partialMessageKeys: partialMessageKeys.slice(-20),
    truncatedPartialMessageKeyCount: Math.max(0, partialMessageKeys.length - 20),
    missingScopedMessageKeys: missingScopedMessageKeys.slice(-20),
    truncatedMissingScopedMessageKeyCount: Math.max(0, missingScopedMessageKeys.length - 20),
  };
}

function buildSkippedWithoutCandidateResult(source) {
  return { status: "skipped", source, reason: "missing_candidate" };
}

function buildSnapshotPersistenceResult({
  status,
  source,
  identity,
  messageBlocks,
  reason = "",
  missingIdentityFields = [],
  error = "",
}) {
  return {
    status,
    source,
    ...(reason ? { reason } : {}),
    identity,
    ...(missingIdentityFields.length ? { missingIdentityFields } : {}),
    ...(error ? { error } : {}),
    ...countSnapshotMessages(messageBlocks),
    roundIdentityAudit: summarizeSnapshotRoundIdentity(messageBlocks),
  };
}

export async function saveStoppedModelMessageSnapshot({
  globalConfig = {},
  identity = {},
  messageBlocks = {},
  userMetaBackwrites = [],
  turnProgress = {},
} = {}) {
  const normalizedIdentity = normalizeSnapshotIdentity(identity);
  if (SNAPSHOT_REQUIRED_IDENTITY_FIELDS.some((field) => !normalizedIdentity[field])) {
    throw new TypeError(
      `model message snapshot requires ${SNAPSHOT_REQUIRED_IDENTITY_FIELDS.join(", ")}`,
    );
  }
  const location = await resolveSnapshotLocation(normalizedIdentity, globalConfig);
  if (!location.file) return { saved: false, reason: snapshotSkipReason(location) };
  const snapshot = createModelContextSnapshot({
    identity: normalizedIdentity,
    messageBlocks,
    userMetaBackwrites,
    turnProgress,
  });
  await fs.mkdir(path.dirname(location.file), { recursive: true });
  await fs.writeFile(location.file, JSON.stringify(snapshot, null, 2), "utf8");
  return { saved: true, snapshot };
}

export async function saveStoppedModelMessageSnapshotFromRuntime({
  runtime,
  eventListener,
  source,
}) {
  const candidate = runtime === null ? null : runtime.stoppedModelMessageSnapshotCandidate;
  if (!isPlainObject(candidate)) {
    const result = buildSkippedWithoutCandidateResult(source);
    emitEvent(eventListener, "stopped_model_message_snapshot_save_skipped", result);
    return result;
  }
  const { messageBlocks, userMetaBackwrites } = requireActiveModelContext(runtime);
  const identity = normalizeSnapshotIdentity(candidate);
  const resultBase = { source, identity, messageBlocks };
  const missingIdentityFields = SNAPSHOT_REQUIRED_IDENTITY_FIELDS.filter((key) => !identity[key]);
  if (missingIdentityFields.length) {
    const result = buildSnapshotPersistenceResult({
      ...resultBase,
      status: "skipped",
      reason: "missing_identity",
      missingIdentityFields,
    });
    emitEvent(eventListener, "stopped_model_message_snapshot_save_skipped", result);
    return result;
  }
  try {
    const saveResult = await saveStoppedModelMessageSnapshot({
      globalConfig: runtime.globalConfig,
      identity,
      messageBlocks,
      userMetaBackwrites,
      turnProgress: projectSystemRuntimeTurnProgress(candidate.systemRuntime),
    });
    const result = saveResult.saved
      ? buildSnapshotPersistenceResult({ ...resultBase, status: "saved" })
      : buildSnapshotPersistenceResult({
          ...resultBase,
          status: "skipped",
          reason: saveResult.reason,
        });
    emitEvent(
      eventListener,
      saveResult.saved
        ? "stopped_model_message_snapshot_saved"
        : "stopped_model_message_snapshot_save_skipped",
      result,
    );
    return result;
  } catch (error) {
    const result = buildSnapshotPersistenceResult({
      ...resultBase,
      status: "failed",
      error: String(error?.message || error),
    });
    emitEvent(eventListener, "stopped_model_message_snapshot_save_failed", result);
    return result;
  }
}

export async function loadStoppedModelMessageSnapshot({
  globalConfig = {},
  identity = {},
  allowMissing = false,
} = {}) {
  const normalizedIdentity = normalizeSnapshotIdentity(identity);
  const location = await resolveSnapshotLocation(normalizedIdentity, globalConfig);
  if (!location.file) {
    if (allowMissing === true) return null;
    throw new Error(`stopped model message snapshot unavailable: ${snapshotSkipReason(location)}`);
  }
  let raw;
  try {
    raw = await fs.readFile(location.file, "utf8");
  } catch (error) {
    if (allowMissing === true && error?.code === "ENOENT") return null;
    throw error;
  }
  return hydrateModelContextSnapshot(JSON.parse(raw), normalizedIdentity);
}
