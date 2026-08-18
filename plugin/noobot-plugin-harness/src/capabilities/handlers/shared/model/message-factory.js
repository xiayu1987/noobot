/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/assembly/dual-lane";
import { projectAuxiliaryHistoryMessages } from "@noobot/context-protocol/assembly/auxiliary-history";
import {
  buildContentOriginKey,
  MESSAGE_ORIGIN_KIND,
  markMessageAsContext,
  markMessageAsProtocol,
  resolveRawMessageSourceId,
  resolveMessageOriginKey,
} from "./message-metadata.js";

function markContextOriginFromNormalized(message = {}, normalized = {}) {
  const originKey =
    resolveMessageOriginKey(normalized, MESSAGE_ORIGIN_KIND.CONTEXT) ||
    buildContentOriginKey({
      prefix: "rewritten-context",
      role: message?.role,
      content: message?.content,
    });
  return markMessageAsContext(message, originKey);
}

function markProtocolMessage(message = {}, prefix = "protocol") {
  return markMessageAsProtocol(
    message,
    buildContentOriginKey({
      prefix,
      role: message?.role,
      content: message?.content,
    }),
  );
}

function normalizeModelMessageRole(role = "", fallback = "user") {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function normalizeTextList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isSystemLikeRole(role = "") {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  return normalized === "system" || normalized === "developer";
}

export function buildCapabilityModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  constraints = [],
  task = "",
  postTaskSystemMessages = [],
  postTaskMessages = [],
  taskRole = "user",
  postTaskRole = "user",
} = {}) {
  const normalizedTask = String(task || "").trim();
  const normalizedPostTaskSystemMessages = normalizeTextList(postTaskSystemMessages);
  const normalizedPostTaskMessages = normalizeTextList(postTaskMessages);
  const flattenedAgentMessages = projectAuxiliaryHistoryMessages(agentMessages, {
    decorateMessage: (normalized, source) => {
      const sourceMessageId = resolveRawMessageSourceId(source);
      if (sourceMessageId) markMessageAsContext(normalized, sourceMessageId);
      return markContextOriginFromNormalized(normalized, source);
    },
  });
  const constraintMessages = normalizeTextList(constraints).map((content) =>
    markProtocolMessage({ role: "system", content }, "constraint"),
  );
  const protocolSystemMessages = [...constraintMessages];
  const taskMessages = [];
  const resolvedTaskRole = normalizeModelMessageRole(taskRole, "user");
  const resolvedPostTaskRole = normalizeModelMessageRole(postTaskRole, resolvedTaskRole);
  if (normalizedTask) {
    const target = isSystemLikeRole(resolvedTaskRole) ? protocolSystemMessages : taskMessages;
    target.push(markProtocolMessage({ role: resolvedTaskRole, content: normalizedTask }, "task"));
  }
  for (const content of normalizedPostTaskSystemMessages) {
    protocolSystemMessages.push(markProtocolMessage({ role: "system", content }, "post-system"));
  }
  for (const content of normalizedPostTaskMessages) {
    const target = isSystemLikeRole(resolvedPostTaskRole) ? protocolSystemMessages : taskMessages;
    target.push(markProtocolMessage({ role: resolvedPostTaskRole, content }, "post-message"));
  }
  return buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.AUXILIARY,
    sourceMessages: flattenedAgentMessages,
    protocolSystemMessages,
    taskMessages,
  }).messages;
}

export function buildCapabilityProtocolModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  contextMessages = [],
  protocolPrompt = "",
  workflowPolicyPrompt = "",
  responsibilityPrompt = "",
} = {}) {
  const userMessages = [
    ...normalizeTextList(contextMessages),
    ...normalizeTextList([responsibilityPrompt]),
  ];
  return buildCapabilityModelMessages({
    locale,
    agentMessages,
    constraints: [],
    task: protocolPrompt,
    taskRole: "system",
    postTaskSystemMessages: [workflowPolicyPrompt],
    postTaskMessages: userMessages,
    postTaskRole: "user",
  });
}
