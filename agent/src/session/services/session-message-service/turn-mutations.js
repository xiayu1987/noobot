/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid } from "../../../context/session/message-uid.js";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { normalizeIncomingAttachmentsForSessionMessage } from "./attachment-helpers.js";
import {
  resolveAggregateVersion,
  createMessageAnchorMatcher,
  resolveUserTurnStartIndex,
  clearReplacementUserRuntimeState,
  resolveTurnScopeId,
  uniqueValues,
} from "./anchor-utils.js";
import { pruneSessionTurnTimings } from "./turn-timing.js";
import {
  appendCommandReceipt,
  assertTurnReplacementMaterialization,
  createMessageDeleteFingerprint,
  createTurnReplaceFingerprint,
  createTurnReplacementCommit,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  normalizeExpectedAggregateVersion,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { commitTurnDeletion, commitTurnReplacement } from "@noobot/authoritative-state/application";
import {
  removeAuthorityOutboxTurnScopes,
  withAuthorityOutboxMutation,
} from "../../authority-outbox-store/outbox-journal.js";
import { requireOutboxSessionDir } from "./outbox-scope.js";

function assertIdempotencyDecision(decision) {
  if (decision.allowed) return;
  const error = new Error("commandId was reused with a different request");
  error.statusCode = 409;
  error.code = SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED;
  throw error;
}

function assertConcurrencyDecision(decision) {
  if (decision.allowed) return;
  const error = new Error("session aggregate version conflict");
  error.statusCode = 409;
  error.code = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
  error.currentVersion = decision.aggregateVersion;
  throw error;
}

async function prepareSessionCommand({
  userId,
  sessionId,
  parentSessionId,
  persistenceContext,
  commandId,
  type,
  requestHash,
  expectedAggregateVersion,
  matcher,
}) {
  const { session, resolvedParentSessionId } = await this._findSession(
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!session) {
    const error = new Error("session not found");
    error.statusCode = 404;
    throw error;
  }
  const idempotency = decideCommandIdempotency({
    commandId,
    type,
    requestHash,
    receipts: session.turnLifecycle.commandReceipts,
  });
  assertIdempotencyDecision(idempotency);
  if (idempotency.deduplicated) {
    return {
      deduplicatedResult: createCommandResult({
        session,
        receiptResult: idempotency.receipt.result,
        commandId,
        committedAggregateVersion: idempotency.receipt.aggregateVersion,
        removedAuthorityOutboxEvents: 0,
        deduplicated: true,
      }),
    };
  }
  const currentVersion = resolveAggregateVersion(session);
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion,
    aggregateVersion: currentVersion,
  });
  assertConcurrencyDecision(concurrency);
  const anchorIndex = session.messages.findIndex((messageItem) => matcher(messageItem));
  if (anchorIndex < 0) {
    const error = new Error("message anchor not found");
    error.statusCode = 404;
    throw error;
  }
  return {
    session,
    resolvedParentSessionId,
    currentVersion,
    nextAggregateVersion: concurrency.nextAggregateVersion,
    messages: session.messages,
    anchorIndex,
  };
}

async function removeOutboxTurnScopes({
  userId,
  sessionId,
  resolvedParentSessionId,
  persistenceContext,
  removedTurnScopeIds,
}) {
  if (!removedTurnScopeIds.length) return 0;
  const sessionDir = await requireOutboxSessionDir(
    this,
    userId,
    sessionId,
    resolvedParentSessionId,
    persistenceContext,
  );
  return withAuthorityOutboxMutation(sessionDir, () =>
    removeAuthorityOutboxTurnScopes(sessionDir, removedTurnScopeIds),
  );
}

function createCommandResult({
  session,
  receiptResult,
  commandId,
  committedAggregateVersion,
  removedAuthorityOutboxEvents,
  deduplicated,
}) {
  return {
    session,
    ...receiptResult,
    aggregateVersion: resolveAggregateVersion(session),
    committedAggregateVersion,
    commandId,
    removedAuthorityOutboxEvents,
    deduplicated,
  };
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeAnchoredCommandRequest({ userId, sessionId, anchor, commandId }) {
  if (!userId || !sessionId) throw badRequest("userId and sessionId are required");
  const matcher = createMessageAnchorMatcher(anchor);
  if (!matcher) throw badRequest("message anchor is required");
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) throw badRequest("commandId is required");
  return { matcher, normalizedCommandId };
}

function buildReplacementUserMessage(replacedUserMessage, fields, nowValue) {
  const replacementBaseMessage = clearReplacementUserRuntimeState(replacedUserMessage);
  for (const key of ["turnId", "turn_id", "messageId", "message_id", "id", "messageUid"]) {
    delete replacementBaseMessage[key];
  }
  const nextAttachments = normalizeIncomingAttachmentsForSessionMessage(fields.attachments);
  return normalizeMessageEntity(
    {
      ...replacementBaseMessage,
      messageUid: createSessionMessageUid(),
      role: "user",
      type: "message",
      content: fields.content,
      turnScopeId: fields.turnScopeId,
      dialogProcessId: fields.dialogProcessId,
      pending: false,
      error: false,
      done: true,
      ts: nowValue,
      ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
    },
    () => nowValue,
  );
}

