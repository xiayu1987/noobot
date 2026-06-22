/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import {
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../context/session/dialog-process-id-resolver.js";
import { MessagePersister } from "../session/message-persister.js";
import {
  EXECUTION_LOG_EVENT,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
} from "../config/constants.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "tool_result_overflow",
]);

const DIRECT_CONSUMED_INTERMEDIATE_TOOLS = new Set([
  "doc_to_data",
  "media_to_data",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObjectSafely(text = "") {
  try {
    const parsed = JSON.parse(String(text || ""));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasHiddenIntermediateMeta(value = null) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasHiddenIntermediateMeta);
  if (!isPlainObject(value)) return false;
  const generationSource = String(value?.generationSource || "").trim();
  if (HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource)) return true;
  return (
    hasHiddenIntermediateMeta(value?.attachmentMeta) ||
    hasHiddenIntermediateMeta(value?.attachmentMetas) ||
    hasHiddenIntermediateMeta(value?.transferFiles) ||
    hasHiddenIntermediateMeta(value?.files)
  );
}

function filterSessionAttachmentMetas(attachmentMetas = []) {
  return (Array.isArray(attachmentMetas) ? attachmentMetas : []).filter(
    (attachmentItem = {}) =>
      !HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(
        String(attachmentItem?.generationSource || "").trim(),
      ),
  );
}

function sanitizeToolContentForSession(content = "", explicitToolName = "") {
  const parsed = parseJsonObjectSafely(content);
  if (!parsed) return String(content || "");
  const toolName = String(explicitToolName || parsed?.toolName || "").trim();
  const shouldDropDirectConsumedPayload =
    DIRECT_CONSUMED_INTERMEDIATE_TOOLS.has(toolName) ||
    hasHiddenIntermediateMeta(parsed);
  if (!shouldDropDirectConsumedPayload) return String(content || "");

  const textLength = String(parsed?.text || parsed?.content || "").length;
  const summary =
    parsed?.summary && typeof parsed.summary === "object" && !Array.isArray(parsed.summary)
      ? parsed.summary
      : {};
  return JSON.stringify({
    toolName: toolName || String(parsed?.toolName || "").trim(),
    ok: parsed?.ok !== false,
    status: String(parsed?.status || "completed").trim() || "completed",
    mode: String(parsed?.mode || "").trim(),
    intermediateConsumedByModel: true,
    sessionPersistence: "summary_only",
    summary: {
      ...summary,
      ...(textLength ? { text_length: Number(summary?.text_length || textLength) } : {}),
    },
  });
}

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
    turnScopeId = "",
    eventListener,
    injectedMessage = false,
    injectedBy = "",
    injectedMessageType = "",
    frontendUserMessage = false,
    pluginMessage = false,
    pluginMeta = null,
    transferResult = null,
    transferEnvelopes = [],
    isMonotonic = false,
    monotonic = false,
    monotonicState = "",
    stopState = "",
    state = "",
    status = "",
    channelState = "",
  }) {
    const sessionAttachmentMetas = filterSessionAttachmentMetas(attachmentMetas);
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const sessionContent =
      role === MESSAGE_ROLE.TOOL
        ? sanitizeToolContentForSession(content, toolName)
        : String(content || "");
    const shouldPersistTransferPayload = role !== MESSAGE_ROLE.TOOL;
    const sessionTransferResult =
      shouldPersistTransferPayload && isPlainObject(transferResult) ? transferResult : null;
    const sessionTransferEnvelopes =
      shouldPersistTransferPayload && Array.isArray(transferEnvelopes)
        ? transferEnvelopes.filter(isPlainObject)
        : shouldPersistTransferPayload && isPlainObject(sessionTransferResult?.envelope)
          ? [sessionTransferResult.envelope]
          : [];
    const shouldOmitAttachmentMetasMirror =
      shouldPersistTransferPayload && sessionTransferEnvelopes.length > 0;
    const fullTurnPayload = {
      role,
      content: sessionContent,
      type: type || "",
      taskId: taskId ?? "",
      taskStatus: taskStatus ?? "",
      dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
      parentDialogProcessId: parentDialogProcessId || "",
      turnScopeId: normalizedTurnScopeId,
      tool_calls: Array.isArray(tool_calls) ? tool_calls : [],
      tool_call_id: tool_call_id || "",
      ...(!shouldOmitAttachmentMetasMirror ? { attachmentMetas: sessionAttachmentMetas } : {}),
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
      ...(sessionTransferResult ? { transferResult: sessionTransferResult } : {}),
      ...(sessionTransferEnvelopes.length ? { transferEnvelopes: sessionTransferEnvelopes } : {}),
      isMonotonic: isMonotonic === true,
      monotonic: monotonic === true,
      monotonicState: String(monotonicState || "").trim(),
      stopState: String(stopState || "").trim(),
      state: String(state || "").trim(),
      status: String(status || "").trim(),
      channelState: String(channelState || "").trim(),
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
        dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
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
      content: sessionContent,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      tool_calls,
      tool_call_id,
      ...(!shouldOmitAttachmentMetasMirror ? { attachmentMetas: sessionAttachmentMetas } : {}),
      modelAlias,
      modelName,
      summarized,
      toolName,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
      injectedMessage,
      injectedBy,
      injectedMessageType,
      frontendUserMessage,
      pluginMessage,
      pluginMeta,
      ...(sessionTransferResult ? { transferResult: sessionTransferResult } : {}),
      ...(sessionTransferEnvelopes.length ? { transferEnvelopes: sessionTransferEnvelopes } : {}),
      isMonotonic,
      monotonic,
      monotonicState,
      stopState,
      state,
      status,
      channelState,
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
    turnScopeId = "",
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
        dialogProcessId:
          resolveMessageDialogProcessId(messageItem) ||
          resolveDialogProcessIdFromContext({ dialogProcessId }),
        parentDialogProcessId:
          messageItem.parentDialogProcessId || parentDialogProcessId || "",
        taskId: messageItem.taskId || null,
        taskStatus: messageItem.taskStatus || null,
        tool_calls: Array.isArray(messageItem.tool_calls)
          ? messageItem.tool_calls
          : null,
        tool_call_id: messageItem.tool_call_id || "",
        attachmentMetas: Array.isArray(messageItem.attachmentMetas)
          ? filterSessionAttachmentMetas(messageItem.attachmentMetas)
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
        injectedMessage: messageItem.injectedMessage === true,
        injectedBy: String(messageItem.injectedBy || "").trim(),
        injectedMessageType: String(messageItem.injectedMessageType || messageItem.injected_message_type || "").trim(),
        frontendUserMessage: messageItem.frontendUserMessage === true,
        pluginMessage: messageItem.pluginMessage === true,
        pluginMeta:
          messageItem.pluginMeta &&
          typeof messageItem.pluginMeta === "object" &&
          !Array.isArray(messageItem.pluginMeta)
            ? messageItem.pluginMeta
            : null,
        transferResult:
          messageItem.transferResult &&
          typeof messageItem.transferResult === "object" &&
          !Array.isArray(messageItem.transferResult)
            ? messageItem.transferResult
            : null,
        transferEnvelopes: Array.isArray(messageItem.transferEnvelopes)
          ? messageItem.transferEnvelopes
          : [],
        modelResponseMetadata:
          messageItem.modelResponseMetadata &&
          typeof messageItem.modelResponseMetadata === "object" &&
          !Array.isArray(messageItem.modelResponseMetadata)
            ? messageItem.modelResponseMetadata
            : null,
        turnScopeId: String(messageItem.turnScopeId || turnScopeId || "").trim(),
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
    const dialogProcessId = resolveMessageDialogProcessId(partialAssistant);
    await this.session?.markUserMessageMonotonic?.({
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      state: "stopped",
      stopState: "stopped",
    });
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
        resolveMessageDialogProcessId(messageItem) === dialogProcessId,
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
      turnScopeId: String(partialAssistant?.turnScopeId || "").trim(),
      modelAlias: (partialAssistant?.modelAlias ?? "").trim(),
      modelName: (partialAssistant?.modelName ?? "").trim(),
      isMonotonic: true,
      monotonic: true,
      monotonicState: "monotonic",
      stopState: "stopped",
      state: "stopped",
      status: "stopped",
      channelState: "stopped",
      eventListener: null,
    });
    return true;
  }
}
