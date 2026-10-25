/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectTurnCompletionMessages } from "@noobot/context-protocol";
import { upgradeTransferEnvelopesInValue } from "@noobot/semantic-transfer-protocol";
import {
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  TURN_EXECUTION_STATE,
  TURN_PHASE,
  TURN_STATE,
  TURN_TERMINAL_STATUS,
  SESSION_ARTIFACT_AGGREGATE_VERSION_CONTRACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_MESSAGE_ID_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_TURN_TERMINAL_STATUS_SCHEMA_VERSION,
  TURN_ORPHAN_RECOVERY,
  createTurnCommitFingerprint,
  createTurnTerminalStatus,
  normalizeTurnTerminalStatus,
  isSessionAggregateVersion,
  createTurnLifecycleCommandId,
  isTurnCommitContinuation,
  normalizeTurnCommitMetadata,
  normalizeCommandReceipt,
  resolveSessionArtifactSchemaVersion,
  isTurnCommitAction,
  MESSAGE_REMOVED_FIELD_NAME,
  collectTurnReplacementTombstoneErrors,
} from "@noobot/session-protocol";
import {
  completedSemanticTransferMigrationNames,
  createSemanticTransferMigration,
  migrateSemanticTransfers,
  validateTransferCollections,
} from "./semantic-transfer-migrations.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";
import { stableId } from "./repair-primitives.js";
import { migrateWriteTimeDialogFacts } from "./write-time-dialog-facts.js";
import { migrateSessionCaller } from "./session-caller-migration.js";
import { migrateCanonicalCommandReceipts } from "./command-receipt-migration.js";
import { migrateMessageIdentity } from "./message-identity-migration.js";
import { migrateTurnTerminalDescription } from "./terminal-description-migration.js";
import { migrateMessageErrorText } from "./message-error-text-migration.js";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";
import {
  assertLegacyAuthorityEventOutbox,
  assertLegacyFieldSchema,
  materializeAggregateFields,
  migrateLegacyInjectedMessageType,
  migrateLegacyTurnCommitKey,
  requireLegacyArray,
} from "./legacy-field-migration.js";

const SESSION_COMMAND_TYPES = new Set(Object.values(SESSION_COMMAND));

function migrateArtifactSchema(document, migrations, sourceSchemaVersion) {
  if (sourceSchemaVersion === SESSION_ARTIFACT_SCHEMA_VERSION) return false;
  if (sourceSchemaVersion > SESSION_ARTIFACT_SCHEMA_VERSION) {
    throw Object.assign(new TypeError("Session artifact schema is newer than this runtime"), {
      code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_SCHEMA_UNSUPPORTED,
    });
  }
  document.schemaVersion = SESSION_ARTIFACT_SCHEMA_VERSION;
  migrations.push(`session-artifact-schema-v${SESSION_ARTIFACT_SCHEMA_VERSION}`);
  return true;
}

function requireMigratableTurnCommitAction(turnCommit) {
  if (isTurnCommitAction(turnCommit?.action)) return turnCommit.action;
  throw migrationError(
    "Session message turnCommit action is not a protocol commit action",
    SESSION_REPAIR_ERROR_CODE.TURN_COMMIT_UNMIGRATABLE,
  );
}

function migrateTurnCommitMetadata(message) {
  if (message.turnCommit === undefined) return false;
  if (text(message.turnCommit?.commandId)) requireMigratableTurnCommitAction(message.turnCommit);
  const canonical = normalizeTurnCommitMetadata(message.turnCommit);
  if (JSON.stringify(message.turnCommit) === JSON.stringify(canonical)) return false;
  if (canonical) message.turnCommit = canonical;
  else delete message.turnCommit;
  return true;
}

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

function migrateMessageIdField(context, message, index) {
  if (!Object.hasOwn(message, "id")) return false;
  assertLegacyFieldSchema(context, "message.id", SESSION_ARTIFACT_LEGACY_MESSAGE_ID_SCHEMA_VERSION);
  const legacyId = text(message.id);
  const messageId = text(message[LEGACY_MESSAGE_ID]);
  if (legacyId && messageId && legacyId !== messageId) {
    throw migrationError(
      `Session message ${index} has conflicting id and messageId`,
      SESSION_REPAIR_ERROR_CODE.MESSAGE_ID_CONFLICT,
      Error,
    );
  }
  if (!messageId && legacyId) message[LEGACY_MESSAGE_ID] = legacyId;
  delete message.id;
  return true;
}

