/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectToolOperationSummary } from "@noobot/event-protocol/tool-presentation";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import {
  pickLightAttachments,
  pickLightPluginMeta,
  pickLightTransferEnvelopes,
} from "./message-metadata-projection.js";

const REQUIRED_MESSAGE_SUMMARY_KEYS = new Set(["turnScopeId"]);

export function compactThinkingTimeline(items = []) {
  const compactFact = (fact = {}, summary = "", result = null) => ({
    eventId: String(fact.eventId || "").trim(),
    sequence: fact.sequence,
    ...(String(fact.sequenceScopeId || "").trim()
      ? { sequenceScopeId: String(fact.sequenceScopeId).trim() }
      : {}),
    ...(String(fact.authority || "").trim() ? { authority: String(fact.authority).trim() } : {}),
    ...(String(fact.sequenceDomain || "").trim()
      ? { sequenceDomain: String(fact.sequenceDomain).trim() }
      : {}),
    ...(String(fact.sessionId || "").trim() ? { sessionId: String(fact.sessionId).trim() } : {}),
    ...(String(fact.dialogProcessId || "").trim()
      ? { dialogProcessId: String(fact.dialogProcessId).trim() }
      : {}),
    ...(String(fact.turnScopeId || "").trim()
      ? { turnScopeId: String(fact.turnScopeId).trim() }
      : {}),
    ...(Array.isArray(fact.attachments) && fact.attachments.length
      ? { attachments: fact.attachments }
      : {}),
    ...(result ? { result } : {}),
    ...(summary ? { summary } : {}),
  });
  return (Array.isArray(items) ? items : []).map((item = {}) => ({
    key: String(item.key || item.toolCallId || item.tool_call_id || "").trim(),
    toolCallId: String(item.toolCallId || item.tool_call_id || "").trim(),
    tool: String(item.tool || "").trim(),
    status: String(item.status || "").trim(),
    ...(String(item.riskLevel || "").trim() ? { riskLevel: String(item.riskLevel).trim() } : {}),
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
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const summary = {
    role: String(message?.role || "").trim(),
    content: message?.content || "",
    type: String(message?.type || "").trim(),
    dialogProcessId: String(message?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
    taskId: String(message?.taskId || "").trim(),
    taskStatus: String(message?.taskStatus || "").trim(),
    modelAlias: String(message?.modelAlias || "").trim(),
    modelName: String(message?.modelName || "").trim(),
    summarized: message?.summarized === true,
    ts: String(message?.ts || "").trim(),
  };
  for (const key of [
    "injectedMessage",
    "injectedBy",
    "injectedMessageType",
    "frontendUserMessage",
    "chatPresentation",
    "presentationMessageId",
    "isMonotonic",
    "monotonic",
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
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const turnScopeId = String(message?.turnScopeId || "").trim();
    const dialogProcessId = String(message?.dialogProcessId || "").trim();
    const route = turnScopeId
      ? `turn:${turnScopeId}`
      : dialogProcessId
        ? `dialog:${dialogProcessId}`
        : `message:${index}`;
    routeByMessage.set(message, route);
    const facts = factsByRoute.get(route) || { activityTimeline: [], toolTimeline: [] };
    for (const item of Array.isArray(message?.activityTimeline) ? message.activityTimeline : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const key = String(item?.eventId || item?.id || "").trim();
      const existingIndex = key
        ? facts.activityTimeline.findIndex((entry) =>
            String(entry?.eventId || entry?.id || "").trim() === key)
        : -1;
      if (existingIndex >= 0) facts.activityTimeline[existingIndex] = item;
      else facts.activityTimeline.push(item);
    }
    for (const item of Array.isArray(message?.toolTimeline) ? message.toolTimeline : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const key = String(item?.key || item?.toolCallId || item?.tool_call_id || "").trim();
      const existingIndex = key
        ? facts.toolTimeline.findIndex((entry) =>
            String(entry?.key || entry?.toolCallId || entry?.tool_call_id || "").trim() === key)
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

export function buildDisplayMessageSummary(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const role = String(message?.role || "").trim();
  if (!role || message?.injectedMessage === true) return null;
  const type = String(message?.type || "").trim();
  if (!["user", "assistant"].includes(role)) return null;
  const hasCanonicalActivity =
    role === "assistant" &&
    String(message?.presentationMessageId || "").trim() &&
    Array.isArray(message?.activityTimeline) &&
    message.activityTimeline.length > 0;
  if (role === "assistant" && message?.chatPresentation === false && !hasCanonicalActivity)
    return null;
  if (["tool_call", "tool_result"].includes(type) && !hasCanonicalActivity) return null;
  const presentationMessageId = String(message?.presentationMessageId || "").trim();
  if (
    role === "assistant" &&
    (message?.chatPresentation === true || hasCanonicalActivity) &&
    !presentationMessageId
  )
    return null;
  const summary = buildMessageSummary(message) || {};
  summary.content =
    typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
  if (hasCanonicalActivity && message?.chatPresentation !== true) {
    summary.type = "message";
    summary.chatPresentation = true;
    summary.sourceMessageType = type;
  }
  const messageUid = String(message?.messageUid || "").trim();
  const sourceMessageId = String(message?.messageId || message?.id || "").trim();
  const messageId = String(presentationMessageId || sourceMessageId || messageUid).trim();
  if (messageId) {
    summary.id = messageId;
    summary.messageId = messageId;
  }
  if (presentationMessageId) {
    if (sourceMessageId && presentationMessageId !== sourceMessageId) {
      summary.sourceMessageId = sourceMessageId;
    }
    if (messageUid) summary.sourceMessageUid = messageUid;
  } else if (messageUid) {
    summary.messageUid = messageUid;
  }
  const attachments = pickLightAttachments(message);
  if (attachments.length) summary.attachments = attachments;
  for (const key of ["pluginMessage", "done", "pending", "error"]) {
    if (message?.[key] !== undefined) summary[key] = message[key];
  }
  const pluginMeta = pickLightPluginMeta(message);
  const transferEnvelopes = pickLightTransferEnvelopes(message);
  if (pluginMeta) summary.pluginMeta = pluginMeta;
  if (transferEnvelopes.length) summary.transferEnvelopes = transferEnvelopes;
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    summary.toolCalls = message.tool_calls
      .map((toolCall = {}) => ({
        id: String(toolCall?.id || "").trim(),
        name: String(toolCall?.function?.name || toolCall?.name || "").trim(),
      }))
      .filter((item) => item.id || item.name);
  }
  return compactMessageSummary(summary);
}
