/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { cp, rename, rm } from "node:fs/promises";
import { attachmentTransfer, assertTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import { projectTurnCompletionMessages } from "@noobot/context-protocol";

export const SESSION_REPAIR_PROTOCOL_VERSION = 1;

function text(value) {
  return String(value || "").trim();
}

function stableId(prefix, parts) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;
}

function migrateTransferEnvelopeV1(envelope, message, envelopeIdentity) {
  if (envelope?.protocol !== "noobot.semantic-transfer" || Number(envelope?.version) !== 1) {
    return assertTransferEnvelope(envelope);
  }
  if (envelope.transport !== "file" || !Array.isArray(envelope.files) || !envelope.files.length) {
    throw Object.assign(new Error("Semantic Transfer V1 envelope cannot be migrated losslessly"), {
      code: "SESSION_TRANSFER_V1_UNMIGRATABLE",
    });
  }
  const messageId = text(message.messageId || message.id || message.messageUid);
  const sessionId = text(message.sessionId || envelope.files[0]?.sessionId);
  const turnScopeId = text(message.turnScopeId);
  const producerId = text(message.messageUid || messageId);
  if (!messageId || !sessionId || !turnScopeId || !producerId) {
    throw Object.assign(new Error("Semantic Transfer V1 migration requires canonical message and Turn identity"), {
      code: "SESSION_TRANSFER_V1_IDENTITY_REQUIRED",
    });
  }
  const attachments = envelope.files.map((file) => {
    const metadata = file?.attachmentMeta && typeof file.attachmentMeta === "object"
      ? file.attachmentMeta
      : file;
    return {
      identity: {
        attachmentId: text(metadata?.attachmentId),
        sessionId: text(metadata?.sessionId),
        attachmentSource: text(metadata?.attachmentSource),
      },
      role: text(file?.role || metadata?.role) || "primary",
      name: text(file?.name || metadata?.name),
      mimeType: text(file?.mimeType || metadata?.mimeType) || "application/octet-stream",
      ...(Number.isSafeInteger(Number(file?.size ?? metadata?.size)) && Number(file?.size ?? metadata?.size) >= 0
        ? { size: Number(file?.size ?? metadata?.size) }
        : {}),
    };
  });
  return attachmentTransfer({
    transferId: stableId("transfer_migrated", [producerId, envelopeIdentity]),
    messageId,
    identity: {
      sessionId,
      turnScopeId,
      producer: { type: "session-repair", id: producerId },
    },
    direction: text(envelope.direction) || "output",
    attachments,
    intent: {
      source: "service",
      reason: "session_protocol_migration",
      scenario: envelopeIdentity.includes("nodeResultTransferEnvelopes")
        ? "workflow"
        : "tool",
      strategy: envelopeIdentity.includes("nodeResultTransferEnvelopes")
        ? "workflow_subagent"
        : "tool_output",
    },
    meta: {},
  });
}

function migrateTransferCollections(value, message, path = "message") {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.reduce(
      (changed, item, index) => migrateTransferCollections(item, message, `${path}[${index}]`) || changed,
      false,
    );
  }
  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "transferEnvelopes" || key === "nodeResultTransferEnvelopes") && Array.isArray(child)) {
      value[key] = child.map((envelope, index) => {
        const migrated = migrateTransferEnvelopeV1(envelope, message, `${path}.${key}[${index}]`);
        if (migrated !== envelope) changed = true;
        return migrated;
      });
      continue;
    }
    if (migrateTransferCollections(child, message, `${path}.${key}`)) changed = true;
  }
  return changed;
}

