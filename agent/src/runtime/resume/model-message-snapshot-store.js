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
} from "@noobot/context-protocol/policy/snapshot";
import {
  readContextMessageField,
  resolveContextMessageId,
} from "@noobot/context-protocol/message/codec";
import { isPlainObject, text } from "@noobot/shared/value";
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

function countSnapshotMessages(candidate = {}) {
  const systemCount = Array.isArray(candidate.messageBlocks?.system)
    ? candidate.messageBlocks.system.length
    : 0;
  const historyCount = Array.isArray(candidate.messageBlocks?.history)
    ? candidate.messageBlocks.history.length
    : 0;
  const incrementalCount = Array.isArray(candidate.messageBlocks?.incremental)
    ? candidate.messageBlocks.incremental.length
    : 0;
  return {
    messageCount: systemCount + historyCount + incrementalCount,
    systemCount,
    historyCount,
    incrementalCount,
  };
}

function summarizeSnapshotRoundIdentity(candidate = {}) {
  const blocks =
    candidate?.messageBlocks && typeof candidate.messageBlocks === "object"
      ? candidate.messageBlocks
      : {};
  const summary = {};
  const partialMessageIds = [];
  const missingScopedMessageIds = [];
  for (const blockName of ["system", "history", "incremental"]) {
    const blockSummary = { total: 0, complete: 0, missing: 0, partial: 0 };
    for (const message of Array.isArray(blocks?.[blockName]) ? blocks[blockName] : []) {
      blockSummary.total += 1;
      const dialogProcessId = readContextMessageField(message, "dialogProcessId");
      const turnScopeId = readContextMessageField(message, "turnScopeId");
      const presentCount = Number(Boolean(dialogProcessId)) + Number(Boolean(turnScopeId));
      if (presentCount === 2) blockSummary.complete += 1;
      else if (presentCount === 1) {
        blockSummary.partial += 1;
        partialMessageIds.push(resolveContextMessageId(message));
      } else {
        blockSummary.missing += 1;
        if (blockName !== "system") missingScopedMessageIds.push(resolveContextMessageId(message));
      }
    }
    summary[blockName] = blockSummary;
  }
  return {
    blocks: summary,
    partialMessageIds: partialMessageIds.filter(Boolean).slice(-20),
    truncatedPartialMessageIdCount: Math.max(0, partialMessageIds.filter(Boolean).length - 20),
    missingScopedMessageIds: missingScopedMessageIds.filter(Boolean).slice(-20),
    truncatedMissingScopedMessageIdCount: Math.max(
      0,
      missingScopedMessageIds.filter(Boolean).length - 20,
    ),
  };
}

function buildSnapshotPersistenceResult({
  status,
  source = "",
  reason = "",
  identity = {},
  missingIdentityFields = [],
  error = "",
  candidate = null,
} = {}) {
  return {
    status,
    source: String(source || ""),
    ...(reason ? { reason } : {}),
    ...(identity && typeof identity === "object" ? { identity } : {}),
    ...(Array.isArray(missingIdentityFields) && missingIdentityFields.length
      ? { missingIdentityFields }
      : {}),
    ...(error ? { error: String(error || "") } : {}),
    ...countSnapshotMessages(candidate || {}),
    roundIdentityAudit: summarizeSnapshotRoundIdentity(candidate || {}),
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
  if (
    !normalizedIdentity.userId ||
    !normalizedIdentity.sessionId ||
    !normalizedIdentity.dialogProcessId ||
    !normalizedIdentity.turnScopeId
  ) {
    throw new TypeError(
      "model message snapshot requires userId, sessionId, dialogProcessId and turnScopeId",
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

export async function saveStoppedModelMessageSnapshotCandidate({
  globalConfig = {},
  candidate = null,
  eventListener = null,
  source = "",
} = {}) {
  if (!isPlainObject(candidate)) {
    const result = buildSnapshotPersistenceResult({
      status: "skipped",
      source,
      reason: "missing_candidate",
    });
    emitEvent(eventListener, "stopped_model_message_snapshot_save_skipped", result);
    return result;
  }
  const identity = {
    userId: text(candidate.userId),
    sessionId: text(candidate.sessionId),
    parentSessionId: text(candidate.parentSessionId),
    dialogProcessId: text(candidate.dialogProcessId),
    turnScopeId: text(candidate.turnScopeId),
  };
  const missingIdentityFields = ["userId", "sessionId", "dialogProcessId", "turnScopeId"].filter(
    (key) => !identity[key],
  );
  if (missingIdentityFields.length) {
    const result = buildSnapshotPersistenceResult({
      status: "skipped",
      source,
      reason: "missing_identity",
      missingIdentityFields,
      identity,
      candidate,
    });
    emitEvent(eventListener, "stopped_model_message_snapshot_save_skipped", result);
    return result;
  }
  try {
    const saveResult = await saveStoppedModelMessageSnapshot({
      globalConfig,
      identity,
      messageBlocks: candidate.messageBlocks,
      userMetaBackwrites: candidate.userMetaBackwrites,
      turnProgress: projectSystemRuntimeTurnProgress(candidate.systemRuntime),
    });
    if (!saveResult.saved) {
      const result = buildSnapshotPersistenceResult({
        status: "skipped",
        source,
        reason: saveResult.reason,
        identity,
        candidate,
      });
      emitEvent(eventListener, "stopped_model_message_snapshot_save_skipped", result);
      return result;
    }
    const result = buildSnapshotPersistenceResult({
      status: "saved",
      source,
      identity,
      candidate,
    });
    emitEvent(eventListener, "stopped_model_message_snapshot_saved", result);
    return result;
  } catch (error) {
    const result = buildSnapshotPersistenceResult({
      status: "failed",
      source,
      identity,
      error: String(error?.message || error || ""),
      candidate,
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
