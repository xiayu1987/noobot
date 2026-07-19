/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../../entities/session-entity.js";
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { getTransferAttachmentMetas } from "../../../semantic-transfer/storage/consumer.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";

export async function appendTurn({
    userId,
    sessionId,
    userName = userId,
    role,
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
    parentSessionId = "",
    injectedMessage = false,
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
  }) {
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
    if (!session) return { appended: false, reason: "session_not_found" };

    const resolvedTaskId = taskId ?? session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    const turn = normalizeMessageEntity({
      role,
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
      injectedMessage: injectedMessage === true,
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
      ts: this.now(),
    }, this.now);

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
    session.messages.push(turn);
    upsertSessionTurnTiming(session, {
      turnScopeId: turn.turnScopeId,
      dialogProcessId: resolveMessageDialogProcessId(turn),
      thinkingStartedAt: turnTimingThinkingStartedAt,
      thinkingFinishedAt: turnTimingThinkingFinishedAt,
    });
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return turn;
    });
  }
