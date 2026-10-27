/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import {
  SESSION_DELETED_REASON,
  SESSION_ERROR_CODE,
  SESSION_NOT_FOUND_REASON,
  createSessionDeletedError,
  createSessionNotFoundError,
  isCanonicalMessageTimestamp,
  normalizeDialogProcessId,
  pickMessageOriginField,
} from "@noobot/session-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { emitEvent } from "../../events/index.js";
import { compactTransferEnvelopes } from "../../session/transfer-attachment-refs.js";
import { EXECUTION_LOG_EVENT, MESSAGE_ROLE } from "../config/constants.js";
import { summarizeSessionTurnPayload } from "./turn-payload-summary.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set(["tool_result_overflow"]);

function pickSourceTimestampField(source) {
  if (source.ts === undefined) return {};
  if (!isCanonicalMessageTimestamp(source.ts)) {
    throw new TypeError("session turn ts must be a canonical ISO timestamp");
  }
  return { ts: source.ts };
}

function filterSessionAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).filter(
    (attachmentItem = {}) =>
      !HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(text(attachmentItem?.generationSource)),
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
  const dialogProcessId = normalizeDialogProcessId(valueOrDefault(input.dialogProcessId, ""));
  return {
    ...input,
    userName: valueOrDefault(input.userName, input.userId),
    messageUid: text(input.messageUid),
    modelMessageId: text(input.modelMessageId),
    userMessageId: text(input.userMessageId),
    presentationMessageId: text(input.presentationMessageId),
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
    contextPolicy: resolveToolContextPolicy(input),
    rawModelContent: valueOrDefault(input.rawModelContent, null),
    modelAdditionalKwargs: valueOrDefault(input.modelAdditionalKwargs, null),
    modelResponseMetadata: valueOrDefault(input.modelResponseMetadata, null),
    activityTimeline: valueOrDefault(input.activityTimeline, []),
    toolTimeline: valueOrDefault(input.toolTimeline, []),
    dialogProcessId,
    parentDialogProcessId: valueOrDefault(input.parentDialogProcessId, ""),
    turnScopeId: text(valueOrDefault(input.turnScopeId, "")),
    injectedMessage: input.injectedMessage === true,
    noobotInternalMessageType: valueOrDefault(input.noobotInternalMessageType, ""),
    injectedBy: valueOrDefault(input.injectedBy, ""),
    injectedMessageType: valueOrDefault(input.injectedMessageType, ""),
    relayCorrelationId: valueOrDefault(input.relayCorrelationId, ""),
    ...(input.interjectionSequence === undefined
      ? {}
      : { interjectionSequence: input.interjectionSequence }),
    ...pickMessageOriginField(input),
    pluginMessage: input.pluginMessage === true,
    pluginMeta: valueOrDefault(input.pluginMeta, null),
    transferEnvelopes: filterSessionTransferEnvelopes(valueOrDefault(input.transferEnvelopes, [])),
    ...pickSourceTimestampField(input),
    persistenceScope: input.persistenceScope,
  };
}