export async function deleteFromMessage({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  anchor = {},
  expectedAggregateVersion = null,
  commandId = "",
} = {}) {
  const { matcher, normalizedCommandId } = normalizeAnchoredCommandRequest({
    userId,
    sessionId,
    anchor,
    commandId,
  });
  const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
  const requestHash = createMessageDeleteFingerprint({ anchor });
  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const prepared = await prepareSessionCommand.call(this, {
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
        commandId: normalizedCommandId,
        type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
        requestHash,
        expectedAggregateVersion: normalizedExpectedVersion,
        matcher,
      });
      if (prepared.deduplicatedResult) return prepared.deduplicatedResult;
      const {
        session,
        resolvedParentSessionId,
        currentVersion,
        nextAggregateVersion,
        messages,
        anchorIndex,
      } = prepared;
      const deletedMessages = messages.slice(anchorIndex);
      const deletedCount = deletedMessages.length;
      const deletedTurnScopeIds = uniqueValues(deletedMessages.map(resolveTurnScopeId));
      const lifecycleDeletion = commitTurnDeletion({
        lifecycle: session.turnLifecycle,
        turnScopeIds: deletedTurnScopeIds,
      });

      session.messages = messages.slice(0, anchorIndex);
      pruneSessionTurnTimings(session);
      session.updatedAt = this.now();
      session.aggregateVersion = nextAggregateVersion;
      session.turnLifecycle = lifecycleDeletion.lifecycle;

      const result = { deletedCount, anchorIndex, deletedTurnScopeIds };
      session.turnLifecycle.commandReceipts = appendCommandReceipt(
        session.turnLifecycle.commandReceipts,
        {
          type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
          commandId: normalizedCommandId,
          aggregateVersion: session.aggregateVersion,
          requestHash,
          result,
          committedAt: this.now(),
        },
      );
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      const removedAuthorityOutboxEvents = await removeOutboxTurnScopes.call(this, {
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
        removedTurnScopeIds: lifecycleDeletion.removedTurnScopeIds,
      });
      return createCommandResult({
        session,
        receiptResult: result,
        commandId: normalizedCommandId,
        committedAggregateVersion: session.aggregateVersion,
        removedAuthorityOutboxEvents,
        deduplicated: false,
      });
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function replaceTurn({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  anchor = {},
  newContent = "",
  turnScopeId = "",
  expectedAggregateVersion = null,
  commandId = "",
  attachments = undefined,
} = {}) {
  const normalizedNewContent = String(newContent || "").trim();
  if (!normalizedNewContent) throw badRequest("newContent is required");
  const { matcher, normalizedCommandId } = normalizeAnchoredCommandRequest({
    userId,
    sessionId,
    anchor,
    commandId,
  });
  const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  if (!normalizedTurnScopeId) throw badRequest("turnScopeId is required");
  const requestHash = createTurnReplaceFingerprint({
    anchor,
    newContent: normalizedNewContent,
    turnScopeId: normalizedTurnScopeId,
    attachments,
  });
  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const prepared = await prepareSessionCommand.call(this, {
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
        commandId: normalizedCommandId,
        type: SESSION_COMMAND.TURN_REPLACE,
        requestHash,
        expectedAggregateVersion: normalizedExpectedVersion,
        matcher,
      });
      if (prepared.deduplicatedResult) return prepared.deduplicatedResult;
      const {
        session,
        resolvedParentSessionId,
        currentVersion,
        nextAggregateVersion,
        messages,
        anchorIndex,
      } = prepared;
      const turnStartIndex = resolveUserTurnStartIndex(messages, anchorIndex);
      const replacedMessages = messages.slice(turnStartIndex);
      const nowValue = this.now();
      const replacementDialogProcessId = String(this.allocateDialogProcessId()).trim();
      if (!replacementDialogProcessId)
        throw new TypeError("allocated replacement dialogProcessId is empty");
      const newMessage = buildReplacementUserMessage(
        messages[turnStartIndex],
        {
          content: normalizedNewContent,
          turnScopeId: normalizedTurnScopeId,
          dialogProcessId: replacementDialogProcessId,
          attachments,
        },
        nowValue,
      );
      session.messages = [...messages.slice(0, turnStartIndex), newMessage];
      pruneSessionTurnTimings(session);
      session.updatedAt = nowValue;
      session.aggregateVersion = nextAggregateVersion;

      const replacementUserMessageId = String(newMessage.messageId || "").trim();
      const turnReplacement = createTurnReplacementCommit({
        commandId: normalizedCommandId,
        sessionId,
        committedAggregateVersion: session.aggregateVersion,
        replacedTurnScopeIds: uniqueValues(replacedMessages.map(resolveTurnScopeId)),
        replacementDialogProcessId,
        replacementTurnScopeId: normalizedTurnScopeId,
        replacementUserMessageId,
        requestHash,
        committedAt: nowValue,
      });
      const lifecycleReplacement = commitTurnReplacement({
        lifecycle: session.turnLifecycle,
        replacement: turnReplacement,
      });
      if (!lifecycleReplacement.applied && !lifecycleReplacement.deduplicated) {
        throw new Error(`turn replacement lifecycle commit failed: ${lifecycleReplacement.reason}`);
      }
      session.turnLifecycle = lifecycleReplacement.lifecycle;
      const result = { turnReplacement };
      session.turnLifecycle.commandReceipts = appendCommandReceipt(
        session.turnLifecycle.commandReceipts,
        {
          type: SESSION_COMMAND.TURN_REPLACE,
          commandId: normalizedCommandId,
          aggregateVersion: session.aggregateVersion,
          requestHash,
          result,
          committedAt: nowValue,
        },
      );
      assertTurnReplacementMaterialization({ commit: turnReplacement, session });
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      const removedAuthorityOutboxEvents = await removeOutboxTurnScopes.call(this, {
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
        removedTurnScopeIds: lifecycleReplacement.removedTurnScopeIds,
      });
      return createCommandResult({
        session,
        receiptResult: result,
        commandId: normalizedCommandId,
        committedAggregateVersion: session.aggregateVersion,
        removedAuthorityOutboxEvents,
        deduplicated: false,
      });
    },
    parentSessionId,
    persistenceContext,
  );
}