function migrateMessage(context, message, index) {
  const { sessionId, transferMigration, migrateArtifactProtocol } = context;
  const hadSessionId = Object.hasOwn(message, "sessionId");
  const next = { ...message, sessionId: text(message.sessionId || sessionId) };
  let changed = false;
  changed = migrateMessageIdField(context, next, index) || changed;
  if (
    next.chatPresentation === true &&
    text(next.presentationMessageId) &&
    text(next.sourceMessageUid) &&
    Object.hasOwn(next, "messageUid")
  ) {
    delete next.messageUid;
    changed = true;
  }
  changed = migrateLegacyTurnCommitKey(context, next) || changed;
  if (migrateArtifactProtocol) changed = migrateTurnCommitMetadata(next) || changed;
  if (!text(next.messageUid) && next.chatPresentation !== true) {
    const legacyIdentitySeed = next[LEGACY_MESSAGE_ID];
    const identitySeed = [
      sessionId,
      next.dialogProcessId,
      next.turnScopeId,
      legacyIdentitySeed,
      index,
    ];
    if (!text(next.dialogProcessId) || !text(next.turnScopeId) || !text(legacyIdentitySeed)) {
      throw Object.assign(
        new Error(`Session message ${index} has no migratable canonical identity`),
        {
          code: SESSION_REPAIR_ERROR_CODE.MESSAGE_IDENTITY_UNMIGRATABLE,
        },
      );
    }
    next.messageUid = stableId("sm_migrated", identitySeed);
    changed = true;
  }
  changed = migrateLegacyInjectedMessageType(context, next) || changed;
  try {
    const envelopeUpgrade = upgradeTransferEnvelopesInValue(next);
    if (envelopeUpgrade.upgraded) {
      Object.assign(next, envelopeUpgrade.value);
      changed = true;
    }
    if (transferMigration) {
      changed = migrateSemanticTransfers(next, transferMigration) || changed;
    }
    validateTransferCollections(next);
  } catch (error) {
    throw Object.assign(
      new Error(`Session message ${index} has unmigratable transfer envelopes: ${error.message}`),
      { code: SESSION_REPAIR_ERROR_CODE.TRANSFER_ENVELOPE_UNMIGRATABLE, cause: error },
    );
  }
  if (!hadSessionId) delete next.sessionId;
  return { message: next, changed };
}

export function reconcileDuplicateCanonicalAssistantPresentations(document = {}) {
  const next = structuredClone(document);
  const messages = Array.isArray(next.messages) ? next.messages : [];
  const canonicalIndexes = new Map();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      text(message?.role) !== "assistant" ||
      message?.chatPresentation !== true ||
      !text(message?.turnScopeId)
    )
      continue;
    const turnScopeId = text(message.turnScopeId);
    const indexes = canonicalIndexes.get(turnScopeId) || [];
    indexes.push(index);
    canonicalIndexes.set(turnScopeId, indexes);
  }
  const repaired = [];
  for (const [turnScopeId, indexes] of canonicalIndexes) {
    if (indexes.length < 2) continue;
    const authoritativePresentationMessageId = text(
      next.turnLifecycle?.turns?.[turnScopeId]?.presentationMessageId,
    );
    const authoritativeIndex = indexes.find(
      (index) =>
        text(messages[index]?.presentationMessageId) === authoritativePresentationMessageId,
    );
    if (!authoritativePresentationMessageId || authoritativeIndex === undefined) {
      throw Object.assign(
        new Error(`canonical assistant presentation repair is ambiguous for Turn ${turnScopeId}`),
        { code: SESSION_REPAIR_ERROR_CODE.CANONICAL_PRESENTATION_REPAIR_AMBIGUOUS },
      );
    }
    for (const index of indexes) {
      if (index === authoritativeIndex) continue;
      messages[index] = { ...messages[index], chatPresentation: false };
    }
    repaired.push(turnScopeId);
  }
  return { document: next, changed: repaired.length > 0, repaired };
}

function completedTurnKeys(document) {
  return new Set(
    Object.values(document.turnLifecycle?.turns || {})
      .filter((turn) => text(turn?.terminalStatus?.status) === TURN_TERMINAL_STATUS.COMPLETED)
      .map((turn) => `${text(turn?.dialogProcessId)}\u0000${text(turn?.turnScopeId)}`)
      .filter((key) => !key.startsWith("\u0000") && !key.endsWith("\u0000")),
  );
}

