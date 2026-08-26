/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
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
} from "@noobot/session-protocol";

export async function commitTurn(payload = {}) {
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
    content = "",
    action = "send",
    turnScopeId = "",
    dialogProcessId = "",
    parentDialogProcessId = "",
    expectedAggregateVersion = null,
    commandId = "",
    messageId = "",
    resumeDialogProcessId = "",
    resumeTurnScopeId = "",
    messageOrigin = "natural",
    userMetaMaterialized = false,
    persistenceContext = null,
  } = payload;
  if (!userId || !sessionId) {
    const error = new Error("userId and sessionId are required");
    error.statusCode = 400;
    throw error;
  }
  const normalizedContent = String(content || "").trim();
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedAction =
    String(action || "send")
      .trim()
      .toLowerCase() === "continue"
      ? "continue"
      : "send";
  const normalizedCommandId = String(commandId || normalizedTurnScopeId).trim();
  const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
  const requestHash = createTurnCommitFingerprint({
    action: normalizedAction,
    content: normalizedContent,
    turnScopeId: normalizedTurnScopeId,
    resumeDialogProcessId: String(resumeDialogProcessId || "").trim(),
    resumeTurnScopeId: String(resumeTurnScopeId || "").trim(),
  });
  if (!normalizedContent || !normalizedTurnScopeId || !normalizedCommandId) {
    const error = new Error("content, turnScopeId and commandId are required");
    error.statusCode = 400;
    throw error;
  }
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
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const lifecycle = session.turnLifecycle;
      const idempotency = decideCommandIdempotency({
        commandId: normalizedCommandId,
        type: SESSION_COMMAND.TURN_COMMIT,
        requestHash,
        receipts: lifecycle.commandReceipts,
      });
      if (!idempotency.allowed) {
        const error = new Error("commandId was reused with a different request");
        error.statusCode = 409;
        error.errorCode = SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED;
        throw error;
      }
      if (idempotency.deduplicated) {
        const existing = messages.find(
          (item) =>
            String(item?.messageUid || "").trim() ===
            String(idempotency.receipt?.result?.messageUid || "").trim(),
        );
        if (!existing) throw new TypeError("turn commit receipt materialization is missing");
        return {
          session,
          userMessage: existing,
          attachments: [],
          aggregateVersion: resolveAggregateVersion(session),
          deduplicated: true,
          turnScopeId: normalizedTurnScopeId,
          dialogProcessId: resolveContextMessageDialogProcessId(existing),
          runState: String(idempotency.receipt?.result?.runState || "pending_start"),
        };
      }
      const currentVersion = resolveAggregateVersion(session);
      const concurrency = decideAggregateConcurrency({
        expectedAggregateVersion: normalizedExpectedVersion,
        aggregateVersion: currentVersion,
      });
      if (!concurrency.allowed) {
        const error = new Error("session aggregate version conflict");
        error.statusCode = 409;
        error.errorCode = SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT;
        error.currentVersion = currentVersion;
        throw error;
      }
      const resumeDialog = String(resumeDialogProcessId || "").trim();
      const resumeScope = String(resumeTurnScopeId || "").trim();
      if (normalizedAction === "continue") {
        const continuation = decideMaterializedTurnContinuation({
          lifecycle,
          turnScopeId: normalizedTurnScopeId,
          source: { turnScopeId: resumeScope, dialogProcessId: resumeDialog },
        });
        if (!continuation.allowed) {
          const error = new Error("continue command does not match authoritative Turn relation");
          error.statusCode = 409;
          error.errorCode = SESSION_ERROR_CODE.CONTINUE_AUTHORITY_MISMATCH;
          error.reason = continuation.reason;
          throw error;
        }
      }
      const nowValue = this.now();
      const userMessage = normalizeMessageEntity(
        {
          messageUid: createSessionMessageUid(),
          messageId: String(messageId || "").trim(),
          role: "user",
          type: "message",
          content: normalizedContent,
          userName: String(userId),
          sessionId,
          parentSessionId: resolvedParentSessionId,
          dialogProcessId: String(dialogProcessId || "").trim(),
          parentDialogProcessId: String(parentDialogProcessId || "").trim(),
          turnScopeId: normalizedTurnScopeId,
          messageOrigin: String(messageOrigin || "")
            .trim()
            .toLowerCase(),
          userMetaMaterialized: userMetaMaterialized === true,
          attachments: [],
          turnCommit: {
            action: normalizedAction,
            commandId: normalizedCommandId,
            requestHash,
            runState: "pending_start",
            ...(normalizedAction === "continue"
              ? {
                  resumeDialogProcessId: String(resumeDialogProcessId).trim(),
                  resumeTurnScopeId: String(resumeTurnScopeId).trim(),
                }
              : {}),
          },
          ts: nowValue,
        },
        () => nowValue,
      );
      session.messages = [...messages, userMessage];
      session.dialogOrder = appendDialogOrderEntry(session.dialogOrder, userMessage);
      session.aggregateVersion = concurrency.nextAggregateVersion;
      session.turnLifecycle.commandReceipts = appendCommandReceipt(
        session.turnLifecycle.commandReceipts,
        {
          commandId: normalizedCommandId,
          type: SESSION_COMMAND.TURN_COMMIT,
          turnScopeId: normalizedTurnScopeId,
          requestHash,
          aggregateVersion: session.aggregateVersion,
          result: { messageUid: userMessage.messageUid, runState: "pending_start" },
          committedAt: nowValue,
        },
      );
      session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, {
        expectedAggregateVersion: currentVersion,
        persistenceContext,
      });
      const savedSession =
        (await this.sessionRepo.findById(
          userId,
          sessionId,
          resolvedParentSessionId,
          persistenceContext,
        )) || session;
      const savedMessage =
        (savedSession.messages || []).find(
          (item) =>
            item?.role === "user" && String(item?.turnScopeId || "") === normalizedTurnScopeId,
        ) || userMessage;
      return {
        session: savedSession,
        userMessage: savedMessage,
        attachments: savedMessage.attachments || [],
        aggregateVersion: resolveAggregateVersion(savedSession),
        deduplicated: false,
        turnScopeId: normalizedTurnScopeId,
        dialogProcessId: resolveContextMessageDialogProcessId(savedMessage),
        runState: savedMessage?.turnCommit?.runState || "pending_start",
      };
    },
    parentSessionId,
    persistenceContext,
  );
}
