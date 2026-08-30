/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  appendCommandReceipt,
  createTurnAttachmentBindFingerprint,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  normalizeExpectedAggregateVersion,
} from "@noobot/session-protocol";
import { assertCanonicalAttachments, dedupeAttachments } from "./attachment-helpers.js";
import { resolveAggregateVersion } from "./anchor-utils.js";

const text = (value) => String(value || "").trim();

function prepareAttachmentBinding({
  userId,
  sessionId,
  turnScopeId,
  messageUid,
  commandId,
  attachments,
  expectedAggregateVersion,
}) {
  const identity = {
    userId: text(userId),
    sessionId: text(sessionId),
    turnScopeId: text(turnScopeId),
    messageUid: text(messageUid),
    commandId: text(commandId),
  };
  if (Object.values(identity).some((value) => !value)) {
    throw Object.assign(new TypeError("attachment binding identity is incomplete"), {
      statusCode: 400,
    });
  }
  assertCanonicalAttachments(attachments, identity.sessionId);
  const canonicalAttachments = dedupeAttachments(attachments);
  if (canonicalAttachments.length === 0) {
    throw Object.assign(new TypeError("attachment binding requires at least one attachment"), {
      statusCode: 400,
      errorCode: "INVALID_CANONICAL_ATTACHMENT",
    });
  }
  return {
    identity,
    canonicalAttachments,
    normalizedExpectedVersion: normalizeExpectedAggregateVersion(expectedAggregateVersion),
    requestHash: createTurnAttachmentBindFingerprint({
      turnScopeId: identity.turnScopeId,
      messageUid: identity.messageUid,
      attachments: canonicalAttachments,
    }),
  };
}

export async function bindTurnAttachments({
  userId,
  sessionId,
  parentSessionId = "",
  turnScopeId = "",
  messageUid = "",
  attachments = [],
  expectedAggregateVersion = null,
  commandId = "",
  persistenceContext = null,
} = {}) {
  const { identity, canonicalAttachments, normalizedExpectedVersion, requestHash } =
    prepareAttachmentBinding({
      userId,
      sessionId,
      turnScopeId,
      messageUid,
      commandId,
      attachments,
      expectedAggregateVersion,
    });
  return this._withSessionMutation(
    identity.userId,
    identity.sessionId,
    async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        identity.userId,
        identity.sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(
        identity.userId,
        identity.sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      if (!session) throw Object.assign(new Error("session not found"), { statusCode: 404 });
      const idempotency = decideCommandIdempotency({
        commandId: identity.commandId,
        type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
        requestHash,
        receipts: session.turnLifecycle.commandReceipts,
      });
      if (!idempotency.allowed) {
        throw Object.assign(new Error("commandId was reused with a different request"), {
          statusCode: 409,
          errorCode: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
        });
      }
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const messageIndex = messages.findIndex(
        (message) =>
          text(message?.messageUid) === identity.messageUid &&
          text(message?.turnScopeId) === identity.turnScopeId &&
          text(message?.role).toLowerCase() === "user",
      );
      if (messageIndex < 0) {
        throw Object.assign(new Error("Turn user message not found"), { statusCode: 404 });
      }
      if (idempotency.deduplicated) {
        return {
          session,
          userMessage: messages[messageIndex],
          attachments: messages[messageIndex].attachments || [],
          aggregateVersion: resolveAggregateVersion(session),
          deduplicated: true,
        };
      }
      const existingBinding = session.turnLifecycle.commandReceipts.find(
        (receipt) =>
          text(receipt?.type) === SESSION_COMMAND.TURN_ATTACHMENTS_BIND &&
          text(receipt?.result?.messageUid) === identity.messageUid,
      );
      if (existingBinding) {
        throw Object.assign(new Error("Turn attachments are already bound"), {
          statusCode: 409,
          errorCode: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
        });
      }
      const currentVersion = resolveAggregateVersion(session);
      const concurrency = decideAggregateConcurrency({
        expectedAggregateVersion: normalizedExpectedVersion,
        aggregateVersion: currentVersion,
      });
      if (!concurrency.allowed) {
        throw Object.assign(new Error("session aggregate version conflict"), {
          statusCode: 409,
          errorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion,
        });
      }
      const currentMessage = messages[messageIndex];
      if (Array.isArray(currentMessage.attachments) && currentMessage.attachments.length > 0) {
        throw Object.assign(new Error("Turn attachments are already bound"), {
          statusCode: 409,
          errorCode: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
        });
      }
      const userMessage = { ...currentMessage, attachments: canonicalAttachments };
      session.messages = messages.map((message, index) =>
        index === messageIndex ? userMessage : message,
      );
      session.aggregateVersion = concurrency.nextAggregateVersion;
      session.turnLifecycle.commandReceipts = appendCommandReceipt(
        session.turnLifecycle.commandReceipts,
        {
          commandId: identity.commandId,
          type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
          turnScopeId: identity.turnScopeId,
          requestHash,
          aggregateVersion: session.aggregateVersion,
          result: { messageUid: identity.messageUid },
          committedAt: this.now(),
        },
      );
      session.updatedAt = this.now();
      await this.sessionRepo.save(identity.userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      const savedSession =
        (await this.sessionRepo.findById(
          identity.userId,
          identity.sessionId,
          resolvedParentSessionId,
          persistenceContext,
        )) || session;
      const savedMessage = (savedSession.messages || []).find(
        (message) => text(message?.messageUid) === identity.messageUid,
      );
      if (!savedMessage) throw new TypeError("attachment binding materialization is missing");
      return {
        session: savedSession,
        userMessage: savedMessage,
        attachments: savedMessage.attachments || [],
        aggregateVersion: resolveAggregateVersion(savedSession),
        deduplicated: false,
      };
    },
    parentSessionId,
    persistenceContext,
  );
}
