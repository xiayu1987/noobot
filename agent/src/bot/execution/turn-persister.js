/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { emitEvent } from "../../events/index.js";
import { MessagePersister } from "../session/message-persister.js";
import { compactTransferEnvelopes } from "../../session/transfer-attachment-refs.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { EXECUTION_LOG_EVENT, MESSAGE_ROLE, MESSAGE_TYPE } from "../config/constants.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set(["tool_result_overflow"]);

const SESSION_TURN_FULL_CONTENT_PREVIEW_CHARS =
  LENGTH_THRESHOLDS.preview.sessionSummaryArrayItemChars;
const SESSION_TURN_FULL_RAW_MODEL_PREVIEW_CHARS =
  LENGTH_THRESHOLDS.preview.sessionSummaryArrayItemChars;

function normalizeIsoTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const ms = Date.parse(text);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  return compactTransferEnvelopes(
    (Array.isArray(transferEnvelopes) ? transferEnvelopes : []).filter(isPlainObject),
  );
}

function resolveMessageAttachments(message = {}) {
  if (Array.isArray(message?.attachments)) return message.attachments;
  return [];
}

function resolveAuthoritativeMessageId(message = {}) {
  const candidates = [
    message?.messageId,
    message?.id,
    message?.additional_kwargs?.noobotMessageId,
    message?.additional_kwargs?.messageId,
    message?.lc_kwargs?.noobotMessageId,
    message?.lc_kwargs?.messageId,
    message?.lc_kwargs?.additional_kwargs?.noobotMessageId,
    message?.lc_kwargs?.additional_kwargs?.messageId,
  ];
  return String(candidates.find(Boolean) || "").trim();
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
    artifactRef: {
      kind: "session_turn",
      source: "session.messages",
      dialogProcessId: fullTurnPayload.dialogProcessId || "",
      turnScopeId: fullTurnPayload.turnScopeId || "",
    },
  };
}

function valueOrDefault(value, defaultValue) {
  return value === undefined ? defaultValue : value;
}

function normalizedOptionalObject(value) {
  return isPlainObject(value) ? value : null;
}

function stringValue(value) {
  return String(value || "");
}

function optionalValueField(name, value) {
  return value ? { [name]: value } : {};
}

function optionalListField(name, value) {
  return Array.isArray(value) && value.length ? { [name]: value } : {};
}

function assistantPresentationField(input) {
  return input.role === MESSAGE_ROLE.ASSISTANT ? { chatPresentation: input.chatPresentation } : {};
}

function normalizedRawModelContent(value) {
  return typeof value === "string" || Array.isArray(value) ? value : null;
}