function messageTurnKey(message) {
  return `${text(message?.dialogProcessId)}\u0000${text(message?.turnScopeId)}`;
}

export function reconcileCompletedTurnOrphanToolCalls(document = {}) {
  const messages = Array.isArray(document.messages) ? document.messages : [];
  const completedTurns = completedTurnKeys(document);
  const resultIds = new Set(
    messages
      .filter((message) => message?.type === "tool_result")
      .map((message) => `${messageTurnKey(message)}\u0000${text(message.tool_call_id)}`),
  );
  const removed = [];
  const kept = messages.filter((message) => {
    if (message?.type !== "tool_call" || !completedTurns.has(messageTurnKey(message))) return true;
    const ids = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call) =>
      text(call?.id),
    );
    const answered = ids.filter((id) =>
      resultIds.has(`${messageTurnKey(message)}\u0000${id}`),
    ).length;
    if (ids.length > 0 && answered === ids.length) return true;
    if (answered > 0) {
      throw Object.assign(
        new Error(`completed Turn tool_call has partial tool results: ${text(message.messageUid)}`),
        { code: SESSION_REPAIR_ERROR_CODE.ORPHAN_TOOL_CALL_REPAIR_AMBIGUOUS },
      );
    }
    removed.push(text(message.messageUid));
    return false;
  });
  const changed = removed.length > 0;
  return { document: changed ? { ...document, messages: kept } : document, changed, removed };
}

export function reconcileCompletedTurnSummaryMarks(document = {}) {
  const messages = Array.isArray(document.messages) ? [...document.messages] : [];
  const completedTurns = completedTurnKeys(document);
  const turnIndexes = new Map();
  messages.forEach((message, index) => {
    const key = messageTurnKey(message);
    if (!completedTurns.has(key)) return;
    if (!turnIndexes.has(key)) turnIndexes.set(key, []);
    turnIndexes.get(key).push(index);
  });
  const repaired = [];
  for (const key of completedTurns) {
    const indexes = turnIndexes.get(key);
    if (!indexes) continue;
    const source = indexes.map((index) => messages[index]);
    const projected = projectTurnCompletionMessages(source);
    let turnChanged = false;
    projected.forEach((message, index) => {
      if (message === source[index] || source[index]?.summarized === true) return;
      messages[indexes[index]] = message;
      turnChanged = true;
    });
    if (turnChanged) repaired.push(key.split("\u0000")[1]);
  }
  const changed = repaired.length > 0;
  return { document: changed ? { ...document, messages } : document, changed, repaired };
}

function isUncommittedAggregateConflictContinuation(turn, turns, messages) {
  const turnScopeId = text(turn?.turnScopeId);
  const sourceTurnScopeId = text(turn?.continuationSource?.turnScopeId);
  const sourceDialogProcessId = text(turn?.continuationSource?.dialogProcessId);
  if (
    !turnScopeId ||
    !isTurnCommitContinuation(turn?.action) ||
    turn?.state !== TURN_STATE.ACTION_FAILED ||
    turn?.phase !== TURN_PHASE.ACTION ||
    turn?.failure?.code !== SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT ||
    !sourceTurnScopeId ||
    !sourceDialogProcessId ||
    messages.some((message) => text(message?.turnScopeId) === turnScopeId)
  ) {
    return false;
  }
  const source = turns[sourceTurnScopeId];
  return (
    source?.state === TURN_STATE.STOP_COMPLETED &&
    source?.executionState === TURN_EXECUTION_STATE.USER_STOPPED &&
    text(source?.dialogProcessId) === sourceDialogProcessId &&
    text(source?.continuedByTurnScopeId) === turnScopeId
  );
}

export function reconcileUncommittedAggregateConflictContinuations(document = {}) {
  if (!isPlainObject(document)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: SESSION_REPAIR_ERROR_CODE.REPAIR_SOURCE_INVALID,
    });
  }
  const next = structuredClone(document);
  const turns = isPlainObject(next.turnLifecycle?.turns) ? next.turnLifecycle.turns : {};
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
  return { document: next, changed: true, repaired };
}

function migrationError(message, code, ErrorType = TypeError) {
  return Object.assign(new ErrorType(message), { code });
}

