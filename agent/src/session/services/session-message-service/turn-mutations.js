/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
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
import { commitTurnReplacement } from "@noobot/authoritative-state/application";

function assertIdempotencyDecision(decision) {
  if (decision.allowed) return;
  const error = new Error("commandId was reused with a different request");
  error.statusCode = 409;
  error.errorCode = SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED;
  throw error;
}

function assertConcurrencyDecision(decision) {
  if (decision.allowed) return;
  const error = new Error("session aggregate version conflict");
  error.statusCode = 409;
  error.errorCode = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
  error.currentVersion = decision.aggregateVersion;
  throw error;
}

export async function deleteFromMessage({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
  anchor = {},
  expectedAggregateVersion = null,
  commandId = "",
  attachments = undefined,
} = {}) {
  if (!userId || !sessionId) {
    const error = new Error("userId and sessionId are required");
    error.statusCode = 400;
    throw error;
  }
  const matcher = createMessageAnchorMatcher(anchor);
  const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
  if (!matcher) {
    const error = new Error("message anchor is required");
    error.statusCode = 400;
    throw error;
  }
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) {
    const error = new Error("commandId is required");
    error.statusCode = 400;
    throw error;
  }
  const requestHash = createMessageDeleteFingerprint({ anchor });
  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      if (!session) {
        const error = new Error("session not found");
        error.statusCode = 404;
        throw error;
      }
      const idempotency = decideCommandIdempotency({
        commandId: normalizedCommandId,
        type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
        requestHash,
        receipts: session.turnLifecycle.commandReceipts,
      });
      assertIdempotencyDecision(idempotency);
      if (idempotency.deduplicated) {
        return {
          session,
          ...idempotency.receipt.result,
          aggregateVersion: resolveAggregateVersion(session),
          committedAggregateVersion: idempotency.receipt.aggregateVersion,
          commandId: normalizedCommandId,
          deduplicated: true,
        };
      }
      const currentVersion = resolveAggregateVersion(session);
      const concurrency = decideAggregateConcurrency({
        expectedAggregateVersion: normalizedExpectedVersion,
        aggregateVersion: currentVersion,
      });
      assertConcurrencyDecision(concurrency);
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const anchorIndex = messages.findIndex((messageItem) => matcher(messageItem));
      if (anchorIndex < 0) {
        const error = new Error("message anchor not found");
        error.statusCode = 404;
        throw error;
      }
      const deletedMessages = messages.slice(anchorIndex);
      const deletedCount = deletedMessages.length;
      const deletedTurnScopeIds = uniqueValues(deletedMessages.map(resolveTurnScopeId));
      session.messages = messages.slice(0, anchorIndex);
      pruneSessionTurnTimings(session);
      session.updatedAt = this.now();
      session.aggregateVersion = concurrency.nextAggregateVersion;

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
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      return {
        session,
        ...result,
        aggregateVersion: session.aggregateVersion,
        commandId: normalizedCommandId,
        deduplicated: false,
      };
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
  if (!userId || !sessionId) {
    const error = new Error("userId and sessionId are required");
    error.statusCode = 400;
    throw error;
  }
  const normalizedNewContent = String(newContent || "").trim();
  if (!normalizedNewContent) {
    const error = new Error("newContent is required");
    error.statusCode = 400;
    throw error;
  }
  const matcher = createMessageAnchorMatcher(anchor);
  const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
  if (!matcher) {
    const error = new Error("message anchor is required");
    error.statusCode = 400;
    throw error;
  }
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  if (!normalizedTurnScopeId) {
    const error = new Error("turnScopeId is required");
    error.statusCode = 400;
    throw error;
  }
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) {
    const error = new Error("commandId is required");
    error.statusCode = 400;
    throw error;
  }
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
      const resolvedParentSessionId = await this._resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      if (!session) {
        const error = new Error("session not found");
        error.statusCode = 404;
        throw error;
      }
      const idempotency = decideCommandIdempotency({
        commandId: normalizedCommandId,
        type: SESSION_COMMAND.TURN_REPLACE,
        requestHash,
        receipts: session.turnLifecycle.commandReceipts,
      });
      assertIdempotencyDecision(idempotency);
      if (idempotency.deduplicated) {
        return { session, ...idempotency.receipt.result, deduplicated: true };
      }
      const currentVersion = resolveAggregateVersion(session);
      const concurrency = decideAggregateConcurrency({
        expectedAggregateVersion: normalizedExpectedVersion,
        aggregateVersion: currentVersion,
      });
      assertConcurrencyDecision(concurrency);
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const anchorIndex = messages.findIndex((messageItem) => matcher(messageItem));
      if (anchorIndex < 0) {
        const error = new Error("message anchor not found");
        error.statusCode = 404;
        throw error;
      }
      const turnStartIndex = resolveUserTurnStartIndex(messages, anchorIndex);
      const replacedMessages = messages.slice(turnStartIndex);
      const replacedUserMessage = messages[turnStartIndex] || messages[anchorIndex] || {};
      const nextVersion = concurrency.nextAggregateVersion;
      const nowValue = this.now();
      if (typeof this.allocateDialogProcessId !== "function") {
        throw new TypeError(
          "SessionMessageService requires allocateDialogProcessId for Turn replacement",
        );
      }
      const replacementDialogProcessId = String(this.allocateDialogProcessId()).trim();
      if (!replacementDialogProcessId)
        throw new TypeError("allocated replacement dialogProcessId is empty");
      const replacementBaseMessage = clearReplacementUserRuntimeState(replacedUserMessage || {});
      delete replacementBaseMessage.turnId;
      delete replacementBaseMessage.turn_id;
      delete replacementBaseMessage.messageId;
      delete replacementBaseMessage.message_id;
      delete replacementBaseMessage.id;
      delete replacementBaseMessage.messageUid;
      const nextAttachments = normalizeIncomingAttachmentsForSessionMessage(
        replacedUserMessage?.attachments,
        attachments,
      );
      const newMessage = normalizeMessageEntity(
        {
          ...replacementBaseMessage,
          messageUid: createSessionMessageUid(),
          role: "user",
          type: "message",
          content: normalizedNewContent,
          turnScopeId: normalizedTurnScopeId,
          dialogProcessId: replacementDialogProcessId,
          pending: false,
          error: false,
          done: true,
          ts: nowValue,
          ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
        },
        () => nowValue,
      );
      session.messages = [...messages.slice(0, turnStartIndex), newMessage];
      pruneSessionTurnTimings(session);
      session.updatedAt = nowValue;
      session.aggregateVersion = nextVersion;

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
        eventOutbox: session.authorityEventOutbox,
        replacement: turnReplacement,
      });
      if (!lifecycleReplacement.applied && !lifecycleReplacement.deduplicated) {
        throw new Error(`turn replacement lifecycle commit failed: ${lifecycleReplacement.reason}`);
      }
      session.turnLifecycle = lifecycleReplacement.lifecycle;
      session.authorityEventOutbox = lifecycleReplacement.eventOutbox;
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
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      assertTurnReplacementMaterialization({ commit: turnReplacement, session });
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      return { session, ...result, deduplicated: false };
    },
    parentSessionId,
    persistenceContext,
  );
}
