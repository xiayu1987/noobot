/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDialogProcessId } from "@noobot/session-protocol";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { createSessionMessageUid, normalizeMessageEntity } from "../../entities/session-entity.js";
import { getTransferAttachments } from "../../../transfer-adapter/storage/consumer.js";
import { dedupeAttachments } from "./attachment-helpers.js";
import { upsertSessionTurnTiming } from "./turn-timing.js";

function normalizedString(value) {
  return String(value || "").trim();
}

function optionalStringField(name, value) {
  const normalized = normalizedString(value);
  return normalized ? { [name]: normalized } : {};
}

function optionalArrayField(name, value) {
  return Array.isArray(value) && value.length ? { [name]: value } : {};
}

function resolvePluginMeta(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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
  return normalizeMessageEntity(
    {
      role: input.role,
      messageUid: input.messageUid || "",
      messageId: input.messageId || "",
      ...optionalStringField("presentationMessageId", input.presentationMessageId),
      ...(input.role === "assistant" ? { chatPresentation: input.chatPresentation === true } : {}),
      content: input.content,
      type: input.type || "",
      userName: resolveUserName(input),
      sessionId: normalizedString(input.sessionId),
      parentSessionId: normalizedString(resolvedParentSessionId),
      dialogProcessId: normalizeDialogProcessId(input.dialogProcessId || ""),
      parentDialogProcessId: input.parentDialogProcessId || "",
      turnScopeId: normalizedString(input.turnScopeId),
      ...task,
      modelAlias: normalizedString(input.modelAlias),
      modelName: normalizedString(input.modelName),
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
      frontendUserMessage: input.frontendUserMessage === true,
      pluginMessage: input.pluginMessage === true,
      pluginMeta: resolvePluginMeta(input.pluginMeta),
      transferEnvelopes: Array.isArray(input.transferEnvelopes) ? input.transferEnvelopes : [],
      ...optionalStringField("thinkingStartedAt", input.thinkingStartedAt),
      ...optionalStringField("thinkingFinishedAt", input.thinkingFinishedAt),
      ts: service.now(),
    },
    service.now,
  );
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

function findCompositeIdentityIndex(messages, turn, dialogProcessId, turnScopeId) {
  if (!turn.messageId) return -1;
  return messages.findIndex(
    (message = {}) =>
      normalizedString(message?.messageId || message?.id) === turn.messageId &&
      resolveContextMessageDialogProcessId(message) === dialogProcessId &&
      normalizedString(message?.turnScopeId) === turnScopeId,
  );
}

function findPersistedTurn(messages, turn) {
  const dialogProcessId = resolveContextMessageDialogProcessId(turn);
  const turnScopeId = normalizedString(turn?.turnScopeId);
  const messageUid = normalizedString(turn.messageUid);
  const compositeIdentityIndex = findCompositeIdentityIndex(
    messages,
    turn,
    dialogProcessId,
    turnScopeId,
  );
  const existingIndex = messageUid
    ? messages.findIndex((message = {}) => normalizedString(message?.messageUid) === messageUid)
    : compositeIdentityIndex;
  return { compositeIdentityIndex, dialogProcessId, existingIndex, messageUid, turnScopeId };
}

function createIdentityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertMessageIdentityMatch(identity, existing = null) {
  if (identity.messageUid && identity.existingIndex < 0 && identity.compositeIdentityIndex >= 0) {
    throw createIdentityError(
      "messageUid does not match the persisted runtime message identity",
      "SESSION_MESSAGE_UID_MISMATCH",
    );
  }
  if (!existing || !identity.messageUid) return;
  if (
    resolveContextMessageDialogProcessId(existing) !== identity.dialogProcessId ||
    normalizedString(existing?.turnScopeId) !== identity.turnScopeId
  ) {
    throw createIdentityError(
      "messageUid does not belong to the requested dialog and turn",
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
    );
  }
}

function mergeExistingTurn(service, existing, turn, messageUid) {
  return normalizeMessageEntity(
    {
      ...existing,
      ...turn,
      messageUid: existing.messageUid || messageUid || createSessionMessageUid(),
      id: turn.messageId,
      messageId: turn.messageId,
      ts: existing.ts || turn.ts,
    },
    service.now,
  );
}

function persistTurn(service, messages, turn) {
  const identity = findPersistedTurn(messages, turn);
  const existing = identity.existingIndex >= 0 ? messages[identity.existingIndex] || {} : null;
  assertMessageIdentityMatch(identity, existing);
  if (existing) {
    const persisted = mergeExistingTurn(service, existing, turn, identity.messageUid);
    messages[identity.existingIndex] = persisted;
    return persisted;
  }
  const persisted = normalizeMessageEntity(
    { ...turn, messageUid: identity.messageUid || createSessionMessageUid() },
    service.now,
  );
  messages.push(persisted);
  return persisted;
}

function resolveTimingField(input, field, fallbackField) {
  return input[field] === undefined ? input[fallbackField] : input[field];
}

function updateSessionMetadata(service, session, turn, input) {
  upsertSessionTurnTiming(session, {
    turnScopeId: turn.turnScopeId,
    dialogProcessId: resolveContextMessageDialogProcessId(turn),
    thinkingStartedAt: resolveTimingField(
      input,
      "turnTimingThinkingStartedAt",
      "thinkingStartedAt",
    ),
    thinkingFinishedAt: resolveTimingField(
      input,
      "turnTimingThinkingFinishedAt",
      "thinkingFinishedAt",
    ),
  });
  session.updatedAt = service.now();
  if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
}

export function upsertTurnInSession(service, session, resolvedParentSessionId, input = {}) {
  const turn = buildTurnEntity(service, session, resolvedParentSessionId, input);
  applyToolFields(turn, input);
  applyAttachments(turn, input);
  session.messages = Array.isArray(session.messages) ? session.messages : [];
  const persistedTurn = persistTurn(service, session.messages, turn);
  updateSessionMetadata(service, session, turn, input);
  return persistedTurn;
}
