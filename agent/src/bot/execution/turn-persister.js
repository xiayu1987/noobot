/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isPlainObject, text } from "@noobot/shared/value";
import {
  isCanonicalMessageTimestamp,
  normalizeDialogProcessId,
  pickMessageOriginField,
} from "@noobot/session-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { emitEvent } from "../../events/index.js";
import { compactTransferEnvelopes } from "../../session/transfer-attachment-refs.js";
import { EXECUTION_LOG_EVENT, MESSAGE_ROLE } from "../config/constants.js";
import { summarizeSessionTurnPayload } from "./turn-payload-summary.js";
import { shouldRecordRuntimeExecutionLog } from "@noobot/shared/runtime-events-config";

function pickSourceTimestampField(source) {
  if (source.ts === undefined) return {};
  if (!isCanonicalMessageTimestamp(source.ts)) {
    throw new TypeError("session turn ts must be a canonical ISO timestamp");
  }
  return { ts: source.ts };
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

function toolCallsField(source) {
  return Object.hasOwn(source, "tool_calls") ? { tool_calls: source.tool_calls } : {};
}

function workspaceRootField(source) {
  return source.workspaceRootDirectory === undefined
    ? {}
    : { workspaceRootDirectory: source.workspaceRootDirectory };
}

function normalizedRawModelContent(value) {
  return typeof value === "string" || Array.isArray(value) ? value : null;
}

function runtimeMessageList(messageItem, name) {
  const value = messageItem[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`runtime message ${name} must be an array`);
  return value;
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
    tool_call_id: valueOrDefault(input.tool_call_id, ""),
    attachments: input.attachments,
    modelAlias: valueOrDefault(input.modelAlias, ""),
    modelName: valueOrDefault(input.modelName, ""),
    summarized: input.summarized === true,
    toolName: valueOrDefault(input.toolName, ""),
    contextPolicy: resolveToolContextPolicy(input),
    rawModelContent: valueOrDefault(input.rawModelContent, null),
    modelAdditionalKwargs: valueOrDefault(input.modelAdditionalKwargs, null),
    modelResponseMetadata: valueOrDefault(input.modelResponseMetadata, null),
    activityTimeline: runtimeMessageList(input, "activityTimeline"),
    toolTimeline: runtimeMessageList(input, "toolTimeline"),
    resourceRefs: runtimeMessageList(input, "resourceRefs"),
    mutationRefs: runtimeMessageList(input, "mutationRefs"),
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
    transferEnvelopes: compactTransferEnvelopes(input.transferEnvelopes),
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
    dialogProcessId: input.dialogProcessId,
    parentDialogProcessId: stringValue(input.parentDialogProcessId),
    turnScopeId: input.turnScopeId,
    ...toolCallsField(input),
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

function buildSessionTurnDiagnostic(now, input) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    dialogProcessId: input.dialogProcessId,
    turnScopeId: input.turnScopeId,
    event: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    category: MESSAGE_ROLE.SYSTEM,
    type: EXECUTION_LOG_EVENT.SESSION_TURN_FULL,
    data: summarizeSessionTurnPayload(buildFullTurnPayload(input)),
    ts: now(),
  };
}

function prepareSessionTurnDiagnostics(now, prepared) {
  if (!shouldRecordRuntimeExecutionLog({ event: EXECUTION_LOG_EVENT.SESSION_TURN_FULL })) return [];
  return prepared.map((message) => ({
    messageUid: message.messageUid,
    record: buildSessionTurnDiagnostic(now, message),
  }));
}

function buildTurnPayload(input) {
  return {
    role: input.role,
    messageUid: input.messageUid,
    modelMessageId: input.modelMessageId,
    userMessageId: input.userMessageId,
    presentationMessageId: input.presentationMessageId,
    chatPresentation: input.chatPresentation,
    ...workspaceRootField(input),
    content: String(input.content || ""),
    type: input.type,
    userName: input.userName,
    dialogProcessId: input.dialogProcessId,
    parentDialogProcessId: input.parentDialogProcessId,
    turnScopeId: input.turnScopeId,
    ...toolCallsField(input),
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
    activityTimeline: input.activityTimeline,
    toolTimeline: input.toolTimeline,
    ...optionalListField("resourceRefs", input.resourceRefs),
    ...optionalListField("mutationRefs", input.mutationRefs),
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
    transferEnvelopes: input.transferEnvelopes,
    ...pickSourceTimestampField(input),
  };
}

function normalizeAgentMessagesInput(input = {}) {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    messages: valueOrDefault(input.messages, []),
    submission: input.submission,
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
    ...workspaceRootField(messageItem),
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
    ...toolCallsField(messageItem),
    tool_call_id: stringValue(messageItem.tool_call_id),
    ...(contextPolicy ? { contextPolicy } : {}),
    attachments: runtimeMessageList(messageItem, "attachments"),
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
    transferEnvelopes: runtimeMessageList(messageItem, "transferEnvelopes"),
    modelResponseMetadata: normalizedOptionalObject(messageItem.modelResponseMetadata),
    activityTimeline: runtimeMessageList(messageItem, "activityTimeline"),
    toolTimeline: runtimeMessageList(messageItem, "toolTimeline"),
    resourceRefs: runtimeMessageList(messageItem, "resourceRefs"),
    mutationRefs: runtimeMessageList(messageItem, "mutationRefs"),
    turnScopeId: stringValue(firstTruthyValue([messageItem.turnScopeId, input.turnScopeId])).trim(),
    ...pickSourceTimestampField(messageItem),
    eventListener: input.eventListener,
    persistenceScope: input.persistenceScope,
  };
}

function prepareAgentMessageInputs(input) {
  return input.messages.map((message) =>
    normalizeSessionTurnInput(buildAgentMessageTurnInput(message, input)),
  );
}

export class SessionTurnPersister {
  constructor({ session = null, now }) {
    if (!isFunction(now)) {
      throw new TypeError("SessionTurnPersister requires now function");
    }
    this.session = session;
    this.now = now;
  }

  prepareAgentMessages(payload = {}) {
    const input = normalizeAgentMessagesInput(payload);
    return prepareAgentMessageInputs(input).map(buildTurnPayload);
  }

  async appendAgentMessages({ changes, messages, ...payload }) {
    const input = normalizeAgentMessagesInput(payload);
    const prepared = prepareAgentMessageInputs({ ...input, messages: changes.messages });
    const turnPayloads = prepared.map(buildTurnPayload);
    const appendResult = await this.session.appendTurns({
      userId: input.userId,
      sessionId: input.sessionId,
      turns: turnPayloads,
      messageDiagnostics: prepareSessionTurnDiagnostics(this.now, prepared),
      messageContentAppends: changes.messageContentAppends,
      messageMetadataUpdates: changes.messageMetadataUpdates,
      submission: input.submission,
      persistenceScope: input.persistenceScope,
    });
    for (const message of messages) {
      emitEvent(input.eventListener, `${message.role}_message_saved`, {});
    }
    return appendResult.messageReceipts;
  }
}
