/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isInjectedSessionMessageRecord,
  projectSessionMessageRecordIdentity,
} from "@noobot/session-protocol";
import { projectToolOperationSummary } from "@noobot/event-protocol/tool-presentation";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import {
  mergeCanonicalActivityTimelines,
  selectCanonicalActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  pickLightAttachments,
  pickLightPluginMeta,
  pickLightTransferEnvelopes,
} from "./message-metadata-projection.js";
import { text, isPlainObject } from "@noobot/shared/value";

const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId"]);

export function compactThinkingTimeline(items = []) {
  const compactFact = (fact = {}, summary = "", result = null) => ({
    eventId: text(fact.eventId),
    sequence: fact.sequence,
    ...(text(fact.timestamp) ? { timestamp: String(fact.timestamp).trim() } : {}),
    ...(text(fact.sequenceScopeId) ? { sequenceScopeId: String(fact.sequenceScopeId).trim() } : {}),
    ...(text(fact.authority) ? { authority: String(fact.authority).trim() } : {}),
    ...(text(fact.sequenceDomain) ? { sequenceDomain: String(fact.sequenceDomain).trim() } : {}),
    ...(text(fact.sessionId) ? { sessionId: String(fact.sessionId).trim() } : {}),
    ...(text(fact.dialogProcessId) ? { dialogProcessId: String(fact.dialogProcessId).trim() } : {}),
    ...(text(fact.turnScopeId) ? { turnScopeId: String(fact.turnScopeId).trim() } : {}),
    ...(Array.isArray(fact.attachments) && fact.attachments.length
      ? { attachments: fact.attachments }
      : {}),
    ...(result ? { result } : {}),
    ...(summary ? { summary } : {}),
  });
  return (Array.isArray(items) ? items : []).map((item = {}) => ({
    key: text(item.key || item.toolCallId),
    toolCallId: text(item.toolCallId),
    tool: text(item.tool),
    status: text(item.status),
    ...(text(item.riskLevel) ? { riskLevel: String(item.riskLevel).trim() } : {}),
    ...(item.call
      ? {
          call: compactFact(
            item.call,
            projectToolOperationSummary(item.tool, item.args, { result: false }),
          ),
        }
      : {}),
    ...(item.resultEvent
      ? {
          result: item.result,
          resultEvent: compactFact(
            item.resultEvent,
            projectToolOperationSummary(item.tool, item.result, { result: true }),
          ),
        }
      : {}),
  }));
}

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
    content: message?.content || "",
    type: text(message?.type),
    dialogProcessId: text(message?.dialogProcessId),
    parentDialogProcessId: text(message?.parentDialogProcessId),
    taskId: text(message?.taskId),
    taskStatus: text(message?.taskStatus),
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
    "isMonotonic",
    "pluginMessage",
    "tool_call_id",
    "toolName",
    "turnScopeId",
    "thinkingStartedAt",
    "thinkingFinishedAt",
    "noobotInternalMessageType",
  ]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  return compactMessageSummary(summary);
}

export function buildThinkingDetailCountByMessage(messages = []) {
  const routeByMessage = new WeakMap();
  const factsByRoute = new Map();
  messages.forEach((message, index) => {
    if (!isPlainObject(message)) return;
    const turnScopeId = text(message?.turnScopeId);
    const dialogProcessId = text(message?.dialogProcessId);
    const route = turnScopeId
      ? `turn:${turnScopeId}`
      : dialogProcessId
        ? `dialog:${dialogProcessId}`
        : `message:${index}`;
    routeByMessage.set(message, route);
    const facts = factsByRoute.get(route) || { activityTimeline: [], toolTimeline: [] };
    facts.activityTimeline = mergeCanonicalActivityTimelines(
      facts.activityTimeline,
      message?.activityTimeline || [],
    );
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      if (!isPlainObject(item)) continue;
      const key = text(item?.key || item?.toolCallId);
      const existingIndex = key
        ? facts.toolTimeline.findIndex((entry) => text(entry?.key || entry?.toolCallId) === key)
        : -1;
      if (existingIndex >= 0) {
        facts.toolTimeline[existingIndex] = { ...facts.toolTimeline[existingIndex], ...item };
      } else {
        facts.toolTimeline.push(item);
      }
    }
    factsByRoute.set(route, facts);
  });
  return (message = {}) => {
    const facts = factsByRoute.get(routeByMessage.get(message));
    if (!facts) return 0;
    return countCanonicalThinkingDetailEvents(facts);
  };
}

const DISPLAY_ROLES = new Set(["user", "assistant"]);
const TOOL_MESSAGE_TYPES = new Set(["tool_call", "tool_result"]);
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
  const attachments = pickLightAttachments(message);
  if (attachments.length) summary.attachments = attachments;
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

export function buildDisplayMessageSummary(message = {}) {
  const presentation = resolveDisplayPresentation(message);
  if (!presentation) return null;
  const { type, hasActivity } = presentation;
  const summary = buildMessageSummary(message) || {};
  summary.content =
    typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
  if (hasActivity && message.chatPresentation !== true) {
    summary.type = "message";
    summary.chatPresentation = true;
    summary.sourceMessageType = type;
  }
  applyDisplayMetadata(summary, message);
  return compactMessageSummary(summary);
}
