/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { MessagePersister } from "../session/message-persister.js";
import {
  EXECUTION_LOG_EVENT,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
} from "../config/constants.js";

/**
 * Persist session turns and agent messages.
 */
export class SessionTurnPersister {
  constructor({ session = null } = {}) {
    this.session = session;
    this.messagePersister = new MessagePersister(session);
  }

  buildDefaultAssistantTurn({ agentResult = {}, dialogProcessId = "" }) {
    return {
      role: MESSAGE_ROLE.ASSISTANT,
      content: String(agentResult?.output || ""),
      type: MESSAGE_TYPE.MESSAGE,
      dialogProcessId,
    };
  }

  async appendSessionTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
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
    dialogProcessId = "",
    parentDialogProcessId = "",
    parentSessionId = "",
    eventListener,
  }) {
    const fullTurnPayload = {
      role,
      content,
      type: type || "",
      taskId: taskId ?? "",
      taskStatus: taskStatus ?? "",
      dialogProcessId: dialogProcessId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      tool_calls: Array.isArray(tool_calls) ? tool_calls : [],
      tool_call_id: tool_call_id || "",
      attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      summarized: summarized === true,
      toolName: String(toolName || "").trim(),
      rawModelContent:
        typeof rawModelContent === "string" || Array.isArray(rawModelContent)
          ? rawModelContent
          : null,
      modelAdditionalKwargs:
        modelAdditionalKwargs &&
        typeof modelAdditionalKwargs === "object" &&
        !Array.isArray(modelAdditionalKwargs)
          ? modelAdditionalKwargs
          : null,
      modelResponseMetadata:
        modelResponseMetadata &&
        typeof modelResponseMetadata === "object" &&
        !Array.isArray(modelResponseMetadata)
          ? modelResponseMetadata
          : null,
    };
    try {
      await this.messagePersister.appendExecutionLog({
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId: String(dialogProcessId || "").trim(),
        event: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
        category: MESSAGE_ROLE.SYSTEM,
        type: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
        data: fullTurnPayload,
      });
    } catch {
      // ignore execution-log failures to avoid blocking the main turn flow
    }
    await this.messagePersister.appendTurn({
      userId,
      sessionId,
      parentSessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      parentDialogProcessId,
      tool_calls,
      tool_call_id,
      attachmentMetas,
      modelAlias,
      modelName,
      summarized,
      toolName,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
    });
    emitEvent(eventListener, `${role}_message_saved`, { sessionId });
  }

  async appendAgentMessages({
    userId,
    sessionId,
    parentSessionId = "",
    messages = [],
    dialogProcessId = "",
    parentDialogProcessId = "",
    eventListener,
  }) {
    for (const messageItem of messages) {
      await this.appendSessionTurn({
        userId,
        sessionId,
        role: messageItem.role || MESSAGE_ROLE.ASSISTANT,
        content: messageItem.content || "",
        type: messageItem.type || "",
        parentSessionId,
        dialogProcessId: messageItem.dialogProcessId || dialogProcessId || "",
        parentDialogProcessId:
          messageItem.parentDialogProcessId || parentDialogProcessId || "",
        taskId: messageItem.taskId || null,
        taskStatus: messageItem.taskStatus || null,
        tool_calls: Array.isArray(messageItem.tool_calls)
          ? messageItem.tool_calls
          : null,
        tool_call_id: messageItem.tool_call_id || "",
        attachmentMetas: Array.isArray(messageItem.attachmentMetas)
          ? messageItem.attachmentMetas
          : null,
        modelAlias: (messageItem.modelAlias ?? "").trim(),
        modelName: (messageItem.modelName ?? "").trim(),
        summarized: messageItem.summarized === true,
        toolName: (messageItem.toolName ?? "").trim(),
        rawModelContent:
          typeof messageItem.rawModelContent === "string" ||
          Array.isArray(messageItem.rawModelContent)
            ? messageItem.rawModelContent
            : null,
        modelAdditionalKwargs:
          messageItem.modelAdditionalKwargs &&
          typeof messageItem.modelAdditionalKwargs === "object" &&
          !Array.isArray(messageItem.modelAdditionalKwargs)
            ? messageItem.modelAdditionalKwargs
            : null,
        modelResponseMetadata:
          messageItem.modelResponseMetadata &&
          typeof messageItem.modelResponseMetadata === "object" &&
          !Array.isArray(messageItem.modelResponseMetadata)
            ? messageItem.modelResponseMetadata
            : null,
        eventListener,
      });
    }
  }

  async persistStoppedAssistantMessage({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    partialAssistant = {},
  } = {}) {
    const content = (partialAssistant?.content ?? "").trim();
    const dialogProcessId = (partialAssistant?.dialogProcessId ?? "").trim();
    if (!userId || !sessionId || !content || !dialogProcessId) return false;
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    const messages = Array.isArray(sessionBundle?.session?.messages)
      ? sessionBundle.session.messages
      : [];
    const alreadySaved = messages.some(
      (messageItem) =>
        (messageItem?.role ?? "").trim() === MESSAGE_ROLE.ASSISTANT &&
        (messageItem?.dialogProcessId ?? "").trim() === dialogProcessId,
    );
    if (alreadySaved) return false;
    await this.appendSessionTurn({
      userId,
      sessionId,
      parentSessionId,
      role: MESSAGE_ROLE.ASSISTANT,
      content,
      type: MESSAGE_TYPE.MESSAGE,
      dialogProcessId,
      parentDialogProcessId,
      modelAlias: (partialAssistant?.modelAlias ?? "").trim(),
      modelName: (partialAssistant?.modelName ?? "").trim(),
      eventListener: null,
    });
    return true;
  }
}
