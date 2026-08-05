/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
import { resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { dedupeAttachments, assertCanonicalAttachments } from "./attachment-helpers.js";
import { resolveAggregateVersion } from "./anchor-utils.js";
import { createRequestHash, assertCommandRequestMatches, normalizeExpectedAggregateVersion } from "./idempotency-guards.js";
import { appendDialogOrderEntry } from "../../entities/dialog-order-entity.js";

export async function commitTurn({
    userId, sessionId, parentSessionId = "", content = "", action = "send",
    turnScopeId = "", dialogProcessId = "", parentDialogProcessId = "",
    attachments = [], expectedAggregateVersion = null, commandId = "",
    messageId = "",
    resumeDialogProcessId = "", resumeTurnScopeId = "",
    frontendUserMessage = true,
    persistenceContext = null,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required"); error.statusCode = 400; throw error;
    }
    const normalizedContent = String(content || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedAction = String(action || "send").trim().toLowerCase() === "continue" ? "continue" : "send";
    const normalizedCommandId = String(commandId || normalizedTurnScopeId).trim();
    const normalizedExpectedVersion = normalizeExpectedAggregateVersion(expectedAggregateVersion);
    const requestHash = createRequestHash({
      operation: normalizedAction,
      content: normalizedContent,
      turnScopeId: normalizedTurnScopeId,
      resumeDialogProcessId: String(resumeDialogProcessId || "").trim(),
      resumeTurnScopeId: String(resumeTurnScopeId || "").trim(),
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    if (!normalizedContent || !normalizedTurnScopeId || !normalizedCommandId) {
      const error = new Error("content, turnScopeId and commandId are required"); error.statusCode = 400; throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(userId, sessionId, parentSessionId, persistenceContext);
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext);
      if (!session) { const error = new Error("session not found"); error.statusCode = 404; throw error; }
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const existing = messages.find((item) =>
        item?.role === "user" && (String(item?.turnScopeId || "") === normalizedTurnScopeId ||
          String(item?.turnCommit?.commandId || "") === normalizedCommandId));
      if (existing) {
        assertCommandRequestMatches(existing?.turnCommit?.requestHash, requestHash);
        return { session, userMessage: existing, attachments: existing.attachments || [], aggregateVersion: resolveAggregateVersion(session), deduplicated: true, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(existing), runState: existing?.turnCommit?.runState || "pending_start" };
      }
      const currentVersion = resolveAggregateVersion(session);
      if (normalizedExpectedVersion !== null && normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session aggregate version conflict"); error.statusCode = 409; error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT"; error.currentVersion = currentVersion; throw error;
      }
      const resumeDialog = String(resumeDialogProcessId || "").trim();
      const resumeScope = String(resumeTurnScopeId || "").trim();
      if (normalizedAction === "continue") {
        const lifecycle = session.turnLifecycle && typeof session.turnLifecycle === "object"
          ? session.turnLifecycle
          : {};
        const sourceTurn = lifecycle.turns?.[resumeScope];
        const continuingTurn = lifecycle.turns?.[normalizedTurnScopeId];
        const continuationSource = continuingTurn?.continuationSource;
        const authorityMatches = Boolean(
          resumeDialog &&
          resumeScope &&
          sourceTurn?.state === "stop_completed" &&
          sourceTurn?.executionState === "user_stopped" &&
          sourceTurn?.dialogProcessId === resumeDialog &&
          sourceTurn?.continuedByTurnScopeId === normalizedTurnScopeId &&
          continuingTurn?.action === "continue" &&
          continuationSource?.turnScopeId === resumeScope &&
          continuationSource?.dialogProcessId === resumeDialog
        );
        if (!authorityMatches) {
          const error = new Error("continue command does not match authoritative Turn relation");
          error.statusCode = 409;
          error.errorCode = "CONTINUE_AUTHORITY_MISMATCH";
          throw error;
        }
      }
      const nowValue = this.now();
      assertCanonicalAttachments(attachments, sessionId);
      const canonicalAttachments = dedupeAttachments(Array.isArray(attachments) ? attachments : []);
      const userMessage = normalizeMessageEntity({
        messageUid: createSessionMessageUid(),
        messageId: String(messageId || "").trim(),
        role: "user", type: "message", content: normalizedContent,
        userName: String(userId), sessionId, parentSessionId: resolvedParentSessionId,
        dialogProcessId: String(dialogProcessId || "").trim(), parentDialogProcessId: String(parentDialogProcessId || "").trim(),
        turnScopeId: normalizedTurnScopeId,
        frontendUserMessage: frontendUserMessage === true,
        messageOrigin: frontendUserMessage === true ? "user" : "internal",
        attachments: canonicalAttachments,
        turnCommit: { action: normalizedAction, commandId: normalizedCommandId, requestHash, runState: "pending_start", ...(normalizedAction === "continue" ? { resumeDialogProcessId: String(resumeDialogProcessId).trim(), resumeTurnScopeId: String(resumeTurnScopeId).trim() } : {}) }, ts: nowValue,
      }, () => nowValue);
      session.messages = [...messages, userMessage];
      session.dialogOrder = appendDialogOrderEntry(session.dialogOrder, userMessage);
      session.aggregateVersion = currentVersion + 1;  session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedAggregateVersion: currentVersion, persistenceContext });
      const savedSession = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId, persistenceContext) || session;
      const savedMessage = (savedSession.messages || []).find((item) => item?.role === "user" && String(item?.turnScopeId || "") === normalizedTurnScopeId) || userMessage;
      return { session: savedSession, userMessage: savedMessage, attachments: savedMessage.attachments || [], aggregateVersion: resolveAggregateVersion(savedSession), deduplicated: false, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(savedMessage), runState: savedMessage?.turnCommit?.runState || "pending_start" };
    }, parentSessionId, persistenceContext);
  }
