/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../../entities/session-entity.js";
import { isSameTurnStatus } from "../../entities/turn-status-entity.js";
import { resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { dedupeAttachments, assertCanonicalAttachments } from "./attachment-helpers.js";
import { resolveSessionVersion } from "./anchor-utils.js";
import { createRequestHash, assertIdempotencyRequestMatches, normalizeExpectedVersion } from "./idempotency-guards.js";

export async function commitTurn({
    userId, sessionId, parentSessionId = "", content = "", action = "send",
    turnScopeId = "", dialogProcessId = "", parentDialogProcessId = "",
    attachments = [], expectedVersion = null, idempotencyKey = "",
    resumeDialogProcessId = "", resumeTurnScopeId = "",
    frontendUserMessage = true,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required"); error.statusCode = 400; throw error;
    }
    const normalizedContent = String(content || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedAction = String(action || "send").trim().toLowerCase() === "continue" ? "continue" : "send";
    const normalizedIdempotencyKey = String(idempotencyKey || normalizedTurnScopeId).trim();
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const requestHash = createRequestHash({
      operation: normalizedAction,
      content: normalizedContent,
      turnScopeId: normalizedTurnScopeId,
      resumeDialogProcessId: String(resumeDialogProcessId || "").trim(),
      resumeTurnScopeId: String(resumeTurnScopeId || "").trim(),
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    if (!normalizedContent || !normalizedTurnScopeId || !normalizedIdempotencyKey) {
      const error = new Error("content, turnScopeId and idempotencyKey are required"); error.statusCode = 400; throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) { const error = new Error("session not found"); error.statusCode = 404; throw error; }
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const existing = messages.find((item) =>
        item?.role === "user" && (String(item?.turnScopeId || "") === normalizedTurnScopeId ||
          String(item?.turnCommit?.idempotencyKey || "") === normalizedIdempotencyKey));
      if (existing) {
        assertIdempotencyRequestMatches(existing?.turnCommit?.requestHash, requestHash);
        return { session, userMessage: existing, attachments: existing.attachments || [], version: resolveSessionVersion(session), deduplicated: true, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(existing), runState: existing?.turnCommit?.runState || "pending_start" };
      }
      const currentVersion = resolveSessionVersion(session);
      if (normalizedExpectedVersion !== null && normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict"); error.statusCode = 409; error.errorCode = "SESSION_VERSION_CONFLICT"; error.currentVersion = currentVersion; throw error;
      }
      const resumeDialog = String(resumeDialogProcessId || "").trim();
      const resumeScope = String(resumeTurnScopeId || "").trim();
      if (normalizedAction === "continue") {
        const sourceMessage = messages.find((item) => String(item?.turnScopeId || "") === resumeScope && resolveMessageDialogProcessId(item) === resumeDialog);
        const stopped = (Array.isArray(session.turnStatuses) ? session.turnStatuses : []).find((item) => isSameTurnStatus(item, { turnScopeId: resumeScope, dialogProcessId: resumeDialog }) && item?.status === "user_stopped");
        if (!resumeDialog || !resumeScope || !sourceMessage || !stopped) {
          const error = new Error("continue source is not a stopped turn in this session"); error.statusCode = 409; error.errorCode = "INVALID_CONTINUE_SOURCE"; throw error;
        }
        const consumed = messages.find((item) => item?.turnCommit?.action === "continue" && item?.turnCommit?.resumeTurnScopeId === resumeScope && item?.turnCommit?.resumeDialogProcessId === resumeDialog);
        if (consumed) { const error = new Error("stopped turn has already been continued"); error.statusCode = 409; error.errorCode = "CONTINUE_SOURCE_CONSUMED"; throw error; }
      }
      const nowValue = this.now();
      assertCanonicalAttachments(attachments, sessionId);
      const canonicalAttachments = dedupeAttachments(Array.isArray(attachments) ? attachments : []);
      const userMessage = normalizeMessageEntity({ role: "user", type: "message", content: normalizedContent,
        userName: String(userId), sessionId, parentSessionId: resolvedParentSessionId,
        dialogProcessId: String(dialogProcessId || "").trim(), parentDialogProcessId: String(parentDialogProcessId || "").trim(),
        turnScopeId: normalizedTurnScopeId,
        frontendUserMessage: frontendUserMessage === true,
        messageOrigin: frontendUserMessage === true ? "user" : "internal",
        attachments: canonicalAttachments,
        turnCommit: { action: normalizedAction, idempotencyKey: normalizedIdempotencyKey, requestHash, runState: "pending_start", ...(normalizedAction === "continue" ? { resumeDialogProcessId: String(resumeDialogProcessId).trim(), resumeTurnScopeId: String(resumeTurnScopeId).trim() } : {}) }, ts: nowValue,
      }, () => nowValue);
      session.messages = [...messages, userMessage];
      session.version = currentVersion + 1; session.revision = session.version; session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
      const savedSession = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId) || session;
      const savedMessage = (savedSession.messages || []).find((item) => item?.role === "user" && String(item?.turnScopeId || "") === normalizedTurnScopeId) || userMessage;
      return { session: savedSession, userMessage: savedMessage, attachments: savedMessage.attachments || [], version: resolveSessionVersion(savedSession), deduplicated: false, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(savedMessage), runState: savedMessage?.turnCommit?.runState || "pending_start" };
    });
  }
