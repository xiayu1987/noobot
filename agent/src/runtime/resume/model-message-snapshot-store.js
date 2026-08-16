/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isWorkspaceSessionDeleted } from "@noobot/runtime-events";
import {
  createModelContextSnapshot,
  hydrateModelContextSnapshot,
  normalizeSnapshotIdentity,
} from "@noobot/context-protocol/policy/snapshot";

function cleanId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function snapshotDir({
  globalConfig = {},
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
  const root = String(globalConfig?.workspaceRoot || process.cwd()).trim();
  const storageSessionId = cleanId(parentSessionId) || cleanId(sessionId);
  return path.resolve(
    root,
    cleanId(userId),
    "runtime",
    "session",
    storageSessionId,
    "model-message-snapshots",
  );
}

function snapshotPath(identity = {}, globalConfig = {}) {
  const childPrefix =
    cleanId(identity.parentSessionId) &&
    cleanId(identity.parentSessionId) !== cleanId(identity.sessionId)
      ? `${cleanId(identity.sessionId)}__`
      : "";
  return path.join(
    snapshotDir({ globalConfig, ...identity }),
    `${childPrefix}${cleanId(identity.dialogProcessId)}__${cleanId(identity.turnScopeId)}.json`,
  );
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

function readMessageField(message = {}, field = "") {
  return String(
    message?.[field] ||
      message?.additional_kwargs?.[field] ||
      message?.lc_kwargs?.additional_kwargs?.[field] ||
      "",
  ).trim();
}

function snapshotMessageId(message = {}) {
  return (
    readMessageField(message, "noobotMessageId") ||
    String(message?.messageUid || message?.messageId || message?.id || "").trim()
  );
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
      const dialogProcessId = readMessageField(message, "dialogProcessId");
      const turnScopeId = readMessageField(message, "turnScopeId");
      const presentCount = Number(Boolean(dialogProcessId)) + Number(Boolean(turnScopeId));
      if (presentCount === 2) blockSummary.complete += 1;
      else if (presentCount === 1) {
        blockSummary.partial += 1;
        partialMessageIds.push(snapshotMessageId(message));
      } else {
        blockSummary.missing += 1;
        if (blockName !== "system") missingScopedMessageIds.push(snapshotMessageId(message));
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
  messages = [],
  messageBlocks = {},
} = {}) {
  const normalizedIdentity = normalizeSnapshotIdentity(identity);
  if (
    !normalizedIdentity.userId ||
    !normalizedIdentity.sessionId ||
    !normalizedIdentity.dialogProcessId ||
    !normalizedIdentity.turnScopeId
  )
    return null;
  const workspaceRoot = String(globalConfig?.workspaceRoot || process.cwd()).trim();
  const guardedSessionIds = [
    ...new Set([normalizedIdentity.sessionId, normalizedIdentity.parentSessionId].filter(Boolean)),
  ];
  for (const sessionId of guardedSessionIds) {
    if (
      await isWorkspaceSessionDeleted({
        workspaceRoot,
        userId: normalizedIdentity.userId,
        sessionId,
      })
    )
      return null;
  }
  const snapshot = createModelContextSnapshot({ identity: normalizedIdentity, messageBlocks });
  const filePath = snapshotPath(normalizedIdentity, globalConfig);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

export async function saveStoppedModelMessageSnapshotCandidate({
  globalConfig = {},
  candidate = null,
  eventListener = null,
  source = "",
} = {}) {
  if (!candidate || typeof candidate !== "object") {
    const result = buildSnapshotPersistenceResult({
      status: "skipped",
      source,
      reason: "missing_candidate",
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_skipped",
      data: result,
    });
    return result;
  }
  const identity = {
    userId: String(candidate.userId || "").trim(),
    sessionId: String(candidate.sessionId || "").trim(),
    parentSessionId: String(candidate.parentSessionId || "").trim(),
    dialogProcessId: String(candidate.dialogProcessId || "").trim(),
    turnScopeId: String(candidate.turnScopeId || "").trim(),
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
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_skipped",
      data: result,
    });
    return result;
  }
  try {
    const snapshot = await saveStoppedModelMessageSnapshot({
      globalConfig,
      identity,
      messages: candidate.messages,
      messageBlocks: candidate.messageBlocks,
    });
    if (!snapshot) {
      const result = buildSnapshotPersistenceResult({
        status: "skipped",
        source,
        reason: "session_deleted",
        identity,
        candidate,
      });
      eventListener?.onEvent?.({
        event: "stopped_model_message_snapshot_save_skipped",
        data: result,
      });
      return result;
    }
    const result = buildSnapshotPersistenceResult({
      status: "saved",
      source,
      identity,
      candidate,
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_saved",
      data: result,
    });
    return result;
  } catch (error) {
    const result = buildSnapshotPersistenceResult({
      status: "failed",
      source,
      identity,
      error: String(error?.message || error || ""),
      candidate,
    });
    eventListener?.onEvent?.({
      event: "stopped_model_message_snapshot_save_failed",
      data: result,
    });
    return result;
  }
}

export async function loadStoppedModelMessageSnapshot({
  globalConfig = {},
  identity = {},
  allowMissing = false,
} = {}) {
  const normalizedIdentity = normalizeSnapshotIdentity(identity);
  let raw;
  try {
    raw = await fs.readFile(snapshotPath(normalizedIdentity, globalConfig), "utf8");
  } catch (error) {
    if (allowMissing === true && error?.code === "ENOENT") return null;
    throw error;
  }
  return hydrateModelContextSnapshot(JSON.parse(raw), normalizedIdentity);
}

export async function clearStoppedModelMessageSnapshot({ globalConfig = {}, identity = {} } = {}) {
  await fs.rm(snapshotPath(identity, globalConfig), { force: true });
}