function arrayValue(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function firstTruthyValue(values, fallback = "") {
  return values.find(Boolean) || fallback;
}

function normalizeSessionTurnInput(input = {}) {
  const thinkingStartedAt = valueOrDefault(input.thinkingStartedAt, "");
  const thinkingFinishedAt = valueOrDefault(input.thinkingFinishedAt, "");
  const dialogProcessId = normalizeDialogProcessId(valueOrDefault(input.dialogProcessId, ""));
  return {
    ...input,
    userName: valueOrDefault(input.userName, input.userId),
    messageUid: String(valueOrDefault(input.messageUid, "") || "").trim(),
    messageId: String(valueOrDefault(input.messageId, "") || "").trim(),
    presentationMessageId: String(valueOrDefault(input.presentationMessageId, "") || "").trim(),
    chatPresentation: input.chatPresentation === true,
    type: valueOrDefault(input.type, ""),
    taskId: valueOrDefault(input.taskId, null),
    taskStatus: valueOrDefault(input.taskStatus, null),
    tool_calls: valueOrDefault(input.tool_calls, null),
    tool_call_id: valueOrDefault(input.tool_call_id, ""),
    attachments: filterSessionAttachments(valueOrDefault(input.attachments, [])),
    modelAlias: valueOrDefault(input.modelAlias, ""),
    modelName: valueOrDefault(input.modelName, ""),
    summarized: input.summarized === true,
    toolName: valueOrDefault(input.toolName, ""),
    rawModelContent: valueOrDefault(input.rawModelContent, null),
    modelAdditionalKwargs: valueOrDefault(input.modelAdditionalKwargs, null),
    modelResponseMetadata: valueOrDefault(input.modelResponseMetadata, null),
    activityTimeline: valueOrDefault(input.activityTimeline, []),
    toolTimeline: valueOrDefault(input.toolTimeline, []),
    dialogProcessId,
    parentDialogProcessId: valueOrDefault(input.parentDialogProcessId, ""),
    parentSessionId: normalizeParentSessionId(valueOrDefault(input.parentSessionId, "")),
    turnScopeId: String(valueOrDefault(input.turnScopeId, "") || "").trim(),
    injectedMessage: input.injectedMessage === true,
    noobotInternalMessageType: valueOrDefault(input.noobotInternalMessageType, ""),
    injectedBy: valueOrDefault(input.injectedBy, ""),
    injectedMessageType: valueOrDefault(input.injectedMessageType, ""),
    frontendUserMessage: input.frontendUserMessage === true,
    pluginMessage: input.pluginMessage === true,
    pluginMeta: valueOrDefault(input.pluginMeta, null),
    transferEnvelopes: filterSessionTransferEnvelopes(valueOrDefault(input.transferEnvelopes, [])),
    thinkingStartedAt: normalizeIsoTime(thinkingStartedAt),
    thinkingFinishedAt: normalizeIsoTime(thinkingFinishedAt),
    turnTimingThinkingStartedAt: normalizeIsoTime(
      valueOrDefault(input.turnTimingThinkingStartedAt, thinkingStartedAt),
    ),
    turnTimingThinkingFinishedAt: normalizeIsoTime(
      valueOrDefault(input.turnTimingThinkingFinishedAt, thinkingFinishedAt),
    ),
    persistenceContext: valueOrDefault(input.persistenceContext, null),
    deferTurnPersistence: input.deferTurnPersistence === true,
  };
}

function buildFullTurnPayload(input) {
  return {
    role: input.role,
    ...optionalValueField("messageUid", input.messageUid),
    ...optionalValueField("messageId", input.messageId),
    ...optionalValueField("presentationMessageId", input.presentationMessageId),
    ...assistantPresentationField(input),
    content: stringValue(input.content),
    type: stringValue(input.type),
    userName: stringValue(input.userName).trim(),
    sessionId: stringValue(input.sessionId).trim(),
    parentSessionId: input.parentSessionId,
    taskId: valueOrDefault(input.taskId, ""),
    taskStatus: valueOrDefault(input.taskStatus, ""),
    dialogProcessId: input.dialogProcessId,
    parentDialogProcessId: stringValue(input.parentDialogProcessId),
    turnScopeId: input.turnScopeId,
    tool_calls: Array.isArray(input.tool_calls) ? input.tool_calls : [],
    tool_call_id: stringValue(input.tool_call_id),
    ...optionalListField("attachments", input.attachments),
    modelAlias: stringValue(input.modelAlias).trim(),
    modelName: stringValue(input.modelName).trim(),
    summarized: input.summarized,
    toolName: stringValue(input.toolName).trim(),
    rawModelContent: normalizedRawModelContent(input.rawModelContent),
    modelAdditionalKwargs: normalizedOptionalObject(input.modelAdditionalKwargs),
    injectedMessage: input.injectedMessage,
    noobotInternalMessageType: stringValue(input.noobotInternalMessageType).trim(),
    injectedBy: stringValue(input.injectedBy).trim(),
    injectedMessageType: stringValue(input.injectedMessageType).trim(),
    frontendUserMessage: input.frontendUserMessage,
    pluginMessage: input.pluginMessage,
    pluginMeta: normalizedOptionalObject(input.pluginMeta),
    ...optionalListField("transferEnvelopes", input.transferEnvelopes),
    ...optionalValueField("thinkingStartedAt", input.thinkingStartedAt),
    ...optionalValueField("thinkingFinishedAt", input.thinkingFinishedAt),
    modelResponseMetadata: normalizedOptionalObject(input.modelResponseMetadata),
    ...optionalListField("activityTimeline", input.activityTimeline),
    ...optionalListField("toolTimeline", input.toolTimeline),
  };
}

function hasTurnTiming(input) {
  return Boolean(input.turnTimingThinkingStartedAt || input.turnTimingThinkingFinishedAt);
}

function buildTurnTimingDiagnostic(input) {
  return {
    sessionId: input.sessionId,
    role: input.role,
    turnScopeId: input.turnScopeId,
    dialogProcessId: input.dialogProcessId,
    messageThinkingStartedAt: input.thinkingStartedAt,
    messageThinkingFinishedAt: input.thinkingFinishedAt,
    turnTimingThinkingStartedAt: input.turnTimingThinkingStartedAt,
    turnTimingThinkingFinishedAt: input.turnTimingThinkingFinishedAt,
  };
}

async function appendSessionTurnDiagnostics(messagePersister, input, fullTurnPayload) {
  await messagePersister.appendExecutionLog({
    userId: input.userId,
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId,
    dialogProcessId: input.dialogProcessId,
    event: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    category: MESSAGE_ROLE.SYSTEM,
    type: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    data: summarizeSessionTurnPayload(fullTurnPayload),
    persistenceContext: input.persistenceContext,
  });
  if (!hasTurnTiming(input)) return;
  await messagePersister.appendExecutionLog({
    userId: input.userId,
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId,
    dialogProcessId: input.dialogProcessId,
    event: "debug_turn_timing_append",
    category: MESSAGE_ROLE.SYSTEM,
    type: "system",
    data: buildTurnTimingDiagnostic(input),
    persistenceContext: input.persistenceContext,
  });
}

async function tryAppendSessionTurnDiagnostics(messagePersister, input, fullTurnPayload) {
  try {
    await appendSessionTurnDiagnostics(messagePersister, input, fullTurnPayload);
  } catch (error) {
    emitEvent(input.eventListener, "session_turn_diagnostic_persistence_failed", {
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      dialogProcessId: input.dialogProcessId,
      turnScopeId: input.turnScopeId,
      error: error?.message || String(error || ""),
    });
  }
}

function buildTurnPayload(input) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId,
    role: input.role,
    messageUid: input.messageUid,
    messageId: input.messageId,
    presentationMessageId: input.presentationMessageId,
    chatPresentation: input.chatPresentation,
    content: String(input.content || ""),
    type: input.type,
    userName: input.userName,
    taskId: input.taskId,
    taskStatus: input.taskStatus,
    dialogProcessId: input.dialogProcessId,
    parentDialogProcessId: input.parentDialogProcessId,
    turnScopeId: input.turnScopeId,
    tool_calls: input.tool_calls,
    tool_call_id: input.tool_call_id,
    ...(input.attachments.length ? { attachments: input.attachments } : {}),
    modelAlias: input.modelAlias,
    modelName: input.modelName,
    summarized: input.summarized,
    toolName: input.toolName,
    rawModelContent: input.rawModelContent,
    modelAdditionalKwargs: input.modelAdditionalKwargs,
    modelResponseMetadata: input.modelResponseMetadata,
    activityTimeline: Array.isArray(input.activityTimeline) ? input.activityTimeline : [],
    toolTimeline: Array.isArray(input.toolTimeline) ? input.toolTimeline : [],
    injectedMessage: input.injectedMessage,
    noobotInternalMessageType: input.noobotInternalMessageType,
    injectedBy: input.injectedBy,
    injectedMessageType: input.injectedMessageType,
    frontendUserMessage: input.frontendUserMessage,
    pluginMessage: input.pluginMessage,
    pluginMeta: input.pluginMeta,
    ...(input.transferEnvelopes.length ? { transferEnvelopes: input.transferEnvelopes } : {}),
    thinkingStartedAt: input.thinkingStartedAt,
    thinkingFinishedAt: input.thinkingFinishedAt,
    turnTimingThinkingStartedAt: input.turnTimingThinkingStartedAt,
    turnTimingThinkingFinishedAt: input.turnTimingThinkingFinishedAt,
    persistenceContext: input.persistenceContext,
  };
}

