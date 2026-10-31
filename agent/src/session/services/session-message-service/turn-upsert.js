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
import { selectUntransferredAttachments } from "@noobot/semantic-transfer-protocol";
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

function resolveUserName(input) {
  return normalizedString(input.userName === undefined ? input.userId : input.userName);
}

function buildTurnEntity(service, resolvedParentSessionId, input) {
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
    ...(input.workspaceRootDirectory === undefined
      ? {}
      : { workspaceRootDirectory: input.workspaceRootDirectory }),
    content: input.content,
    type: input.type || "",
    userName: resolveUserName(input),
    sessionId: input.sessionId,
    parentSessionId: normalizedString(resolvedParentSessionId),
    dialogProcessId: normalizeDialogProcessId(input.dialogProcessId || ""),
    parentDialogProcessId: input.parentDialogProcessId || "",
    turnScopeId: normalizedString(input.turnScopeId),
    modelAlias: normalizedString(input.modelAlias),
    modelName: normalizedString(input.modelName),
    ...(contextPolicy ? { contextPolicy } : {}),
    ...(input.tool_call_id ? { tool_call_id: input.tool_call_id } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(Object.hasOwn(input, "tool_calls") ? { tool_calls: input.tool_calls } : {}),
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
    transferEnvelopes: input.transferEnvelopes,
    attachments: resolveTurnAttachments(input),
    ts: input.ts === undefined ? service.now() : input.ts,
  });
}

function resolveTurnAttachments(input) {
  if (!Array.isArray(input.attachments) || !Array.isArray(input.transferEnvelopes)) {
    throw new TypeError("session turn attachments and transferEnvelopes must be arrays");
  }
  return selectUntransferredAttachments(input.attachments, input.transferEnvelopes);
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
  const merged = {
    ...existing,
    ...turn,
    messageUid: existing.messageUid,
    ts: existing.ts,
  };
  if (merged.chatPresentation === false) delete merged.workspaceRootDirectory;
  return normalizeMessageEntity(merged);
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
      if (
        message !== existing &&
        existingPresentation?.turnScopeId === incomingPresentation.turnScopeId
      ) {
        message.chatPresentation = false;
        delete message.workspaceRootDirectory;
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
  const turn = buildTurnEntity(service, resolvedParentSessionId, input);
  const persistedTurn = persistTurn(session.messages, turn);
  registerSessionMessageFacts(session, persistedTurn);
  updateSessionMetadata(service, session);
  return persistedTurn;
}