function markMigrated(context, migration) {
  context.changed = true;
  context.migrations.push(migration);
}

function migrateEventTypedReceipt(context, receipt, eventType, commandIdMap) {
  if (text(receipt.type) && text(receipt.type) !== eventType) {
    throw migrationError(
      "Session lifecycle receipt type is ambiguous",
      SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_TYPE_CONFLICT,
    );
  }
  const originalCommandId = text(receipt.commandId);
  const commandId = createTurnLifecycleCommandId({
    commandId: originalCommandId,
    eventType,
    phase: text(receipt.envelope?.phase),
  });
  if (!commandId) {
    throw migrationError(
      "Session lifecycle receipt cannot be migrated",
      SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_UNMIGRATABLE,
    );
  }
  commandIdMap.set(originalCommandId, commandId);
  const migrated = { ...receipt, commandId, type: eventType };
  delete migrated.eventType;
  if (isObjectLike(migrated.envelope)) {
    migrated.envelope = { ...migrated.envelope, commandId };
  }
  context.changed = true;
  return migrated;
}

function remapLifecycleCommandIds(context, commandIdMap) {
  for (const turn of Object.values(context.turns)) {
    if (!isPlainObject(turn)) continue;
    const commandId = commandIdMap.get(text(turn.commandId));
    if (commandId) turn.commandId = commandId;
    const completionCommitId = commandIdMap.get(text(turn.completionCommitId));
    if (completionCommitId) turn.completionCommitId = completionCommitId;
  }
  const { next } = context;
  if (Object.hasOwn(next, "authorityEventOutbox")) {
    next.authorityEventOutbox = next.authorityEventOutbox.map((entry) => {
      const envelope = entry?.envelope;
      const commandId = commandIdMap.get(text(envelope?.commandId));
      return commandId ? { ...entry, envelope: { ...envelope, commandId } } : entry;
    });
  }
  context.migrations.push("turn-lifecycle-command-receipts-v1");
}

function dropLegacyTurnCommitRunState(receipt) {
  if (receipt.type !== SESSION_COMMAND.TURN_COMMIT) return receipt;
  if (!isPlainObject(receipt.result) || !Object.hasOwn(receipt.result, "runState")) return receipt;
  const { runState: _runState, ...result } = receipt.result;
  return { ...receipt, result };
}

function canonicalLegacyCommandReceipt(receipt) {
  const normalized = normalizeCommandReceipt(dropLegacyTurnCommitRunState(receipt));
  if (!normalized) {
    throw migrationError(
      "Session command receipt cannot be migrated to the canonical shape",
      SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_UNMIGRATABLE,
    );
  }
  return normalized;
}

function migrateLifecycleCommandReceipts(context) {
  const { lifecycle } = context;
  const commandIdMap = new Map();
  const eventTypedCommandIds = new Set();
  lifecycle.commandReceipts = lifecycle.commandReceipts.map((receipt) => {
    if (!isPlainObject(receipt)) {
      throw migrationError(
        "Session command receipt must be an object",
        SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_UNMIGRATABLE,
      );
    }
    const eventType = text(receipt.eventType);
    if (!eventType) return receipt;
    assertLegacyFieldSchema(
      context,
      "commandReceipts[].eventType",
      SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
    );
    const migrated = migrateEventTypedReceipt(context, receipt, eventType, commandIdMap);
    eventTypedCommandIds.add(migrated.commandId);
    return migrated;
  });
  if (commandIdMap.size) remapLifecycleCommandIds(context, commandIdMap);
  migrateCanonicalCommandReceipts(context);
  if (!context.migrateArtifactProtocol) return;
  let normalizedCommandReceipts = false;
  lifecycle.commandReceipts = lifecycle.commandReceipts.map((receipt) => {
    if (eventTypedCommandIds.has(receipt.commandId)) return receipt;
    const normalized = canonicalLegacyCommandReceipt(receipt);
    if (JSON.stringify(normalized) !== JSON.stringify(receipt)) normalizedCommandReceipts = true;
    return normalized;
  });
  if (normalizedCommandReceipts) markMigrated(context, "session-command-receipt-canonical-v1");
}

function terminalStatusMatches(status, turns) {
  const turnScopeId = text(status?.turnScopeId);
  const terminalStatus = turns[turnScopeId]?.terminalStatus;
  return Boolean(
    turnScopeId &&
    terminalStatus &&
    text(terminalStatus.status) === text(status?.status) &&
    text(terminalStatus.reason) === text(status?.reason) &&
    text(terminalStatus.dialogProcessId) === text(status?.dialogProcessId),
  );
}