function migrateMessage(message = {}, sessionId = "", index = 0) {
  const hadSessionId = Object.hasOwn(message, "sessionId");
  const next = { ...message, sessionId: text(message.sessionId || sessionId) };
  let changed = false;
  if (next.chatPresentation === true && text(next.presentationMessageId) && text(next.sourceMessageUid)
    && Object.hasOwn(next, "messageUid")) {
    delete next.messageUid;
    changed = true;
  }
  if (!text(next.messageUid) && next.chatPresentation !== true) {
    const identitySeed = [sessionId, next.dialogProcessId, next.turnScopeId, next.messageId || next.id, index];
    if (!text(next.dialogProcessId) || !text(next.turnScopeId) || !text(next.messageId || next.id)) {
      throw Object.assign(new Error(`Session message ${index} has no migratable canonical identity`), {
        code: "SESSION_MESSAGE_IDENTITY_UNMIGRATABLE",
      });
    }
    next.messageUid = stableId("sm_migrated", identitySeed);
    changed = true;
  }
  if (next.injectedMessageType === undefined && next.injected_message_type !== undefined) {
    next.injectedMessageType = next.injected_message_type;
    delete next.injected_message_type;
    changed = true;
  }
  if (next.turnCommit && typeof next.turnCommit === "object" && !Array.isArray(next.turnCommit)
    && next.turnCommit.idempotencyKey !== undefined) {
    next.turnCommit = { ...next.turnCommit, commandId: next.turnCommit.commandId || next.turnCommit.idempotencyKey };
    delete next.turnCommit.idempotencyKey;
    changed = true;
  }
  if (migrateTransferCollections(next, next)) changed = true;
  if (!hadSessionId) delete next.sessionId;
  return { message: next, changed };
}

export function reconcileCompletedTurnSummaryMarks(document = {}) {
  const next = structuredClone(document);
  const messages = Array.isArray(next.messages) ? next.messages : [];
  const completedTurns = new Set(
    (Array.isArray(next.turnStatuses) ? next.turnStatuses : [])
      .filter((status) => String(status?.status || "").trim() === "completed")
      .map((status) => `${text(status?.dialogProcessId)}\u0000${text(status?.turnScopeId)}`)
      .filter((key) => !key.startsWith("\u0000") && !key.endsWith("\u0000")),
  );
  let changed = false;
  const repaired = [];
  for (const key of completedTurns) {
    const [dialogProcessId, turnScopeId] = key.split("\u0000");
    const indexes = messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => text(message?.dialogProcessId) === dialogProcessId &&
        text(message?.turnScopeId) === turnScopeId);
    if (!indexes.length) continue;
    const source = indexes.map(({ message }) => message);
    const projected = projectTurnCompletionMessages(source);
    let turnChanged = false;
    projected.forEach((message, index) => {
      const original = source[index];
      if (JSON.stringify(original) === JSON.stringify(message)) return;
      messages[indexes[index].index] = message;
      turnChanged = true;
    });
    if (turnChanged) {
      changed = true;
      repaired.push(turnScopeId);
    }
  }
  return { document: next, changed, repaired };
}

