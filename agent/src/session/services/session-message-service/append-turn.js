/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { getTransferAttachmentMetas } from "../../../transfer/storage/consumer.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";

function upsertTurnInSession(service, session, resolvedParentSessionId, {
  userId,
  sessionId,
  userName = userId,
  role,
  messageUid = "",
  messageId = "",
  presentationMessageId = "",
  chatPresentation = false,
  content,
  type = "",
  taskId = null,
  taskStatus = null,
  dialogProcessId = "",
  parentDialogProcessId = "",
  turnScopeId = "",
  tool_calls = null,
  tool_call_id = "",
  attachments = [],
  modelAlias = "",
  modelName = "",
  summarized = false,
  toolName = "",
  rawModelContent = null,
  modelAdditionalKwargs = null,
  modelResponseMetadata = null,
  activityTimeline = [],
  toolTimeline = [],
  injectedMessage = false,
  noobotInternalMessageType = "",
  injectedBy = "",
  injectedMessageType = "",
  frontendUserMessage = false,
  pluginMessage = false,
  pluginMeta = null,
  transferEnvelopes = [],
  thinkingStartedAt = "",
  thinkingFinishedAt = "",
  turnTimingThinkingStartedAt = thinkingStartedAt,
  turnTimingThinkingFinishedAt = thinkingFinishedAt,
} = {}) {
    const resolvedTaskId = taskId ?? session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    const turn = normalizeMessageEntity({
      role,
      messageUid,
      messageId,
      ...(String(presentationMessageId || "").trim()
        ? { presentationMessageId: String(presentationMessageId || "").trim() }
        : {}),
      ...(role === "assistant" ? { chatPresentation: chatPresentation === true } : {}),
      content,
      type: type || "",
      userName: String(userName || "").trim(),
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(resolvedParentSessionId || "").trim(),
      dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
      parentDialogProcessId: parentDialogProcessId || "",
      turnScopeId: String(turnScopeId || "").trim(),
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      summarized: summarized === true,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
      ...(Array.isArray(activityTimeline) && activityTimeline.length ? { activityTimeline } : {}),
      ...(Array.isArray(toolTimeline) && toolTimeline.length ? { toolTimeline } : {}),
      injectedMessage: injectedMessage === true,
      noobotInternalMessageType: String(noobotInternalMessageType || "").trim(),
      injectedBy: String(injectedBy || "").trim(),
      injectedMessageType: String(injectedMessageType || "").trim(),
      frontendUserMessage: frontendUserMessage === true,
      pluginMessage: pluginMessage === true,
      pluginMeta:
        pluginMeta &&
        typeof pluginMeta === "object" &&
        !Array.isArray(pluginMeta)
          ? pluginMeta
          : null,
      transferEnvelopes: Array.isArray(transferEnvelopes) ? transferEnvelopes : [],
      ...(String(thinkingStartedAt || "").trim() ? { thinkingStartedAt: String(thinkingStartedAt || "").trim() } : {}),
      ...(String(thinkingFinishedAt || "").trim() ? { thinkingFinishedAt: String(thinkingFinishedAt || "").trim() } : {}),
      ts: service.now(),
    }, service.now);

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (toolName) turn.toolName = String(toolName || "").trim();
    if (Array.isArray(tool_calls) && tool_calls.length) turn.tool_calls = tool_calls;
    const transferAttachments = getTransferAttachmentMetas(
      [
        ...(Array.isArray(transferEnvelopes) ? transferEnvelopes : []),
        ...(Array.isArray(turn?.transferEnvelopes) ? turn.transferEnvelopes : []),
      ].filter(Boolean),
    );
    const preferredAttachments = Array.isArray(turn?.transferEnvelopes) && turn.transferEnvelopes.length
      ? []
      : transferAttachments.length
        ? dedupeAttachments(transferAttachments)
        : (Array.isArray(attachments) ? attachments : []);
    if (preferredAttachments.length) {
      turn.attachments = preferredAttachments;
    }

    session.messages = Array.isArray(session.messages) ? session.messages : [];
    const turnDialogProcessId = resolveMessageDialogProcessId(turn);
    const turnScope = String(turn?.turnScopeId || "").trim();
    const normalizedMessageUid = String(turn.messageUid || "").trim();
    const compositeIdentityIndex = turn.messageId
      ? session.messages.findIndex((message = {}) =>
          String(message?.messageId || message?.id || "").trim() === turn.messageId &&
          resolveMessageDialogProcessId(message) === turnDialogProcessId &&
          String(message?.turnScopeId || "").trim() === turnScope)
      : -1;
    const existingIndex = normalizedMessageUid
      ? session.messages.findIndex((message = {}) => String(message?.messageUid || "").trim() === normalizedMessageUid)
      : compositeIdentityIndex;
    if (normalizedMessageUid && existingIndex < 0 && compositeIdentityIndex >= 0) {
      const error = new Error("messageUid does not match the persisted runtime message identity");
      error.code = "SESSION_MESSAGE_UID_MISMATCH";
      throw error;
    }
    let persistedTurn;
    if (existingIndex >= 0) {
      const existing = session.messages[existingIndex] || {};
      if (normalizedMessageUid && (
        resolveMessageDialogProcessId(existing) !== turnDialogProcessId ||
        String(existing?.turnScopeId || "").trim() !== turnScope
      )) {
        const error = new Error("messageUid does not belong to the requested dialog and turn");
        error.code = "SESSION_MESSAGE_IDENTITY_CONFLICT";
        throw error;
      }
      persistedTurn = normalizeMessageEntity({
        ...existing,
        ...turn,
        messageUid: existing.messageUid || normalizedMessageUid || createSessionMessageUid(),
        id: turn.messageId,
        messageId: turn.messageId,
        ts: existing.ts || turn.ts,
      }, service.now);
      session.messages[existingIndex] = persistedTurn;
    } else {
      persistedTurn = normalizeMessageEntity({
        ...turn,
        messageUid: normalizedMessageUid || createSessionMessageUid(),
      }, service.now);
      session.messages.push(persistedTurn);
    }
    upsertSessionTurnTiming(session, {
      turnScopeId: turn.turnScopeId,
      dialogProcessId: resolveMessageDialogProcessId(turn),
      thinkingStartedAt: turnTimingThinkingStartedAt,
      thinkingFinishedAt: turnTimingThinkingFinishedAt,
    });
    session.updatedAt = service.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    return persistedTurn;
}

export async function appendTurns({
  userId,
  sessionId,
  parentSessionId = "",
  turns = [],
  persistenceContext = null,
} = {}) {
  const sourceTurns = Array.isArray(turns) ? turns : [];
  if (!sourceTurns.length) return [];
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
    if (!session) return { appended: false, reason: "session_not_found" };

    const persistedTurns = sourceTurns.map((turn = {}) => upsertTurnInSession(
      this,
      session,
      resolvedParentSessionId,
      {
        ...turn,
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
        persistenceContext,
      },
    ));
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return persistedTurns;
  }, parentSessionId, persistenceContext);
}

export async function appendTurn(payload = {}) {
  const result = await appendTurns.call(this, {
    userId: payload.userId,
    sessionId: payload.sessionId,
    parentSessionId: payload.parentSessionId,
    turns: [payload],
    persistenceContext: payload.persistenceContext,
  });
  return Array.isArray(result) ? result[0] : result;
}
