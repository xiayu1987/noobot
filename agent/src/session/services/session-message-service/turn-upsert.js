/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDialogProcessId, pickMessageOriginField } from "@noobot/session-protocol";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { normalizeMessageEntity } from "../../entities/message-entity.js";
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

export function buildTurnEntity(service, resolvedParentSessionId, input) {
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