function buildFullTurnPayload(input) {
  return {
    role: input.role,
    ...optionalValueField("messageUid", input.messageUid),
    ...optionalValueField("modelMessageId", input.modelMessageId),
    ...optionalValueField("userMessageId", input.userMessageId),
    ...optionalValueField("presentationMessageId", input.presentationMessageId),
    ...assistantPresentationField(input),
    content: stringValue(input.content),
    type: stringValue(input.type),
    userName: stringValue(input.userName).trim(),
    sessionId: stringValue(input.sessionId).trim(),
    taskId: valueOrDefault(input.taskId, ""),
    taskStatus: valueOrDefault(input.taskStatus, ""),
    dialogProcessId: input.dialogProcessId,
    parentDialogProcessId: stringValue(input.parentDialogProcessId),
    turnScopeId: input.turnScopeId,
    tool_calls: Array.isArray(input.tool_calls) ? input.tool_calls : [],
    tool_call_id: stringValue(input.tool_call_id),
    attachments: input.attachments,
    modelAlias: stringValue(input.modelAlias).trim(),
    modelName: stringValue(input.modelName).trim(),
    summarized: input.summarized,
    toolName: stringValue(input.toolName).trim(),
    ...(input.contextPolicy ? { contextPolicy: input.contextPolicy } : {}),
    rawModelContent: normalizedRawModelContent(input.rawModelContent),
    modelAdditionalKwargs: normalizedOptionalObject(input.modelAdditionalKwargs),
    injectedMessage: input.injectedMessage,
    noobotInternalMessageType: stringValue(input.noobotInternalMessageType).trim(),
    injectedBy: stringValue(input.injectedBy).trim(),
    injectedMessageType: stringValue(input.injectedMessageType).trim(),
    relayCorrelationId: stringValue(input.relayCorrelationId).trim(),
    ...(input.interjectionSequence === undefined
      ? {}
      : { interjectionSequence: input.interjectionSequence }),
    ...pickMessageOriginField(input),
    pluginMessage: input.pluginMessage,
    pluginMeta: normalizedOptionalObject(input.pluginMeta),
    ...optionalListField("transferEnvelopes", input.transferEnvelopes),
    ...pickSourceTimestampField(input),
    modelResponseMetadata: normalizedOptionalObject(input.modelResponseMetadata),
    ...optionalListField("activityTimeline", input.activityTimeline),
    ...optionalListField("toolTimeline", input.toolTimeline),
  };
}

async function appendSessionTurnDiagnostics(session, input, fullTurnPayload) {
  await session.appendExecutionLog({
    userId: input.userId,
    sessionId: input.sessionId,
    dialogProcessId: input.dialogProcessId,
    turnScopeId: input.turnScopeId,
    event: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    category: MESSAGE_ROLE.SYSTEM,
    type: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    data: summarizeSessionTurnPayload(fullTurnPayload),
    persistenceScope: input.persistenceScope,
  });
}

async function tryAppendSessionTurnDiagnostics(session, input, fullTurnPayload) {
  try {
    await appendSessionTurnDiagnostics(session, input, fullTurnPayload);
  } catch (error) {
    emitEvent(input.eventListener, "session_turn_diagnostic_persistence_failed", {
      error: error?.message || String(error || ""),
    });
  }
}

function buildTurnPayload(input) {
  return {
    role: input.role,
    messageUid: input.messageUid,
    modelMessageId: input.modelMessageId,
    userMessageId: input.userMessageId,
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
    attachments: input.attachments,
    modelAlias: input.modelAlias,
    modelName: input.modelName,
    summarized: input.summarized,
    toolName: input.toolName,
    ...(input.contextPolicy ? { contextPolicy: input.contextPolicy } : {}),
    rawModelContent: input.rawModelContent,
    modelAdditionalKwargs: input.modelAdditionalKwargs,
    modelResponseMetadata: input.modelResponseMetadata,
    activityTimeline: Array.isArray(input.activityTimeline) ? input.activityTimeline : [],
    toolTimeline: Array.isArray(input.toolTimeline) ? input.toolTimeline : [],
    injectedMessage: input.injectedMessage,
    noobotInternalMessageType: input.noobotInternalMessageType,
    injectedBy: input.injectedBy,
    injectedMessageType: input.injectedMessageType,
    relayCorrelationId: input.relayCorrelationId,
    ...(input.interjectionSequence === undefined
      ? {}
      : { interjectionSequence: input.interjectionSequence }),
    ...pickMessageOriginField(input),
    pluginMessage: input.pluginMessage,
    pluginMeta: input.pluginMeta,
    ...(input.transferEnvelopes.length ? { transferEnvelopes: input.transferEnvelopes } : {}),
    ...pickSourceTimestampField(input),
  };
}

function normalizeAgentMessagesInput(input = {}) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    messages: valueOrDefault(input.messages, []),
    dialogProcessId: valueOrDefault(input.dialogProcessId, ""),
    parentDialogProcessId: valueOrDefault(input.parentDialogProcessId, ""),
    turnScopeId: valueOrDefault(input.turnScopeId, ""),
    eventListener: input.eventListener,
    persistenceScope: input.persistenceScope,
  };
}

