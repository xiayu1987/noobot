/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isInjectedSessionMessageRecord,
  projectSessionMessageRecordIdentity,
  TOOL_CALL_MESSAGE_TYPE,
  TOOL_RESULT_MESSAGE_TYPE,
} from "@noobot/session-protocol";
import { selectCanonicalActivityTimeline } from "@noobot/event-protocol/activity-timeline";
import {
  pickLightAttachments,
  pickLightPluginMeta,
  pickLightTransferEnvelopes,
} from "./message-metadata-projection.js";
import { text, isPlainObject } from "@noobot/shared/value";

const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId", "content"]);

function compactMessageSummary(summary = {}) {
  return Object.fromEntries(
    Object.entries(summary).filter(
      ([key, value]) => REQUIRED_MESSAGE_SUMMARY_KEYS.has(key) || value !== "",
    ),
  );
}

export function buildMessageSummary(message = {}) {
  if (!isPlainObject(message)) return null;
  const summary = {
    role: text(message?.role),
    content: message.content,
    type: text(message?.type),
    dialogProcessId: text(message?.dialogProcessId),
    parentDialogProcessId: text(message?.parentDialogProcessId),
    modelAlias: text(message?.modelAlias),
    modelName: text(message?.modelName),
    summarized: message?.summarized === true,
    ts: text(message?.ts),

    ...projectSessionMessageRecordIdentity(message),
  };
  for (const key of [
    "injectedMessage",
    "injectedBy",
    "injectedMessageType",
    "messageOrigin",
    "chatPresentation",
    "workspaceRootDirectory",
    "isMonotonic",
    "pluginMessage",
    "tool_call_id",
    "toolName",
    "turnScopeId",
    "noobotInternalMessageType",
  ]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  return compactMessageSummary(summary);
}

const DISPLAY_ROLES = new Set(["user", "assistant"]);
const TOOL_MESSAGE_TYPES = new Set([TOOL_CALL_MESSAGE_TYPE, TOOL_RESULT_MESSAGE_TYPE]);
const DISPLAY_PASSTHROUGH_KEYS = ["pluginMessage", "done", "pending", "error"];

function readDisplayRole(message) {
  if (!isPlainObject(message)) return "";
  const role = text(message.role);
  if (!role || isInjectedSessionMessageRecord(message)) return "";
  return DISPLAY_ROLES.has(role) ? role : "";
}

function isSuppressedDisplayMessage({ message, role, type, hasActivity }) {
  const isAssistant = role === "assistant";
  if (isAssistant && message.chatPresentation === false && !hasActivity) return true;
  if (TOOL_MESSAGE_TYPES.has(type) && !hasActivity) return true;
  return false;
}

function resolveDisplayPresentation(message) {
  const role = readDisplayRole(message);
  if (!role) return null;
  const type = text(message.type);
  const hasActivity = role === "assistant" && selectCanonicalActivityTimeline(message).length > 0;
  const presentation = { message, role, type, hasActivity };
  return isSuppressedDisplayMessage(presentation) ? null : presentation;
}

function projectDisplayToolCalls(toolCalls) {
  return toolCalls
    .map((toolCall = {}) => ({
      id: text(toolCall?.id),
      name: text(toolCall?.function?.name),
    }))
    .filter((item) => item.id || item.name);
}

function applyDisplayMetadata(summary, message) {
  summary.attachments = pickLightAttachments(message);
  for (const key of DISPLAY_PASSTHROUGH_KEYS) {
    if (message[key] !== undefined) summary[key] = message[key];
  }
  const pluginMeta = pickLightPluginMeta(message);
  const transferEnvelopes = pickLightTransferEnvelopes(message);
  if (pluginMeta) summary.pluginMeta = pluginMeta;
  if (transferEnvelopes.length) summary.transferEnvelopes = transferEnvelopes;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    summary.toolCalls = projectDisplayToolCalls(message.tool_calls);
  }
}

export function requiresDisplayMessageContent(message) {
  return resolveDisplayPresentation(message) !== null;
}

export function buildDisplayMessageSummary(message = {}) {
  const presentation = resolveDisplayPresentation(message);
  if (!presentation) return null;
  const { type, hasActivity } = presentation;
  const summary = buildMessageSummary(message) || {};
  if (hasActivity && message.chatPresentation !== true) {
    summary.type = "message";
    summary.chatPresentation = true;
    summary.sourceMessageType = type;
  }
  applyDisplayMetadata(summary, message);
  return compactMessageSummary(summary);
}
