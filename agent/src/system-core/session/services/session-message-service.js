/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../entities/session-entity.js";
import {
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../context/session/dialog-process-id-resolver.js";

export class SessionMessageService {
  constructor({
    sessionRepo,
    sessionCrudService = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
  }

  async appendTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    tool_calls = null,
    tool_call_id = "",
    attachmentMetas = [],
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
    frontendUserMessage = false,
    workflowMessage = false,
    workflowMeta = null,
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    if (this.sessionCrudService) {
      await this.sessionCrudService.ensureSession(
        userId,
        sessionId,
        resolvedParentSessionId,
      );
    } else {
      await this.sessionRepo.ensureSession({
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
      });
    }
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return;

    const resolvedTaskId = taskId ?? session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    const turn = normalizeMessageEntity({
      role,
      content,
      type: type || "",
      dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
      parentDialogProcessId: parentDialogProcessId || "",
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
      frontendUserMessage: frontendUserMessage === true,
      workflowMessage: workflowMessage === true,
      workflowMeta:
        workflowMeta &&
        typeof workflowMeta === "object" &&
        !Array.isArray(workflowMeta)
          ? workflowMeta
          : null,
      ts: this.now(),
    }, this.now);

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (toolName) turn.toolName = String(toolName || "").trim();
    if (Array.isArray(tool_calls) && tool_calls.length) turn.tool_calls = tool_calls;
    if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
      turn.attachmentMetas = attachmentMetas;
    }

    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(turn);
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
  }

  async markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId = "",
    shouldMark = null,
  } = {}) {
    if (!userId || !sessionId) return 0;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return 0;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    let updatedCount = 0;
    session.messages = messages.map((messageItem) => {
      const shouldUpdate =
        typeof shouldMark === "function" ? shouldMark(messageItem) : true;
      if (!shouldUpdate || messageItem?.summarized === true) return messageItem;
      updatedCount += 1;
      return { ...messageItem, summarized: true };
    });
    if (updatedCount > 0) {
      await this.sessionRepo.save(userId, session, parentSessionId);
    }
    return updatedCount;
  }

  async getSessionTurns({ userId, sessionId }) {
    const session = await this.sessionRepo.findById(userId, sessionId);
    return session?.messages || [];
  }

  async hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId,
    });
    if (!normalizedDialogProcessId) return false;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return false;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return messages.some(
      (messageItem) =>
        resolveMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
    );
  }
}