function migrateTurnStatuses(context) {
  const { next } = context;
  if (!Object.hasOwn(next, "turnStatuses")) return;
  assertLegacyFieldSchema(
    context,
    "turnStatuses",
    SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  );
  requireLegacyArray(next.turnStatuses, "turnStatuses");
  for (const status of next.turnStatuses) {
    if (!terminalStatusMatches(status, context.turns)) {
      throw migrationError(
        "Session terminal fact sources conflict",
        SESSION_REPAIR_ERROR_CODE.TERMINAL_FACT_CONFLICT,
      );
    }
  }
  delete next.turnStatuses;
  markMigrated(context, "turn-terminal-single-source-v1");
}

function isOrphanRecoveryFailure(failure) {
  const expected = TURN_ORPHAN_RECOVERY.failure;
  return (
    text(failure?.code) === expected.code &&
    text(failure?.message) === expected.message &&
    failure?.retryable === expected.retryable
  );
}

function rebuildOrphanTerminalStatus(turn) {
  return createTurnTerminalStatus(TURN_ORPHAN_RECOVERY.terminalCommand, {
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    description: TURN_ORPHAN_RECOVERY.failure.message,
    updatedAt: turn.finishedAt,
  });
}

function migrateTurnTerminalStatusShape(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_TURN_TERMINAL_STATUS_SCHEMA_VERSION) return;
  let migrated = false;
  for (const turn of Object.values(context.turns)) {
    if (!isPlainObject(turn) || turn.terminalStatus == null) continue;
    if (normalizeTurnTerminalStatus(turn.terminalStatus)) continue;
    const rebuilt = isOrphanRecoveryFailure(turn.failure)
      ? rebuildOrphanTerminalStatus(turn)
      : null;
    if (!rebuilt) {
      throw migrationError(
        "Session turn terminalStatus is not a protocol terminal status",
        SESSION_REPAIR_ERROR_CODE.TURN_TERMINAL_STATUS_UNMIGRATABLE,
      );
    }
    turn.terminalStatus = { ...rebuilt };
    migrated = true;
  }
  if (migrated) markMigrated(context, "turn-terminal-status-protocol-v1");
}

function hasCommandReceipt(lifecycle, commandId) {
  return lifecycle.commandReceipts.some((receipt) => text(receipt?.commandId) === commandId);
}

function migrateTurnCommitReceipts(context) {
  const { next, lifecycle } = context;
  if (!Array.isArray(next.messages)) return;
  let migratedTurnCommitReceipt = false;
  for (const message of next.messages) {
    const turnCommit = message?.turnCommit;
    const commandId = text(turnCommit?.commandId);
    if (!commandId) continue;
    const requestHash = createTurnCommitFingerprint({
      action: requireMigratableTurnCommitAction(turnCommit),
      content: text(message.content),
      turnScopeId: text(message.turnScopeId),
      resumeDialogProcessId: text(turnCommit.resumeDialogProcessId),
      resumeTurnScopeId: text(turnCommit.resumeTurnScopeId),
      attachments: message.attachments,
    });
    if (hasCommandReceipt(lifecycle, commandId)) continue;
    lifecycle.commandReceipts.push({
      commandId,
      type: SESSION_COMMAND.TURN_COMMIT,
      turnScopeId: text(message.turnScopeId),
      requestHash,
      aggregateVersion: requireAggregateVersion(
        next.aggregateVersion,
        SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
      ),
      result: { messageUid: text(message.messageUid) },
      committedAt: text(message.ts),
    });
    context.changed = true;
    migratedTurnCommitReceipt = true;
  }
  if (migratedTurnCommitReceipt) context.migrations.push("turn-commit-command-receipts-v1");
}

const MUTATION_OPERATION_COMMANDS = Object.freeze({
  delete_from: SESSION_COMMAND.MESSAGE_DELETE_FROM,
  replace_turn: SESSION_COMMAND.TURN_REPLACE,
});