function normalizeAgentMessagesInput(input = {}) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    parentSessionId: valueOrDefault(input.parentSessionId, ""),
    messages: valueOrDefault(input.messages, []),
    dialogProcessId: valueOrDefault(input.dialogProcessId, ""),
    parentDialogProcessId: valueOrDefault(input.parentDialogProcessId, ""),
    turnScopeId: valueOrDefault(input.turnScopeId, ""),
    eventListener: input.eventListener,
    thinkingStartedAt: normalizeIsoTime(valueOrDefault(input.thinkingStartedAt, "")),
    thinkingFinishedAt: normalizeIsoTime(valueOrDefault(input.thinkingFinishedAt, "")),
    persistenceContext: valueOrDefault(input.persistenceContext, null),
  };
}

function buildAgentMessageTurnInput(messageItem, input, includeTurnTiming) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    role: firstTruthyValue([messageItem.role], MESSAGE_ROLE.ASSISTANT),
    messageUid: stringValue(messageItem?.messageUid).trim(),
    messageId: resolveAuthoritativeMessageId(messageItem),
    presentationMessageId: stringValue(messageItem.presentationMessageId).trim(),
    chatPresentation: messageItem.chatPresentation === true,
    content: stringValue(messageItem.content),
    type: stringValue(messageItem.type),
    parentSessionId: input.parentSessionId,
    dialogProcessId: firstTruthyValue([
      resolveContextMessageDialogProcessId(messageItem),
      normalizeDialogProcessId(input.dialogProcessId),
    ]),
    parentDialogProcessId: firstTruthyValue([
      messageItem.parentDialogProcessId,
      input.parentDialogProcessId,
    ]),
    taskId: firstTruthyValue([messageItem.taskId], null),
    taskStatus: firstTruthyValue([messageItem.taskStatus], null),
    tool_calls: arrayValue(messageItem.tool_calls, null),
    tool_call_id: stringValue(messageItem.tool_call_id),
    attachments: filterSessionAttachments(resolveMessageAttachments(messageItem)),
    modelAlias: String(messageItem.modelAlias ?? "").trim(),
    modelName: String(messageItem.modelName ?? "").trim(),
    summarized: messageItem.summarized === true,
    toolName: String(messageItem.toolName ?? "").trim(),
    rawModelContent: normalizedRawModelContent(messageItem.rawModelContent),
    modelAdditionalKwargs: normalizedOptionalObject(messageItem.modelAdditionalKwargs),
    injectedMessage: messageItem.injectedMessage === true,
    noobotInternalMessageType: stringValue(messageItem.noobotInternalMessageType).trim(),
    injectedBy: stringValue(messageItem.injectedBy).trim(),
    injectedMessageType: stringValue(messageItem.injectedMessageType).trim(),
    frontendUserMessage: messageItem.frontendUserMessage === true,
    pluginMessage: messageItem.pluginMessage === true,
    pluginMeta: normalizedOptionalObject(messageItem.pluginMeta),
    transferEnvelopes: arrayValue(messageItem.transferEnvelopes),
    modelResponseMetadata: normalizedOptionalObject(messageItem.modelResponseMetadata),
    activityTimeline: arrayValue(messageItem.activityTimeline),
    toolTimeline: arrayValue(messageItem.toolTimeline),
    turnScopeId: stringValue(firstTruthyValue([messageItem.turnScopeId, input.turnScopeId])).trim(),
    thinkingStartedAt: "",
    thinkingFinishedAt: "",
    turnTimingThinkingStartedAt: includeTurnTiming ? input.thinkingStartedAt : "",
    turnTimingThinkingFinishedAt: includeTurnTiming ? input.thinkingFinishedAt : "",
    eventListener: input.eventListener,
    persistenceContext: input.persistenceContext,
    deferTurnPersistence: true,
  };
}

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

  async appendSessionTurn(payload = {}) {
    const input = normalizeSessionTurnInput(payload);
    const fullTurnPayload = buildFullTurnPayload(input);
    await tryAppendSessionTurnDiagnostics(this.messagePersister, input, fullTurnPayload);
    const turnPayload = buildTurnPayload(input);
    if (input.deferTurnPersistence) return turnPayload;
    await this.messagePersister.appendTurn(turnPayload);
    emitEvent(input.eventListener, `${input.role}_message_saved`, { sessionId: input.sessionId });
    return turnPayload;
  }

  async appendAgentMessages(payload = {}) {
    const input = normalizeAgentMessagesInput(payload);
    const turnPayloads = [];
    for (const messageItem of input.messages) {
      const turnPayload = await this.appendSessionTurn(
        buildAgentMessageTurnInput(messageItem, input, turnPayloads.length === 0),
      );
      turnPayloads.push(turnPayload);
    }
    if (!turnPayloads.length) return [];
    const persistedTurns = await this.messagePersister.appendTurns({
      userId: input.userId,
      sessionId: input.sessionId,
      parentSessionId: normalizeParentSessionId(input.parentSessionId),
      turns: turnPayloads,
      persistenceContext: input.persistenceContext,
    });
    for (const turnPayload of turnPayloads) {
      emitEvent(input.eventListener, `${turnPayload.role}_message_saved`, {
        sessionId: input.sessionId,
      });
    }
    return Array.isArray(persistedTurns) ? persistedTurns : [];
  }
}
