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
import { compactTransferEnvelopes } from "../../session/transfer-attachment-refs.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  EXECUTION_LOG_EVENT,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
} from "../config/constants.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([
  "doc_to_data_tool",
  "media_to_data_tool",
  "web_to_data_tool",
  "tool_result_overflow",
]);

const DIRECT_CONSUMED_INTERMEDIATE_TOOLS = new Set([
  "doc_to_data",
  "media_to_data",
  "web_to_data",
]);
const LEGACY_ATTACHMENT_MIRROR_KEY = "attachment" + "Metas";
const SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS = LENGTH_THRESHOLDS.preview.sessionSummaryArrayItemChars;
const SESSION_TURN_FULL_RAW_MODEL_PREVIEW_CHARS = LENGTH_THRESHOLDS.preview.sessionSummaryArrayItemChars;

function normalizeIsoTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const ms = Date.parse(text);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

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
    hasHiddenIntermediateMeta(value?.[LEGACY_ATTACHMENT_MIRROR_KEY]) ||
    hasHiddenIntermediateMeta(value?.transferFiles) ||
    hasHiddenIntermediateMeta(value?.files)
  );
}

function filterSessionAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).filter(
    (attachmentItem = {}) =>
      !HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(
        String(attachmentItem?.generationSource || "").trim(),
      ),
  );
}

function filterSessionTransferEnvelopes(transferEnvelopes = []) {
  // Transfer envelopes are lightweight descriptors required to rebuild
  // refresh-time attachment/file cards from session.json.  Do not drop them
  // solely because they originate from a tool; the heavy tool body is
  // sanitized separately by sanitizeToolContentForSession().
  return compactTransferEnvelopes(
    (Array.isArray(transferEnvelopes) ? transferEnvelopes : []).filter(isPlainObject),
  );
}

function resolveMessageAttachments(message = {}) {
  if (Array.isArray(message?.attachments)) return message.attachments;
  return [];
}

function sanitizeToolContentForSession(content = "", explicitToolName = "") {
  const parsed = parseJsonObjectSafely(content);
  if (!parsed) return String(content || "");
  const toolName = String(explicitToolName || parsed?.toolName || "").trim();
  const shouldDropDirectConsumedPayload =
    DIRECT_CONSUMED_INTERMEDIATE_TOOLS.has(toolName) ||
    hasHiddenIntermediateMeta(parsed);
  if (!shouldDropDirectConsumedPayload) return String(content || "");

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
    summary,
  });
}