function migrateMutationReceipt(lifecycle, receipt) {
  const type = MUTATION_OPERATION_COMMANDS[text(receipt?.operation)];
  const commandId = text(receipt?.commandId);
  if (!type || !commandId || !text(receipt?.requestHash)) {
    throw migrationError(
      "Session mutation receipt cannot be migrated",
      SESSION_REPAIR_ERROR_CODE.MUTATION_RECEIPT_UNMIGRATABLE,
    );
  }
  const existing = lifecycle.commandReceipts.find((item) => text(item?.commandId) === commandId);
  if (existing) {
    if (text(existing.type) !== type || text(existing.requestHash) !== text(receipt.requestHash)) {
      throw migrationError(
        "Session command receipt sources conflict",
        SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_CONFLICT,
      );
    }
    return;
  }
  lifecycle.commandReceipts.push({
    commandId,
    type,
    requestHash: text(receipt.requestHash),
    aggregateVersion: requireAggregateVersion(
      receipt.aggregateVersion,
      SESSION_REPAIR_ERROR_CODE.MUTATION_RECEIPT_UNMIGRATABLE,
    ),
    result: isPlainObject(receipt.result) ? structuredClone(receipt.result) : {},
    committedAt: text(receipt.committedAt),
  });
}

function migrateMutationReceipts(context) {
  const { next } = context;
  if (!Object.hasOwn(next, "mutationReceipts")) return;
  assertLegacyFieldSchema(
    context,
    "mutationReceipts",
    SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  );
  requireLegacyArray(next.mutationReceipts, "mutationReceipts");
  for (const receipt of next.mutationReceipts) migrateMutationReceipt(context.lifecycle, receipt);
  delete next.mutationReceipts;
  markMigrated(context, "session-command-receipts-v1");
}

function requireAggregateVersion(value, code) {
  if (isSessionAggregateVersion(value)) return value;
  throw migrationError("Session aggregate version cannot be migrated", code);
}

function isUncommittedSessionDocument(next, lifecycle) {
  const messages = Array.isArray(next.messages) ? next.messages : [];
  const receipts = Array.isArray(lifecycle.commandReceipts) ? lifecycle.commandReceipts : [];
  return messages.length === 0 && receipts.length === 0;
}

function resolveContractAggregateVersion(next, lifecycle) {
  if ("version" in next || "revision" in next) {
    const candidates = ["aggregateVersion", "version", "revision"]
      .filter((field) => Object.hasOwn(next, field))
      .map((field) => next[field]);
    if (new Set(candidates).size !== 1) {
      throw migrationError(
        "Session aggregate version fields conflict",
        SESSION_REPAIR_ERROR_CODE.AGGREGATE_VERSION_UNMIGRATABLE,
      );
    }
    delete next.version;
    delete next.revision;
    return requireAggregateVersion(
      candidates[0],
      SESSION_REPAIR_ERROR_CODE.AGGREGATE_VERSION_UNMIGRATABLE,
    );
  }
  if (Object.hasOwn(next, "aggregateVersion")) {
    return requireAggregateVersion(
      next.aggregateVersion,
      SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
    );
  }
  if (isUncommittedSessionDocument(next, lifecycle)) return 0;
  throw migrationError(
    "Session aggregate version is missing for a committed Session",
    SESSION_REPAIR_ERROR_CODE.AGGREGATE_VERSION_UNMIGRATABLE,
  );
}

function stripLifecycleReceiptAggregateVersions(lifecycle) {
  if (!Array.isArray(lifecycle.commandReceipts)) return false;
  let stripped = false;
  for (const receipt of lifecycle.commandReceipts) {
    if (!isPlainObject(receipt) || SESSION_COMMAND_TYPES.has(text(receipt.type))) continue;
    if (!Object.hasOwn(receipt, "aggregateVersion")) continue;
    delete receipt.aggregateVersion;
    stripped = true;
  }
  return stripped;
}

function migrateAggregateVersionContract(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_AGGREGATE_VERSION_CONTRACT_SCHEMA_VERSION) {
    return;
  }
  const { next, lifecycle } = context;
  const before = next.aggregateVersion;
  const hadLegacy = "version" in next || "revision" in next;
  next.aggregateVersion = resolveContractAggregateVersion(next, lifecycle);
  const stripped = stripLifecycleReceiptAggregateVersions(lifecycle);
  if (hadLegacy || stripped || before !== next.aggregateVersion) {
    markMigrated(context, "session-aggregate-version-contract-v1");
  }
}

function migrateDocumentMessage(context, message, index) {
  const result = migrateMessage(context, message, index);
  context.changed ||= result.changed;
  return result.message;
}

