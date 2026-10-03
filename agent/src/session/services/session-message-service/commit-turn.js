/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid } from "../../../context/session/message-uid.js";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { resolveAggregateVersion } from "./anchor-utils.js";
import { appendDialogOrderEntry } from "../../entities/dialog-order-entity.js";
import {
  appendCommandReceipt,
  createTurnCommitFingerprint,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  decideMaterializedTurnContinuation,
  normalizeExpectedAggregateVersion,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  TURN_COMMIT_ACTION,
  isTurnCommitContinuation,
  resolveTurnCommitAction,
} from "@noobot/session-protocol";

function createStatusError(message, statusCode, fields = {}) {
  return Object.assign(new Error(message), { statusCode, ...fields });
}

function trimText(value) {
  return String(value || "").trim();
}

const COMMIT_TURN_TEXT_FIELDS = [
  "content",
  "turnScopeId",
  "resumeDialogProcessId",
  "resumeTurnScopeId",
  "messageId",
  "dialogProcessId",
  "parentDialogProcessId",
];

function trimCommitTurnTextFields(payload) {
  return Object.fromEntries(COMMIT_TURN_TEXT_FIELDS.map((key) => [key, trimText(payload[key])]));
}

function normalizeCommitTurnRequest(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, "attachments")) {
    throw Object.assign(
      new TypeError("attachments must be bound with session.turn.attachments.bind"),
      { statusCode: 400 },
    );
  }
  const {
    userId,
    sessionId,
    parentSessionId = "",
    action = TURN_COMMIT_ACTION.SEND,
    expectedAggregateVersion = null,
    commandId = "",
    messageOrigin = "natural",
    userMetaMaterialized = false,
    persistenceContext = null,
  } = payload;
  if (!userId || !sessionId) throw createStatusError("userId and sessionId are required", 400);
  const request = {
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
    ...trimCommitTurnTextFields(payload),
    action: resolveTurnCommitAction(action),
    expectedAggregateVersion: normalizeExpectedAggregateVersion(expectedAggregateVersion),
    messageOrigin: trimText(messageOrigin).toLowerCase(),
    userMetaMaterialized: userMetaMaterialized === true,
  };
  request.commandId = String(commandId || request.turnScopeId).trim();
  request.requestHash = createTurnCommitFingerprint({
    action: request.action,
    content: request.content,
    turnScopeId: request.turnScopeId,
    resumeDialogProcessId: request.resumeDialogProcessId,
    resumeTurnScopeId: request.resumeTurnScopeId,
  });
  if (!request.content || !request.turnScopeId || !request.commandId) {
    throw createStatusError("content, turnScopeId and commandId are required", 400);
  }
  return request;
}

function buildCommitTurnResult(session, userMessage, request, { deduplicated, attachments }) {
  return {
    session,
    userMessage,
    attachments,
    aggregateVersion: resolveAggregateVersion(session),
    deduplicated,
    turnScopeId: request.turnScopeId,
    dialogProcessId: resolveContextMessageDialogProcessId(userMessage),
  };
}

function resolveDeduplicatedCommit(session, request) {
  const idempotency = decideCommandIdempotency({
    commandId: request.commandId,
    type: SESSION_COMMAND.TURN_COMMIT,
    requestHash: request.requestHash,
    receipts: session.turnLifecycle.commandReceipts,
  });
  if (!idempotency.allowed) {
    throw createStatusError("commandId was reused with a different request", 409, {
      code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
    });
  }
  if (!idempotency.deduplicated) return null;
  const receiptMessageUid = trimText(idempotency.receipt?.result?.messageUid);
  const existing = session.messages.find(
    (item) => trimText(item?.messageUid) === receiptMessageUid,
  );
  if (!existing) throw new TypeError("turn commit receipt materialization is missing");
  return buildCommitTurnResult(session, existing, request, {
    deduplicated: true,
    attachments: [],
  });
}