function previewString(value = "", maxChars = SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function byteLengthOfJson(value = null) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function summarizeArray(value = []) {
  return {
    count: Array.isArray(value) ? value.length : 0,
    bytes: byteLengthOfJson(Array.isArray(value) ? value : []),
  };
}

function summarizeObject(value = null) {
  if (!isPlainObject(value)) return { present: false, bytes: 0, keys: [] };
  return {
    present: true,
    bytes: byteLengthOfJson(value),
    keys: Object.keys(value).slice(0, 20),
  };
}

function summarizeRawModelContent(value = null) {
  if (typeof value === "string") {
    return {
      kind: "string",
      present: value.length > 0,
      length: value.length,
      preview: previewString(value, SESSION_TURN_FULL_RAW_MODEL_PREVIEW_CHARS),
    };
  }
  if (Array.isArray(value)) {
    return { kind: "array", present: value.length > 0, ...summarizeArray(value) };
  }
  return { kind: "none", present: false, length: 0 };
}

function summarizeSessionTurnPayload(fullTurnPayload = {}) {
  const content = String(fullTurnPayload?.content || "");
  return {
    summaryVersion: 1,
    role: fullTurnPayload.role,
    type: fullTurnPayload.type || "",
    taskId: fullTurnPayload.taskId ?? "",
    taskStatus: fullTurnPayload.taskStatus ?? "",
    dialogProcessId: fullTurnPayload.dialogProcessId || "",
    parentDialogProcessId: fullTurnPayload.parentDialogProcessId || "",
    turnScopeId: fullTurnPayload.turnScopeId || "",
    content: {
      length: content.length,
      bytes: Buffer.byteLength(content, "utf8"),
      preview: previewString(content),
      truncated: content.length > SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS,
    },
    toolCalls: summarizeArray(fullTurnPayload.tool_calls),
    toolCallId: fullTurnPayload.tool_call_id || "",
    attachments: summarizeArray(fullTurnPayload.attachments),
    transferEnvelopes: summarizeArray(fullTurnPayload.transferEnvelopes),
    modelAlias: fullTurnPayload.modelAlias || "",
    modelName: fullTurnPayload.modelName || "",
    summarized: fullTurnPayload.summarized === true,
    toolName: fullTurnPayload.toolName || "",
    rawModelContent: summarizeRawModelContent(fullTurnPayload.rawModelContent),
    modelAdditionalKwargs: summarizeObject(fullTurnPayload.modelAdditionalKwargs),
    modelResponseMetadata: summarizeObject(fullTurnPayload.modelResponseMetadata),
    injectedMessage: fullTurnPayload.injectedMessage === true,
    injectedBy: fullTurnPayload.injectedBy || "",
    injectedMessageType: fullTurnPayload.injectedMessageType || "",
    frontendUserMessage: fullTurnPayload.frontendUserMessage === true,
    pluginMessage: fullTurnPayload.pluginMessage === true,
    pluginMeta: summarizeObject(fullTurnPayload.pluginMeta),
    isMonotonic: fullTurnPayload.isMonotonic === true,
    monotonic: fullTurnPayload.monotonic === true,
    monotonicState: fullTurnPayload.monotonicState || "",
    stopState: fullTurnPayload.stopState || "",
    state: fullTurnPayload.state || "",
    status: fullTurnPayload.status || "",
    channelState: fullTurnPayload.channelState || "",
    artifactRef: {
      kind: "session_turn",
      source: "session.messages",
      dialogProcessId: fullTurnPayload.dialogProcessId || "",
      turnScopeId: fullTurnPayload.turnScopeId || "",
    },
  };
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
    attachments = [],
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
    transferEnvelopes = [],
    isMonotonic = false,
    monotonic = false,
    monotonicState = "",
    stopState = "",
    state = "",
    status = "",
    channelState = "",
    thinkingStartedAt = "",
    thinkingFinishedAt = "",
    turnTimingThinkingStartedAt = thinkingStartedAt,
    turnTimingThinkingFinishedAt = thinkingFinishedAt,
  }) {
    const sessionAttachments = filterSessionAttachments(attachments);
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedThinkingStartedAt = normalizeIsoTime(thinkingStartedAt);
    const normalizedThinkingFinishedAt = normalizeIsoTime(thinkingFinishedAt);
    const normalizedTurnTimingThinkingStartedAt = normalizeIsoTime(turnTimingThinkingStartedAt);
    const normalizedTurnTimingThinkingFinishedAt = normalizeIsoTime(turnTimingThinkingFinishedAt);
    const sessionContent =
      role === MESSAGE_ROLE.TOOL
        ? sanitizeToolContentForSession(content, toolName)
        : String(content || "");
    const sessionTransferEnvelopes = filterSessionTransferEnvelopes(transferEnvelopes);
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
      attachments: sessionAttachments,
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
      ...(sessionTransferEnvelopes.length ? { transferEnvelopes: sessionTransferEnvelopes } : {}),
      isMonotonic: isMonotonic === true,
      monotonic: monotonic === true,
      monotonicState: String(monotonicState || "").trim(),
      stopState: String(stopState || "").trim(),
      state: String(state || "").trim(),
      status: String(status || "").trim(),
      channelState: String(channelState || "").trim(),
      ...(normalizedThinkingStartedAt ? { thinkingStartedAt: normalizedThinkingStartedAt } : {}),
      ...(normalizedThinkingFinishedAt ? { thinkingFinishedAt: normalizedThinkingFinishedAt } : {}),
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
        data: summarizeSessionTurnPayload(fullTurnPayload),
      });
      if (normalizedTurnTimingThinkingStartedAt || normalizedTurnTimingThinkingFinishedAt) {
        await this.messagePersister.appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
          event: "debug_turn_timing_append",
          category: MESSAGE_ROLE.SYSTEM,
          type: "system",
          data: {
            sessionId,
            role,
            turnScopeId: normalizedTurnScopeId,
            dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
            messageThinkingStartedAt: normalizedThinkingStartedAt,
            messageThinkingFinishedAt: normalizedThinkingFinishedAt,
            turnTimingThinkingStartedAt: normalizedTurnTimingThinkingStartedAt,
            turnTimingThinkingFinishedAt: normalizedTurnTimingThinkingFinishedAt,
          },
        });
      }
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
      attachments: sessionAttachments,
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
      ...(sessionTransferEnvelopes.length ? { transferEnvelopes: sessionTransferEnvelopes } : {}),
      isMonotonic,
      monotonic,
      monotonicState,
      stopState,
      state,
      status,
      channelState,
      thinkingStartedAt: normalizedThinkingStartedAt,
      thinkingFinishedAt: normalizedThinkingFinishedAt,
      turnTimingThinkingStartedAt: normalizedTurnTimingThinkingStartedAt,
      turnTimingThinkingFinishedAt: normalizedTurnTimingThinkingFinishedAt,
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
    thinkingStartedAt = "",
    thinkingFinishedAt = "",
  }) {
    const normalizedThinkingStartedAt = normalizeIsoTime(thinkingStartedAt);
    const normalizedThinkingFinishedAt = normalizeIsoTime(thinkingFinishedAt);
    let turnTimingWritten = false;
    for (const [index, messageItem] of messages.entries()) {
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
        attachments: filterSessionAttachments(resolveMessageAttachments(messageItem)),
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
        thinkingStartedAt: "",
        thinkingFinishedAt: "",
        turnTimingThinkingStartedAt: !turnTimingWritten ? normalizedThinkingStartedAt : "",
        turnTimingThinkingFinishedAt: !turnTimingWritten ? normalizedThinkingFinishedAt : "",
        eventListener,
      });
      turnTimingWritten = true;
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
    const turnScopeId = String(partialAssistant?.turnScopeId || "").trim();
    await this.session?.markUserMessageMonotonic?.({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      state: "user_stopped",
      stopState: "user_stopped",
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
      turnScopeId,
      modelAlias: (partialAssistant?.modelAlias ?? "").trim(),
      modelName: (partialAssistant?.modelName ?? "").trim(),
      isMonotonic: true,
      monotonic: true,
      monotonicState: "monotonic",
      stopState: "user_stopped",
      state: "user_stopped",
      status: "user_stopped",
      channelState: "user_stopped",
      eventListener: null,
    });
    return true;
  }
}