function applyMessageRepair(context, repair, migration) {
  if (!repair.changed) return;
  context.next.messages = repair.document.messages;
  markMigrated(context, migration);
}

function migrateDocumentMessages(context) {
  const { next } = context;
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message, index) =>
      migrateDocumentMessage(context, message, index),
    );
  }
  applyMessageRepair(
    context,
    reconcileDuplicateCanonicalAssistantPresentations(next),
    "duplicate-canonical-assistant-presentation",
  );
  applyMessageRepair(
    context,
    reconcileCompletedTurnOrphanToolCalls(next),
    "completed-turn-orphan-tool-calls",
  );
  applyMessageRepair(
    context,
    reconcileCompletedTurnSummaryMarks(next),
    "completed-turn-summary-marks",
  );
  context.migrations.push(...completedSemanticTransferMigrationNames(context.transferMigration));
}

function assertReplacementTombstone(context, replacement) {
  const errors = collectTurnReplacementTombstoneErrors(replacement, context.lifecycle.sequence);
  if (!errors.length) return;
  throw migrationError(
    `Session ${context.sessionId} replacement tombstone is unmigratable: ${errors.join(",")}`,
    SESSION_REPAIR_ERROR_CODE.REPLACEMENT_IDENTITY_UNMIGRATABLE,
    Error,
  );
}

function migrateReplacedTurns(context) {
  for (const replacement of Object.values(context.lifecycle.replacedTurns)) {
    assertReplacementTombstone(context, replacement);
  }
}

function dropLegacyTerminalCommits(context) {
  if (!Object.hasOwn(context.next, "turnTerminalCommits")) return;
  delete context.next.turnTerminalCommits;
  context.changed = true;
}

function extractLegacyAuthorityEventOutbox(context) {
  const { next } = context;
  if (!Object.hasOwn(next, "authorityEventOutbox")) return [];
  const legacyAuthorityEventOutbox = next.authorityEventOutbox;
  delete next.authorityEventOutbox;
  markMigrated(context, "authority-event-outbox-journal-v1");
  return legacyAuthorityEventOutbox;
}

function createDocumentMigrationContext(document) {
  if (!isPlainObject(document)) {
    throw migrationError(
      "Session repair source must be an object",
      SESSION_REPAIR_ERROR_CODE.REPAIR_SOURCE_INVALID,
    );
  }
  const next = structuredClone(document);
  const sourceSchemaVersion = resolveSessionArtifactSchemaVersion(next.schemaVersion);
  const sessionId = text(next.sessionId);
  const transferMigration = createSemanticTransferMigration(next);
  const migrations = [];
  const changed = migrateArtifactSchema(next, migrations, sourceSchemaVersion);
  const lifecycle = materializeAggregateFields(next, sourceSchemaVersion);
  return {
    next,
    migrations,
    changed,
    lifecycle,
    turns: lifecycle.turns,
    sessionId,
    sourceSchemaVersion,
    transferMigration,
    droppedCommandReceiptIds: [],
    migrateArtifactProtocol:
      sourceSchemaVersion <= SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION,
  };
}

const DOCUMENT_MIGRATION_STEPS = Object.freeze([
  assertLegacyAuthorityEventOutbox,
  migrateAggregateVersionContract,
  migrateLifecycleCommandReceipts,
  migrateTurnStatuses,
  migrateTurnTerminalDescription,
  migrateTurnTerminalStatusShape,
  migrateTurnCommitReceipts,
  migrateMutationReceipts,
  migrateDocumentMessages,
  migrateMessageErrorText,
  migrateMessageIdentity,
  migrateReplacedTurns,
  dropLegacyTerminalCommits,
  migrateWriteTimeDialogFacts,
  migrateSessionCaller,
]);

export function migrateSessionDocument(document = {}) {
  const context = createDocumentMigrationContext(document);
  for (const step of DOCUMENT_MIGRATION_STEPS) step(context);
  const legacyAuthorityEventOutbox = extractLegacyAuthorityEventOutbox(context);
  if (context.changed && context.migrations.length === 0) {
    context.migrations.push("session-document-v1");
  }
  return {
    document: context.next,
    changed: context.changed,
    migrations: context.migrations,
    droppedCommandReceiptIds: context.droppedCommandReceiptIds,
    legacyAuthorityEventOutbox,
  };
}