function buildAgentMessageTurnInput(messageItem, input) {
  const contextPolicy = resolveToolContextPolicy(messageItem);
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    role: firstTruthyValue([messageItem.role], MESSAGE_ROLE.ASSISTANT),
    messageUid: stringValue(messageItem?.messageUid).trim(),
    modelMessageId: text(messageItem?.modelMessageId),
    userMessageId: text(messageItem?.userMessageId),
    presentationMessageId: stringValue(messageItem.presentationMessageId).trim(),
    ...(typeof messageItem.chatPresentation === "boolean"
      ? { chatPresentation: messageItem.chatPresentation }
      : {}),
    content: stringValue(messageItem.content),
    type: stringValue(messageItem.type),
    dialogProcessId: firstTruthyValue([
      text(messageItem?.dialogProcessId),
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
    ...(contextPolicy ? { contextPolicy } : {}),
    attachments: filterSessionAttachments(resolveMessageAttachments(messageItem)),
    modelAlias: text(messageItem.modelAlias),
    modelName: text(messageItem.modelName),
    summarized: messageItem.summarized === true,
    toolName: text(messageItem.toolName),
    rawModelContent: normalizedRawModelContent(messageItem.rawModelContent),
    modelAdditionalKwargs: normalizedOptionalObject(messageItem.modelAdditionalKwargs),
    injectedMessage: messageItem?.injectedMessage === true,
    noobotInternalMessageType: text(messageItem?.noobotInternalMessageType),
    injectedBy: text(messageItem?.injectedBy),
    injectedMessageType: text(messageItem?.injectedMessageType),
    relayCorrelationId: text(messageItem?.relayCorrelationId),
    ...(messageItem.interjectionSequence === undefined
      ? {}
      : { interjectionSequence: messageItem.interjectionSequence }),
    ...pickMessageOriginField(messageItem),
    pluginMessage: messageItem?.pluginMessage === true,
    pluginMeta: normalizedOptionalObject(messageItem.pluginMeta),
    transferEnvelopes: arrayValue(messageItem.transferEnvelopes),
    modelResponseMetadata: normalizedOptionalObject(messageItem.modelResponseMetadata),
    activityTimeline: arrayValue(messageItem.activityTimeline),
    toolTimeline: arrayValue(messageItem.toolTimeline),
    turnScopeId: stringValue(firstTruthyValue([messageItem.turnScopeId, input.turnScopeId])).trim(),
    ...pickSourceTimestampField(messageItem),
    eventListener: input.eventListener,
    persistenceScope: input.persistenceScope,
  };
}

export class SessionTurnPersister {
  constructor({ session = null } = {}) {
    this.session = session;
  }

  async _prepareTurnPayload(payload = {}) {
    const input = normalizeSessionTurnInput(payload);
    await tryAppendSessionTurnDiagnostics(this.session, input, buildFullTurnPayload(input));
    return buildTurnPayload(input);
  }

  async appendAgentMessages(payload = {}) {
    const input = normalizeAgentMessagesInput(payload);
    const turnPayloads = [];
    for (const messageItem of input.messages) {
      const turnPayload = await this._prepareTurnPayload(
        buildAgentMessageTurnInput(messageItem, input),
      );
      turnPayloads.push(turnPayload);
    }
    if (!turnPayloads.length) return [];
    const appendResult = await this.session.appendTurns({
      userId: input.userId,
      sessionId: input.sessionId,
      turns: turnPayloads,
      persistenceScope: input.persistenceScope,
    });
    if (!appendResult.appended) throw createTurnAppendRejectedError(appendResult, input);
    for (const turnPayload of turnPayloads) {
      emitEvent(input.eventListener, `${turnPayload.role}_message_saved`, {});
    }
    return appendResult.turns;
  }
}

function createTurnAppendRejectedError({ reason }, { userId, sessionId }) {
  if (reason === SESSION_DELETED_REASON)
    return createSessionDeletedError({ userId, sessionId, operation: "appendTurns" });
  if (reason === SESSION_NOT_FOUND_REASON) return createSessionNotFoundError({ userId, sessionId });
  const error = new Error(`session turn append was rejected: ${text(reason)}`);
  error.code = SESSION_ERROR_CODE.TURN_APPEND_REJECTED;
  return error;
}
