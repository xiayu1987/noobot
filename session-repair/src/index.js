/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachmentTransfer, assertTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import { projectTurnCompletionMessages } from "@noobot/context-protocol";
import {
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  createTurnCommitFingerprint,
  createTurnLifecycleCommandId,
} from "@noobot/session-protocol";

export const SESSION_REPAIR_PROTOCOL_VERSION = 1;

function resolveRepairArtifactPath(sessionDir, relativeFile, expectedRoot, extensions) {
  const reference = String(relativeFile || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const root = path.resolve(sessionDir, expectedRoot);
  const resolved = path.resolve(sessionDir, normalized);
  if (
    !reference ||
    path.isAbsolute(reference) ||
    reference.includes("\0") ||
    normalized === "." ||
    normalized.startsWith(`..${path.sep}`) ||
    (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) ||
    !extensions.includes(path.extname(resolved))
  ) {
    throw Object.assign(new Error(`invalid Session repair artifact reference: ${reference}`), {
      code: "SESSION_REPAIR_ARTIFACT_PATH_INVALID",
    });
  }
  return resolved;
}

async function readRepairJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`Session repair artifact is unreadable: ${file}`), {
      code:
        error instanceof SyntaxError
          ? "ARTIFACT_JSON_CORRUPTED"
          : "SESSION_REPAIR_ARTIFACT_READ_FAILED",
      cause: error,
    });
  }
}

async function readRepairJournal(file, committedBytes) {
  const raw = await readFile(file);
  const committed = Number(committedBytes || 0);
  if (!Number.isSafeInteger(committed) || committed < 0 || raw.length < committed) {
    throw Object.assign(new Error(`Session repair journal has an invalid boundary: ${file}`), {
      code: "TURN_JOURNAL_TRUNCATED",
    });
  }
  return raw
    .subarray(0, committed)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw Object.assign(new Error(`Session repair journal is corrupted: ${file}`), {
          code: "ARTIFACT_JSON_CORRUPTED",
          cause: error,
        });
      }
    });
}

function materializeRepairRecords(records, order, baseMessages = []) {
  const byUid = new Map(
    baseMessages.map((message) => [text(message?.messageUid), message]).filter(([uid]) => uid),
  );
  for (const record of records) {
    const uid = text(record?.messageUid);
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && record.message && typeof record.message === "object")
      byUid.set(uid, record.message);
  }
  const orderedUids = Array.isArray(order) ? order.map(text).filter(Boolean) : [];
  const ordered = orderedUids.map((uid) => byUid.get(uid)).filter(Boolean);
  const selected = new Set(orderedUids);
  return [
    ...ordered,
    ...[...byUid].filter(([uid]) => !selected.has(uid)).map(([, message]) => message),
  ];
}

async function readLegacyCheckpointMessages(sessionDir, records) {
  const indexes = records.filter((record) => record?.op === "summary_snapshot");
  if (!indexes.length) return [];
  const latest = indexes.at(-1);
  const file = resolveRepairArtifactPath(sessionDir, latest.file, "turn-snapshots", [".json"]);
  const payload = await readRepairJson(file);
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  if (
    payload?.checkpointId !== latest.checkpointId ||
    Number(payload?.checkpointRevision) !== Number(latest.checkpointRevision) ||
    contentHash !== latest.contentHash ||
    !Array.isArray(payload.messages)
  ) {
    throw Object.assign(
      new Error(`legacy cumulative checkpoint does not match its index: ${latest.file}`),
      {
        code: "SESSION_REPAIR_CHECKPOINT_MISMATCH",
      },
    );
  }
  return payload.messages;
}

