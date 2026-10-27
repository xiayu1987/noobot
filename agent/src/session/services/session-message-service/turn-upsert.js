/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertCanonicalAssistantPresentation,
  canonicalAssistantPresentationIdentity,
  normalizeDialogProcessId,
  pickMessageOriginField,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
import { registerSessionMessageFacts } from "../../entities/session-message-facts.js";
import { getTransferAttachments } from "../../../transfer-adapter/storage/consumer.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { isPlainObject, text } from "@noobot/shared/value";

function normalizedString(value) {
  return text(value);
}

function optionalStringField(name, value) {
  const normalized = normalizedString(value);
  return normalized ? { [name]: normalized } : {};
}

function optionalArrayField(name, value) {
  return Array.isArray(value) && value.length ? { [name]: value } : {};
}

function resolvePluginMeta(value) {
  return isPlainObject(value) ? value : null;
}

function resolveTaskFields(session, input) {
  const taskId = input.taskId ?? session?.currentTaskId ?? "";
  return {
    taskId,
    taskStatus: input.taskStatus ?? (taskId ? "start" : ""),
  };
}

function resolveUserName(input) {
  return normalizedString(input.userName === undefined ? input.userId : input.userName);
}

function buildTurnEntity(service, session, resolvedParentSessionId, input) {
  const task = resolveTaskFields(session, input);
  const contextPolicy = resolveToolContextPolicy(input);
  const chatPresentation =
    typeof input.chatPresentation === "boolean" ? input.chatPresentation : undefined;
  return normalizeMessageEntity({
    role: input.role,
    messageUid: input.messageUid || "",
    ...optionalStringField("modelMessageId", input.modelMessageId),
    ...optionalStringField("userMessageId", input.userMessageId),
    ...optionalStringField("presentationMessageId", input.presentationMessageId),
    ...(chatPresentation === undefined ? {} : { chatPresentation }),
    content: input.content,
    type: input.type || "",
    userName: resolveUserName(input),
    sessionId: input.sessionId,
    parentSessionId: normalizedString(resolvedParentSessionId),
    dialogProcessId: normalizeDialogProcessId(input.dialogProcessId || ""),
    parentDialogProcessId: input.parentDialogProcessId || "",
    turnScopeId: normalizedString(input.turnScopeId),
    ...task,
    modelAlias: normalizedString(input.modelAlias),
    modelName: normalizedString(input.modelName),
    ...(contextPolicy ? { contextPolicy } : {}),
    summarized: input.summarized === true,
    rawModelContent: input.rawModelContent ?? null,
    modelAdditionalKwargs: input.modelAdditionalKwargs ?? null,
    modelResponseMetadata: input.modelResponseMetadata ?? null,
    ...optionalArrayField("activityTimeline", input.activityTimeline),
    ...optionalArrayField("toolTimeline", input.toolTimeline),
    injectedMessage: input.injectedMessage === true,
    noobotInternalMessageType: normalizedString(input.noobotInternalMessageType),
    injectedBy: normalizedString(input.injectedBy),
    injectedMessageType: normalizedString(input.injectedMessageType),
    relayCorrelationId: normalizedString(input.relayCorrelationId),
    ...(input.interjectionSequence === undefined
      ? {}
      : { interjectionSequence: input.interjectionSequence }),
    ...pickMessageOriginField(input),
    pluginMessage: input.pluginMessage === true,
    pluginMeta: resolvePluginMeta(input.pluginMeta),
    transferEnvelopes: Array.isArray(input.transferEnvelopes) ? input.transferEnvelopes : [],
    ts: input.ts === undefined ? service.now() : input.ts,
  });
}

function applyToolFields(turn, input) {
  if (input.tool_call_id) turn.tool_call_id = input.tool_call_id;
  if (input.toolName) turn.toolName = normalizedString(input.toolName);
  if (Array.isArray(input.tool_calls) && input.tool_calls.length) {
    turn.tool_calls = input.tool_calls;
  }
}

function resolvePreferredAttachments(turn, input) {
  const transferEnvelopes = [
    ...(Array.isArray(input.transferEnvelopes) ? input.transferEnvelopes : []),
    ...(Array.isArray(turn?.transferEnvelopes) ? turn.transferEnvelopes : []),
  ].filter(Boolean);
  const transferAttachments = getTransferAttachments(transferEnvelopes);
  if (Array.isArray(turn?.transferEnvelopes) && turn.transferEnvelopes.length) return [];
  if (transferAttachments.length) return dedupeAttachments(transferAttachments);
  return Array.isArray(input.attachments) ? input.attachments : [];
}

function applyAttachments(turn, input) {
  const attachments = resolvePreferredAttachments(turn, input);
  if (attachments.length) turn.attachments = attachments;
}

function createIdentityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function findPersistedTurnByMessageUid(messages, turn) {
  const messageUid = normalizedString(turn.messageUid);
  return {
    dialogProcessId: normalizeDialogProcessId(turn?.dialogProcessId),
    turnScopeId: normalizedString(turn?.turnScopeId),
    messageUid,
    existingIndex: messages.findIndex(
      (message = {}) => normalizedString(message?.messageUid) === messageUid,
    ),
  };
}

function assertMessageIdentityMatch(identity, existing = null) {
  if (!existing) return;
  if (
    resolveSessionMessageRecordDialogProcessId(existing) !== identity.dialogProcessId ||
    normalizedString(existing?.turnScopeId) !== identity.turnScopeId
  ) {
    throw createIdentityError(
      "messageUid does not belong to the requested dialog and turn",
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
    );
  }
}

function mergeExistingTurn(existing, turn) {
  return normalizeMessageEntity({
    ...existing,
    ...turn,
    messageUid: existing.messageUid,
    ts: existing.ts,
  });
}

function persistTurn(messages, turn) {
  const identity = findPersistedTurnByMessageUid(messages, turn);
  const existing = identity.existingIndex >= 0 ? messages[identity.existingIndex] : null;
  assertMessageIdentityMatch(identity, existing);
  const incomingPresentation = canonicalAssistantPresentationIdentity(turn);
  if (incomingPresentation) {
    assertCanonicalAssistantPresentation(turn);
    for (const message of messages) {
      const existingPresentation = canonicalAssistantPresentationIdentity(message);
      if (existingPresentation?.turnScopeId === incomingPresentation.turnScopeId) {
        message.chatPresentation = false;
      }
    }
  }
  if (existing) {
    const persisted = mergeExistingTurn(existing, turn);
    messages[identity.existingIndex] = persisted;
    return persisted;
  }
  const persisted = normalizeMessageEntity({ ...turn, messageUid: identity.messageUid });
  messages.push(persisted);
  return persisted;
}

function updateSessionMetadata(service, session) {
  session.updatedAt = service.now();
}

export function upsertTurnInSession(service, session, resolvedParentSessionId, input = {}) {
  const turn = buildTurnEntity(service, session, resolvedParentSessionId, input);
  applyToolFields(turn, input);
  applyAttachments(turn, input);
  const persistedTurn = persistTurn(session.messages, turn);
  registerSessionMessageFacts(session, persistedTurn);
  updateSessionMetadata(service, session);
  return persistedTurn;
}
