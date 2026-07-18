/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../../entities/session-entity.js";
import { resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { normalizeIncomingAttachmentsForSessionMessage } from "./attachment-helpers.js";
import { resolveSessionVersion, createMessageAnchorMatcher, resolveUserTurnStartIndex, clearReplacementUserRuntimeState } from "./anchor-utils.js";
import { createRequestHash, assertIdempotencyRequestMatches, findMutationReceipt, rememberMutationReceipt, normalizeExpectedVersion } from "./idempotency-guards.js";
import { pruneSessionTurnTimings, pruneSessionTurnStatuses, buildTurnScopeReplacement } from "./turn-timing.js";

export async function deleteFromMessage({
    userId,
    sessionId,
    parentSessionId = "",
    anchor = {},
    expectedVersion = null,
    idempotencyKey = "",
    attachments = undefined,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required");
      error.statusCode = 400;
      throw error;
    }
    const matcher = createMessageAnchorMatcher(anchor);
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const normalizedIdempotencyKey = String(idempotencyKey || "").trim();
    const requestHash = createRequestHash({ operation: "delete_from", anchor });
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) {
      const error = new Error("session not found");
      error.statusCode = 404;
      throw error;
    }
    const replay = findMutationReceipt(session, "delete_from", normalizedIdempotencyKey);
    if (replay) {
      assertIdempotencyRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, version: resolveSessionVersion(session), committedVersion: replay.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: true };
    }
    const currentVersion = resolveSessionVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_VERSION_CONFLICT";
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
    const deletedCount = messages.length - anchorIndex;
    session.messages = messages.slice(0, anchorIndex);
    pruneSessionTurnTimings(session);
    pruneSessionTurnStatuses(session);
    session.updatedAt = this.now();
    session.version = currentVersion + 1;
    session.revision = session.version;
    const result = { deletedCount, anchorIndex };
    if (normalizedIdempotencyKey) {
      rememberMutationReceipt(session, {
        operation: "delete_from",
        idempotencyKey: normalizedIdempotencyKey,
        version: session.version,
        requestHash,
        result,
        committedAt: this.now(),
      });
    }
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
    return { session, ...result, version: session.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: false };
    });
  }

export async function replaceTurn({
    userId,
    sessionId,
    parentSessionId = "",
    anchor = {},
    newContent = "",
    turnScopeId = "",
    expectedVersion = null,
    idempotencyKey = "",
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
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const normalizedIdempotencyKey = String(idempotencyKey || "").trim();
    const requestHash = createRequestHash({
      operation: "replace_turn",
      anchor,
      newContent: normalizedNewContent,
      turnScopeId: String(turnScopeId || "").trim(),
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) {
      const error = new Error("session not found");
      error.statusCode = 404;
      throw error;
    }
    const replay = findMutationReceipt(session, "replace_turn", normalizedIdempotencyKey);
    if (replay) {
      assertIdempotencyRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, version: resolveSessionVersion(session), committedVersion: replay.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: true };
    }
    const currentVersion = resolveSessionVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_VERSION_CONFLICT";
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
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedTurnScopeId) {
      const error = new Error("turnScopeId is required");
      error.statusCode = 400;
      throw error;
    }
    const nextVersion = currentVersion + 1;
    const nowValue = this.now();
    const replacementBaseMessage = clearReplacementUserRuntimeState(replacedUserMessage || {});
    delete replacementBaseMessage.turnId;
    delete replacementBaseMessage.turn_id;
    delete replacementBaseMessage.messageId;
    delete replacementBaseMessage.message_id;
    delete replacementBaseMessage.id;
    const nextAttachments = normalizeIncomingAttachmentsForSessionMessage(
      replacedUserMessage?.attachments,
      attachments,
    );
    const newMessage = normalizeMessageEntity({
      ...replacementBaseMessage,
      role: "user",
      type: "message",
      content: normalizedNewContent,
      turnScopeId: normalizedTurnScopeId,
      dialogProcessId: "",
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
    session.version = nextVersion;
    session.revision = nextVersion;
    const turnScopeReplacement = buildTurnScopeReplacement({
      replacedMessages,
      replacementMessages: [newMessage],
      replacementUserMessage: newMessage,
    });
    const result = {
      replacedTurn: {
        anchorIndex,
        turnStartIndex,
        deletedCount: replacedMessages.length,
        messages: replacedMessages,
      },
      newTurn: {
        turnScopeId: newMessage.turnScopeId || "",
        dialogProcessId: resolveMessageDialogProcessId(newMessage),
        message: newMessage,
      },
      turnScopeReplacement,
      anchorIndex,
      turnStartIndex,
      deletedCount: replacedMessages.length,
    };
    if (normalizedIdempotencyKey) {
      const receiptResult = {
        newTurn: result.newTurn,
        turnScopeReplacement,
        anchorIndex,
        turnStartIndex,
        deletedCount: replacedMessages.length,
      };
      rememberMutationReceipt(session, {
        operation: "replace_turn",
        idempotencyKey: normalizedIdempotencyKey,
        version: session.version,
        requestHash,
        result: receiptResult,
        committedAt: nowValue,
      });
    }
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
    return { session, ...result, version: session.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: false };
    });
  }