export async function readSessionForProtocolRepair({ sessionDir = "", session = null } = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: "SESSION_REPAIR_SOURCE_INVALID",
    });
  }
  if (Array.isArray(session.messages)) return session;
  const messagesByTurnId = new Map();
  const messages = [];
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const relativeFile = typeof item === "string" ? item : item?.file;
    if (!relativeFile) continue;
    const artifact = resolveRepairArtifactPath(sessionDir, relativeFile, "turns", [
      ".json",
      ".jsonl",
    ]);
    let turnMessages;
    if (path.extname(artifact) === ".jsonl") {
      const records = await readRepairJournal(artifact, item?.committedBytes);
      const baseMessages = await readLegacyCheckpointMessages(sessionDir, records);
      turnMessages = materializeRepairRecords(records, item?.messageOrder, baseMessages);
    } else {
      const turn = await readRepairJson(artifact);
      if (!Array.isArray(turn?.messages)) {
        throw Object.assign(new Error(`legacy Session turn is invalid: ${relativeFile}`), {
          code: "SESSION_TURN_ARTIFACT_MISSING",
        });
      }
      turnMessages = turn.messages;
    }
    const turnId = text(item?.turnId);
    if (turnId) messagesByTurnId.set(turnId, turnMessages);
    messages.push(...turnMessages);
  }
  const order = Array.isArray(session.messageOrder) ? session.messageOrder : [];
  return {
    ...session,
    messages:
      order.length && order.some((reference) => reference?.turnId)
        ? order
            .map(
              (reference) =>
                messagesByTurnId.get(text(reference?.turnId))?.[Number(reference?.messageIndex)],
            )
            .filter(Boolean)
        : order.length
          ? order
              .map((reference) =>
                messages.find(
                  (message) => text(message?.messageUid) === text(reference?.messageUid),
                ),
              )
              .filter(Boolean)
          : messages,
  };
}

function checkpointContentHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function messageTimestamp(record, turnId) {
  const timestamp = Date.parse(String(record?.message?.ts || "").trim());
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid message timestamp: ${turnId}`),
    { code: "SESSION_REPAIR_CHECKPOINT_MESSAGE_TIMESTAMP_INVALID" },
  );
}

function checkpointTimestamp(payload, turnId) {
  const timestamp = Date.parse(String(payload?.committedAt || "").trim());
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid commit timestamp: ${turnId}`),
    { code: "SESSION_REPAIR_CHECKPOINT_TIMESTAMP_INVALID" },
  );
}

function assertCheckpointIndex(payload, index, previousHash, turnId) {
  if (
    Number(payload?.schemaVersion) !== 2 ||
    !Array.isArray(payload.records) ||
    Object.hasOwn(payload, "messages") ||
    payload.checkpointId !== index.checkpointId ||
    Number(payload.checkpointRevision) !== Number(index.checkpointRevision) ||
    payload.previousCheckpointHash !== previousHash ||
    checkpointContentHash(payload) !== index.contentHash
  ) {
    throw Object.assign(new Error(`Cannot resegment an invalid checkpoint chain: ${turnId}`), {
      code: "SESSION_REPAIR_CHECKPOINT_CHAIN_INVALID",
    });
  }
}

/**
 * Rebuilds the artificial first-checkpoint baseline produced while converting a
 * cumulative legacy Session. This is repair-only: canonical runtime writers
 * already emit true incremental checkpoint records.
 */