function assertCommitTurnAllowed(session, request) {
  const currentVersion = resolveAggregateVersion(session);
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion: request.expectedAggregateVersion,
    aggregateVersion: currentVersion,
  });
  if (!concurrency.allowed) {
    throw createStatusError("session aggregate version conflict", 409, {
      code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
      currentVersion,
    });
  }
  if (isTurnCommitContinuation(request.action)) {
    const continuation = decideMaterializedTurnContinuation({
      lifecycle: session.turnLifecycle,
      turnScopeId: request.turnScopeId,
      source: {
        turnScopeId: request.resumeTurnScopeId,
        dialogProcessId: request.resumeDialogProcessId,
      },
    });
    if (!continuation.allowed) {
      throw createStatusError("continue command does not match authoritative Turn relation", 409, {
        code: SESSION_ERROR_CODE.CONTINUE_AUTHORITY_MISMATCH,
        reason: continuation.reason,
      });
    }
  }
  return { currentVersion, nextAggregateVersion: concurrency.nextAggregateVersion };
}

function buildCommitUserMessage(request, resolvedParentSessionId, nowValue) {
  return normalizeMessageEntity(
    {
      messageUid: createSessionMessageUid(),
      messageId: request.messageId,
      role: "user",
      type: "message",
      content: request.content,
      userName: String(request.userId),
      sessionId: request.sessionId,
      parentSessionId: resolvedParentSessionId,
      dialogProcessId: request.dialogProcessId,
      parentDialogProcessId: request.parentDialogProcessId,
      turnScopeId: request.turnScopeId,
      messageOrigin: request.messageOrigin,
      userMetaMaterialized: request.userMetaMaterialized,
      attachments: [],
      turnCommit: {
        action: request.action,
        commandId: request.commandId,
        requestHash: request.requestHash,
        ...(isTurnCommitContinuation(request.action)
          ? {
              resumeDialogProcessId: request.resumeDialogProcessId,
              resumeTurnScopeId: request.resumeTurnScopeId,
            }
          : {}),
      },
      ts: nowValue,
    },
    () => nowValue,
  );
}

function applyCommittedTurn(session, request, userMessage, { nextAggregateVersion, nowValue }) {
  session.messages = [...session.messages, userMessage];
  session.dialogOrder = appendDialogOrderEntry(session.dialogOrder, userMessage);
  session.aggregateVersion = nextAggregateVersion;
  session.turnLifecycle.commandReceipts = appendCommandReceipt(
    session.turnLifecycle.commandReceipts,
    {
      commandId: request.commandId,
      type: SESSION_COMMAND.TURN_COMMIT,
      turnScopeId: request.turnScopeId,
      requestHash: request.requestHash,
      aggregateVersion: session.aggregateVersion,
      result: { messageUid: userMessage.messageUid },
      committedAt: nowValue,
    },
  );
  session.updatedAt = nowValue;
}

async function saveAndReloadCommittedTurn(service, session, request, context) {
  const { userId, sessionId, persistenceContext } = request;
  await service.sessionRepo.save(userId, session, context.resolvedParentSessionId, {
    expectedAggregateVersion: context.currentVersion,
    persistenceContext,
  });
  const savedSession = await service.sessionRepo.findById(
    userId,
    sessionId,
    context.resolvedParentSessionId,
    persistenceContext,
  );
  if (!savedSession) throw new TypeError("committed session could not be reloaded");
  const savedMessage = savedSession.messages.find(
    (item) => item?.role === "user" && trimText(item?.turnScopeId) === request.turnScopeId,
  );
  if (!savedMessage) throw new TypeError("committed user message could not be reloaded");
  return buildCommitTurnResult(savedSession, savedMessage, request, {
    deduplicated: false,
    attachments: savedMessage.attachments || [],
  });
}

export async function commitTurn(payload = {}) {
  const request = normalizeCommitTurnRequest(payload);
  const { userId, sessionId, parentSessionId, persistenceContext } = request;
  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const { session, resolvedParentSessionId } = await this._findSession(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      if (!session) throw createStatusError("session not found", 404);
      const deduplicated = resolveDeduplicatedCommit(session, request);
      if (deduplicated) return deduplicated;
      const { currentVersion, nextAggregateVersion } = assertCommitTurnAllowed(session, request);
      const nowValue = this.now();
      const userMessage = buildCommitUserMessage(request, resolvedParentSessionId, nowValue);
      applyCommittedTurn(session, request, userMessage, { nextAggregateVersion, nowValue });
      return saveAndReloadCommittedTurn(this, session, request, {
        resolvedParentSessionId,
        currentVersion,
      });
    },
    parentSessionId,
    persistenceContext,
  );
}