export function migrateSessionDocument(document = {}, { sessionId: suppliedSessionId = "" } = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), { code: "SESSION_REPAIR_SOURCE_INVALID" });
  }
  const next = structuredClone(document);
  const sessionId = text(next.sessionId || suppliedSessionId);
  let changed = false;
  const migrations = [];
  if ("version" in next || "revision" in next) {
    next.aggregateVersion = Math.max(0, Number(next.aggregateVersion || next.version || next.revision) || 0);
    delete next.version;
    delete next.revision;
    changed = true;
    migrations.push("session-aggregate-version-v1");
  }
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message, index) => {
      const result = migrateMessage(message, sessionId, index);
      changed ||= result.changed;
      return result.message;
    });
  }
  const summaryRepair = reconcileCompletedTurnSummaryMarks(next);
  if (summaryRepair.changed) {
    next.messages = summaryRepair.document.messages;
    changed = true;
    migrations.push("completed-turn-summary-marks");
  }
  if (next.message && typeof next.message === "object" && !Array.isArray(next.message)) {
    const result = migrateMessage(next.message, sessionId, 0);
    next.message = result.message;
    changed ||= result.changed;
  }
  if (Array.isArray(next.mutationReceipts)) {
    next.mutationReceipts = next.mutationReceipts.map((receipt) => {
      if (!("idempotencyKey" in receipt) && !("version" in receipt)) return receipt;
      const migrated = {
        ...receipt,
        commandId: receipt.commandId || receipt.idempotencyKey,
        aggregateVersion: Number(receipt.aggregateVersion || receipt.version || 0),
      };
      delete migrated.idempotencyKey;
      delete migrated.version;
      changed = true;
      return migrated;
    });
  }
  const replacementDialogProcessId = (replacement = {}) => {
    const replacementTurnScopeId = text(replacement.replacementTurnScopeId);
    const replacementUserMessageId = text(replacement.replacementUserMessageId);
    const message = (Array.isArray(next.messages) ? next.messages : []).find((item) =>
      text(item.messageId || item.id || item.messageUid) === replacementUserMessageId);
    const turn = (Array.isArray(next.turnOrder) ? next.turnOrder : []).find((item) =>
      text(item.turnScopeId) === replacementTurnScopeId);
    const resolved = text(message?.dialogProcessId || turn?.dialogProcessId);
    if (!resolved) {
      throw Object.assign(new Error(`Cannot migrate replacement dialog identity for Session ${sessionId}`), {
        code: "SESSION_REPLACEMENT_IDENTITY_UNMIGRATABLE",
      });
    }
    return resolved;
  };
  const migrateReplacement = (replacement) => {
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) return;
    if (replacement.committedVersion === undefined && replacement.replacementDialogProcessId !== undefined) return;
    replacement.committedAggregateVersion = Number(
      replacement.committedAggregateVersion || replacement.committedVersion || 0,
    );
    replacement.replacementDialogProcessId = text(replacement.replacementDialogProcessId)
      || replacementDialogProcessId(replacement);
    delete replacement.committedVersion;
    changed = true;
  };
  for (const replacement of Object.values(next.turnLifecycle?.replacedTurns || {})) migrateReplacement(replacement);
  for (const receipt of Array.isArray(next.mutationReceipts) ? next.mutationReceipts : []) {
    migrateReplacement(receipt?.result?.turnReplacement);
  }
  if (Object.hasOwn(next, "turnTerminalCommits")) {
    delete next.turnTerminalCommits;
    changed = true;
  }
  if (changed && migrations.length === 0) migrations.push("session-document-v1");
  return { document: next, changed, migrations };
}

export function reconcileExecutionSegmentIndex(index = {}, segments = []) {
  const next = structuredClone(index);
  const metadata = new Map(segments.map((segment) => [segment.file, segment]));
  const repaired = [];
  for (const entry of Array.isArray(next.segments) ? next.segments : []) {
    const actual = metadata.get(entry.file);
    if (!actual) continue;
    if (Number(entry.bytes) === actual.bytes && Number(entry.records) === actual.records) continue;
    entry.bytes = actual.bytes;
    entry.records = actual.records;
    repaired.push(entry.file);
  }
  return { index: next, repaired };
}

export function reconcileSessionSummaryIndex({ sessions = [], sessionIds = [] } = {}) {
  const allowedIds = new Set((Array.isArray(sessionIds) ? sessionIds : [])
    .map((id) => text(id)).filter(Boolean));
  const next = [];
  const seen = new Set();
  let changed = false;
  for (const item of Array.isArray(sessions) ? sessions : []) {
    const sessionId = text(item?.sessionId);
    if (!sessionId || !allowedIds.has(sessionId) || seen.has(sessionId)) {
      changed = true;
      continue;
    }
    seen.add(sessionId);
    next.push(item);
  }
  if (next.length !== allowedIds.size) changed = true;
  return { sessions: next, changed };
}

export async function runAtomicSessionRepair({ sessionDir = "", repair, validate } = {}) {
  if (!text(sessionDir) || typeof repair !== "function" || typeof validate !== "function") {
    throw Object.assign(new TypeError("Atomic Session repair requires sessionDir, repair and validate"), {
      code: "SESSION_REPAIR_ARGUMENT_INVALID",
    });
  }
  const stagingDir = `${sessionDir}.repair-staging-${randomUUID()}`;
  const backupDir = `${sessionDir}.repair-backup-${randomUUID()}`;
  await cp(sessionDir, stagingDir, { recursive: true, errorOnExist: true });
  try {
    const result = await repair(stagingDir);
    await validate(stagingDir);
    await rename(sessionDir, backupDir);
    try {
      await rename(stagingDir, sessionDir);
    } catch (error) {
      await rename(backupDir, sessionDir);
      throw error;
    }
    await rm(backupDir, { recursive: true, force: true });
    return result;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
