/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
import { normalizeIncomingAttachmentsForSessionMessage } from "./attachment-helpers.js";
import { resolveAggregateVersion, createMessageAnchorMatcher, resolveUserTurnStartIndex, clearReplacementUserRuntimeState, resolveTurnScopeId, uniqueValues } from "./anchor-utils.js";
import { createRequestHash, assertCommandRequestMatches, findMutationReceipt, rememberMutationReceipt, normalizeExpectedAggregateVersion } from "./idempotency-guards.js";
import { pruneSessionTurnTimings, pruneSessionTurnStatuses } from "./turn-timing.js";
import {
  assertTurnReplacementMaterialization,
  createTurnReplacementCommit,
} from "@noobot/session-protocol";
import { commitTurnReplacement } from "@noobot/authoritative-state/application";
import { randomUUID } from "node:crypto";

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
    const requestHash = createRequestHash({ operation: "delete_from", anchor });
    return this._withSessionMutation(userId, sessionId, async () => {
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
    const replay = findMutationReceipt(session, "delete_from", normalizedCommandId);
    if (replay) {
      assertCommandRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, aggregateVersion: resolveAggregateVersion(session), committedAggregateVersion: replay.aggregateVersion, commandId: normalizedCommandId, deduplicated: true };
    }
    const currentVersion = resolveAggregateVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session aggregate version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT";
        error.currentVersion = currentVersion;
        throw error;
      }
    }
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
    pruneSessionTurnStatuses(session);
    session.updatedAt = this.now();
    session.aggregateVersion = currentVersion + 1;

    const result = { deletedCount, anchorIndex, deletedTurnScopeIds };
    if (normalizedCommandId) {
      rememberMutationReceipt(session, {
        operation: "delete_from",
        commandId: normalizedCommandId,
        aggregateVersion: session.aggregateVersion,
        requestHash,
        result,
        committedAt: this.now(),
      });
    }
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedAggregateVersion: currentVersion, persistenceContext });
    return { session, ...result, aggregateVersion: session.aggregateVersion, commandId: normalizedCommandId, deduplicated: false };
    }, parentSessionId, persistenceContext);
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
    const requestHash = createRequestHash({
      operation: "replace_turn",
      anchor,
      newContent: normalizedNewContent,
      turnScopeId: normalizedTurnScopeId,
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    return this._withSessionMutation(userId, sessionId, async () => {
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
    const replay = findMutationReceipt(session, "replace_turn", normalizedCommandId);
    if (replay) {
      assertCommandRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, deduplicated: true };
    }
    const currentVersion = resolveAggregateVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session aggregate version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT";
        error.currentVersion = currentVersion;
        throw error;
      }
    }
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
    const nextVersion = currentVersion + 1;
    const nowValue = this.now();
    const replacementDialogProcessId = randomUUID();
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
    const newMessage = normalizeMessageEntity({
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
    }, () => nowValue);
    session.messages = [...messages.slice(0, turnStartIndex), newMessage];
    pruneSessionTurnTimings(session);
    pruneSessionTurnStatuses(session);
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
    rememberMutationReceipt(session, {
      operation: "replace_turn",
      commandId: normalizedCommandId,
      aggregateVersion: session.aggregateVersion,
      requestHash,
      result,
      committedAt: nowValue,
    });
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    assertTurnReplacementMaterialization({ commit: turnReplacement, session });
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedAggregateVersion: currentVersion, persistenceContext });
    return { session, ...result, deduplicated: false };
    }, parentSessionId, persistenceContext);
  }