export async function resegmentMigratedCheckpointBaselines({ sessionDir = "" } = {}) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readRepairJson(manifestFile);
  const repaired = [];
  for (const turn of Array.isArray(manifest?.turnOrder) ? manifest.turnOrder : []) {
    const turnId = text(turn?.turnId);
    const journalFile = resolveRepairArtifactPath(sessionDir, turn?.file, "turns", [".jsonl"]);
    const journal = await readRepairJournal(journalFile, turn?.committedBytes);
    const indexes = journal.filter((record) => record?.op === "summary_snapshot");
    const existingTail = journal.filter((record) => record?.op !== "summary_snapshot");
    if (indexes.length < 2) continue;

    const checkpoints = [];
    let previousHash = "";
    let previousCommittedAt = -Infinity;
    for (const index of indexes) {
      const checkpointFile = resolveRepairArtifactPath(sessionDir, index.file, "turn-snapshots", [
        ".json",
      ]);
      const payload = await readRepairJson(checkpointFile);
      assertCheckpointIndex(payload, index, previousHash, turnId);
      const committedAt = checkpointTimestamp(payload, turnId);
      if (committedAt <= previousCommittedAt) {
        throw Object.assign(
          new Error(`Checkpoint commit order is not strictly increasing: ${turnId}`),
          { code: "SESSION_REPAIR_CHECKPOINT_ORDER_INVALID" },
        );
      }
      checkpoints.push({ index, checkpointFile, payload, committedAt });
      previousHash = index.contentHash;
      previousCommittedAt = committedAt;
    }

    const [baseline, ...following] = checkpoints;
    if (!baseline.payload.records.length || following.some(({ payload }) => payload.records.length))
      continue;
    const incrementalRecords = baseline.payload.records;
    if (
      incrementalRecords.some(
        (record) =>
          record?.op !== "upsert" ||
          !text(record?.messageUid) ||
          text(record?.message?.messageUid) !== text(record?.messageUid),
      )
    ) {
      throw Object.assign(
        new Error(`Migrated checkpoint baseline is not a canonical upsert set: ${turnId}`),
        { code: "SESSION_REPAIR_CHECKPOINT_BASELINE_INVALID" },
      );
    }

    const buckets = checkpoints.map(() => []);
    const repairedTail = [];
    for (const record of incrementalRecords) {
      const createdAt = messageTimestamp(record, turnId);
      const checkpointIndex = checkpoints.findIndex(({ committedAt }) => createdAt <= committedAt);
      if (checkpointIndex < 0) repairedTail.push(record);
      else buckets[checkpointIndex].push(record);
    }

    const nextIndexes = [];
    previousHash = "";
    for (let index = 0; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index];
      const payload = {
        ...checkpoint.payload,
        previousCheckpointHash: previousHash,
        records: buckets[index],
      };
      const contentHash = checkpointContentHash(payload);
      await writeFile(checkpoint.checkpointFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      nextIndexes.push({ ...checkpoint.index, contentHash });
      previousHash = contentHash;
    }
    const nextJournal = [...nextIndexes, ...repairedTail, ...existingTail];
    const journalText = nextJournal.map((record) => `${JSON.stringify(record)}\n`).join("");
    await writeFile(journalFile, journalText, "utf8");
    turn.committedBytes = Buffer.byteLength(journalText, "utf8");
    turn.recordCount = nextJournal.length;
    repaired.push({
      turnId,
      checkpointRecordCounts: buckets.map((records) => records.length),
      tailRecordCount: repairedTail.length + existingTail.length,
    });
  }
  if (repaired.length)
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return repaired;
}

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
    throw Object.assign(
      new Error("Semantic Transfer V1 migration requires canonical message and Turn identity"),
      {
        code: "SESSION_TRANSFER_V1_IDENTITY_REQUIRED",
      },
    );
  }
  const attachments = envelope.files.map((file) => {
    const metadata =
      file?.attachmentMeta && typeof file.attachmentMeta === "object" ? file.attachmentMeta : file;
    return {
      identity: {
        attachmentId: text(metadata?.attachmentId),
        sessionId: text(metadata?.sessionId),
        attachmentSource: text(metadata?.attachmentSource),
      },
      role: text(file?.role || metadata?.role) || "primary",
      name: text(file?.name || metadata?.name),
      mimeType: text(file?.mimeType || metadata?.mimeType) || "application/octet-stream",
      ...(Number.isSafeInteger(Number(file?.size ?? metadata?.size)) &&
      Number(file?.size ?? metadata?.size) >= 0
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
      scenario: envelopeIdentity.includes("nodeResultTransferEnvelopes") ? "workflow" : "tool",
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
      (changed, item, index) =>
        migrateTransferCollections(item, message, `${path}[${index}]`) || changed,
      false,
    );
  }
  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "transferEnvelopes" || key === "nodeResultTransferEnvelopes") &&
      Array.isArray(child)
    ) {
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
  if (
    next.chatPresentation === true &&
    text(next.presentationMessageId) &&
    text(next.sourceMessageUid) &&
    Object.hasOwn(next, "messageUid")
  ) {
    delete next.messageUid;
    changed = true;
  }
  if (!text(next.messageUid) && next.chatPresentation !== true) {
    const identitySeed = [
      sessionId,
      next.dialogProcessId,
      next.turnScopeId,
      next.messageId || next.id,
      index,
    ];
    if (
      !text(next.dialogProcessId) ||
      !text(next.turnScopeId) ||
      !text(next.messageId || next.id)
    ) {
      throw Object.assign(
        new Error(`Session message ${index} has no migratable canonical identity`),
        {
          code: "SESSION_MESSAGE_IDENTITY_UNMIGRATABLE",
        },
      );
    }
    next.messageUid = stableId("sm_migrated", identitySeed);
    changed = true;
  }
  if (next.injectedMessageType === undefined && next.injected_message_type !== undefined) {
    next.injectedMessageType = next.injected_message_type;
    delete next.injected_message_type;
    changed = true;
  }
  if (
    next.turnCommit &&
    typeof next.turnCommit === "object" &&
    !Array.isArray(next.turnCommit) &&
    next.turnCommit.idempotencyKey !== undefined
  ) {
    next.turnCommit = {
      ...next.turnCommit,
      commandId: next.turnCommit.commandId || next.turnCommit.idempotencyKey,
    };
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
    Object.values(next.turnLifecycle?.turns || {})
      .filter((turn) => String(turn?.terminalStatus?.status || "").trim() === "completed")
      .map((turn) => `${text(turn?.dialogProcessId)}\u0000${text(turn?.turnScopeId)}`)
      .filter((key) => !key.startsWith("\u0000") && !key.endsWith("\u0000")),
  );
  let changed = false;
  const repaired = [];
  for (const key of completedTurns) {
    const [dialogProcessId, turnScopeId] = key.split("\u0000");
    const indexes = messages
      .map((message, index) => ({ message, index }))
      .filter(
        ({ message }) =>
          text(message?.dialogProcessId) === dialogProcessId &&
          text(message?.turnScopeId) === turnScopeId,
      );
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

function isUncommittedAggregateConflictContinuation(turn, turns, messages) {
  const turnScopeId = text(turn?.turnScopeId);
  const sourceTurnScopeId = text(turn?.continuationSource?.turnScopeId);
  const sourceDialogProcessId = text(turn?.continuationSource?.dialogProcessId);
  if (
    !turnScopeId ||
    turn?.action !== "continue" ||
    turn?.state !== "action_failed" ||
    turn?.phase !== "action" ||
    turn?.failure?.code !== SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT ||
    !sourceTurnScopeId ||
    !sourceDialogProcessId ||
    messages.some((message) => text(message?.turnScopeId) === turnScopeId)
  ) {
    return false;
  }
  const source = turns[sourceTurnScopeId];
  return (
    source?.state === "stop_completed" &&
    source?.executionState === "user_stopped" &&
    text(source?.dialogProcessId) === sourceDialogProcessId &&
    text(source?.continuedByTurnScopeId) === turnScopeId
  );
}

/**
 * Removes failed pre-commit continuation attempts left by the former runtime
 * ordering. This repair is valid only when the failed Turn committed no message.
 */
export function reconcileUncommittedAggregateConflictContinuations(document = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: "SESSION_REPAIR_SOURCE_INVALID",
    });
  }
  const next = structuredClone(document);
  const turns =
    next.turnLifecycle?.turns &&
    typeof next.turnLifecycle.turns === "object" &&
    !Array.isArray(next.turnLifecycle.turns)
      ? next.turnLifecycle.turns
      : {};
  const messages = Array.isArray(next.messages) ? next.messages : [];
  const repaired = Object.values(turns)
    .filter((turn) => isUncommittedAggregateConflictContinuation(turn, turns, messages))
    .map((turn) => text(turn.turnScopeId));
  if (repaired.length === 0) return { document: next, changed: false, repaired };

  const repairedSet = new Set(repaired);
  const sourceScopeIds = new Set(
    Object.values(turns)
      .filter((turn) => repairedSet.has(text(turn?.turnScopeId)))
      .map((turn) => text(turn?.continuationSource?.turnScopeId)),
  );
  next.turnLifecycle.turns = Object.fromEntries(
    Object.entries(turns)
      .filter(([turnScopeId]) => !repairedSet.has(turnScopeId))
      .map(([turnScopeId, turn]) => [
        turnScopeId,
        sourceScopeIds.has(turnScopeId) ? { ...turn, continuedByTurnScopeId: "" } : turn,
      ]),
  );
  next.turnLifecycle.commandReceipts = (
    Array.isArray(next.turnLifecycle.commandReceipts) ? next.turnLifecycle.commandReceipts : []
  ).filter((receipt) => !repairedSet.has(text(receipt?.turnScopeId)));
  next.authorityEventOutbox = (
    Array.isArray(next.authorityEventOutbox) ? next.authorityEventOutbox : []
  ).filter((entry) => !repairedSet.has(text(entry?.envelope?.turnScopeId)));
  return { document: next, changed: true, repaired };
}

export function migrateSessionDocument(document = {}, { sessionId: suppliedSessionId = "" } = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: "SESSION_REPAIR_SOURCE_INVALID",
    });
  }
  const next = structuredClone(document);
  const sessionId = text(next.sessionId || suppliedSessionId);
  let changed = false;
  const migrations = [];
  const lifecycle =
    next.turnLifecycle &&
    typeof next.turnLifecycle === "object" &&
    !Array.isArray(next.turnLifecycle)
      ? next.turnLifecycle
      : (next.turnLifecycle = {});
  const turns =
    lifecycle.turns && typeof lifecycle.turns === "object" && !Array.isArray(lifecycle.turns)
      ? lifecycle.turns
      : (lifecycle.turns = {});
  const commandReceipts = Array.isArray(lifecycle.commandReceipts) ? lifecycle.commandReceipts : [];
  const lifecycleCommandIdMap = new Map();
  lifecycle.commandReceipts = commandReceipts.map((receipt) => {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return receipt;
    const eventType = text(receipt.eventType);
    if (!eventType) return receipt;
    if (text(receipt.type) && text(receipt.type) !== eventType) {
      throw Object.assign(new TypeError("Session lifecycle receipt type is ambiguous"), {
        code: "SESSION_COMMAND_RECEIPT_TYPE_CONFLICT",
      });
    }
    const originalCommandId = text(receipt.commandId);
    const commandId = createTurnLifecycleCommandId({
      commandId: originalCommandId,
      eventType,
      phase: text(receipt.envelope?.phase),
    });
    if (!commandId) {
      throw Object.assign(new TypeError("Session lifecycle receipt cannot be migrated"), {
        code: "SESSION_COMMAND_RECEIPT_UNMIGRATABLE",
      });
    }
    lifecycleCommandIdMap.set(originalCommandId, commandId);
    const migrated = { ...receipt, commandId, type: eventType };
    delete migrated.eventType;
    if (migrated.envelope && typeof migrated.envelope === "object") {
      migrated.envelope = { ...migrated.envelope, commandId };
    }
    changed = true;
    return migrated;
  });
  if (lifecycleCommandIdMap.size) {
    for (const turn of Object.values(turns)) {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) continue;
      const commandId = lifecycleCommandIdMap.get(text(turn.commandId));
      if (commandId) turn.commandId = commandId;
      const completionCommitId = lifecycleCommandIdMap.get(text(turn.completionCommitId));
      if (completionCommitId) turn.completionCommitId = completionCommitId;
    }
    if (Array.isArray(next.authorityEventOutbox)) {
      next.authorityEventOutbox = next.authorityEventOutbox.map((entry) => {
        const envelope = entry?.envelope;
        const commandId = lifecycleCommandIdMap.get(text(envelope?.commandId));
        return commandId ? { ...entry, envelope: { ...envelope, commandId } } : entry;
      });
    }
    migrations.push("turn-lifecycle-command-receipts-v1");
  }
  if (Array.isArray(next.turnStatuses)) {
    for (const status of next.turnStatuses) {
      const turnScopeId = text(status?.turnScopeId);
      const terminalStatus = turns[turnScopeId]?.terminalStatus;
      if (
        !turnScopeId ||
        !terminalStatus ||
        text(terminalStatus.status) !== text(status?.status) ||
        text(terminalStatus.reason) !== text(status?.reason) ||
        text(terminalStatus.dialogProcessId) !== text(status?.dialogProcessId)
      ) {
        throw Object.assign(new TypeError("Session terminal fact sources conflict"), {
          code: "SESSION_TERMINAL_FACT_CONFLICT",
        });
      }
    }
    delete next.turnStatuses;
    changed = true;
    migrations.push("turn-terminal-single-source-v1");
  }
  if (Array.isArray(next.messages)) {
    let migratedTurnCommitReceipt = false;
    for (const message of next.messages) {
      const turnCommit = message?.turnCommit;
      const commandId = text(turnCommit?.commandId);
      if (!commandId) continue;
      const requestHash = createTurnCommitFingerprint({
        action: text(turnCommit.action) || "send",
        content: text(message.content),
        turnScopeId: text(message.turnScopeId),
        resumeDialogProcessId: text(turnCommit.resumeDialogProcessId),
        resumeTurnScopeId: text(turnCommit.resumeTurnScopeId),
        attachments: message.attachments,
      });
      if (lifecycle.commandReceipts.some((receipt) => text(receipt?.commandId) === commandId)) {
        continue;
      }
      lifecycle.commandReceipts.push({
        commandId,
        type: SESSION_COMMAND.TURN_COMMIT,
        turnScopeId: text(message.turnScopeId),
        requestHash,
        aggregateVersion: Number(next.aggregateVersion || 0),
        result: {
          messageUid: text(message.messageUid),
          runState: text(turnCommit.runState) || "pending_start",
        },
        committedAt: text(message.ts),
      });
      changed = true;
      migratedTurnCommitReceipt = true;
    }
    if (migratedTurnCommitReceipt) {
      migrations.push("turn-commit-command-receipts-v1");
    }
  }
  if (Array.isArray(next.mutationReceipts)) {
    const operationTypes = {
      delete_from: SESSION_COMMAND.MESSAGE_DELETE_FROM,
      replace_turn: SESSION_COMMAND.TURN_REPLACE,
    };
    for (const receipt of next.mutationReceipts) {
      const type = operationTypes[text(receipt?.operation)];
      const commandId = text(receipt?.commandId);
      if (!type || !commandId || !text(receipt?.requestHash)) {
        throw Object.assign(new TypeError("Session mutation receipt cannot be migrated"), {
          code: "SESSION_MUTATION_RECEIPT_UNMIGRATABLE",
        });
      }
      const existing = lifecycle.commandReceipts.find(
        (item) => text(item?.commandId) === commandId,
      );
      if (existing) {
        if (
          text(existing.type) !== type ||
          text(existing.requestHash) !== text(receipt.requestHash)
        ) {
          throw Object.assign(new TypeError("Session command receipt sources conflict"), {
            code: "SESSION_COMMAND_RECEIPT_CONFLICT",
          });
        }
        continue;
      }
      lifecycle.commandReceipts.push({
        commandId,
        type,
        requestHash: text(receipt.requestHash),
        aggregateVersion: Number(receipt.aggregateVersion || 0),
        result:
          receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result)
            ? structuredClone(receipt.result)
            : {},
        committedAt: text(receipt.committedAt),
      });
    }
    delete next.mutationReceipts;
    changed = true;
    migrations.push("session-command-receipts-v1");
  }
  if ("version" in next || "revision" in next) {
    next.aggregateVersion = Math.max(
      0,
      Number(next.aggregateVersion || next.version || next.revision) || 0,
    );
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
  const replacementDialogProcessId = (replacement = {}) => {
    const replacementTurnScopeId = text(replacement.replacementTurnScopeId);
    const replacementUserMessageId = text(replacement.replacementUserMessageId);
    const message = (Array.isArray(next.messages) ? next.messages : []).find(
      (item) => text(item.messageId || item.id || item.messageUid) === replacementUserMessageId,
    );
    const turn = (Array.isArray(next.turnOrder) ? next.turnOrder : []).find(
      (item) => text(item.turnScopeId) === replacementTurnScopeId,
    );
    const resolved = text(message?.dialogProcessId || turn?.dialogProcessId);
    if (!resolved) {
      throw Object.assign(
        new Error(`Cannot migrate replacement dialog identity for Session ${sessionId}`),
        {
          code: "SESSION_REPLACEMENT_IDENTITY_UNMIGRATABLE",
        },
      );
    }
    return resolved;
  };
  const migrateReplacement = (replacement) => {
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) return;
    if (
      replacement.committedVersion === undefined &&
      replacement.replacementDialogProcessId !== undefined
    )
      return;
    replacement.committedAggregateVersion = Number(
      replacement.committedAggregateVersion || replacement.committedVersion || 0,
    );
    replacement.replacementDialogProcessId =
      text(replacement.replacementDialogProcessId) || replacementDialogProcessId(replacement);
    delete replacement.committedVersion;
    changed = true;
  };
  for (const replacement of Object.values(next.turnLifecycle?.replacedTurns || {}))
    migrateReplacement(replacement);
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
  const allowedIds = new Set(
    (Array.isArray(sessionIds) ? sessionIds : []).map((id) => text(id)).filter(Boolean),
  );
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
    throw Object.assign(
      new TypeError("Atomic Session repair requires sessionDir, repair and validate"),
      {
        code: "SESSION_REPAIR_ARGUMENT_INVALID",
      },
    );
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
