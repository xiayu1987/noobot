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
  AUXILIARY_SEQUENCE_MESSAGE_KIND,
  declareAuxiliarySequenceIdentity,
} from "@noobot/context-protocol/assembly/auxiliary-sequence";
import { resolveContextMessageId } from "@noobot/context-protocol/message/codec";

function markContextMessage(message = {}, source = {}) {
  const sourceMessageId = resolveContextMessageId(source);
  if (!sourceMessageId) {
    throw new TypeError("Harness auxiliary Context message requires canonical message identity");
  }
  Object.defineProperty(message, "noobotMessageId", {
    value: sourceMessageId,
    enumerable: false,
    configurable: true,
  });
  return declareAuxiliarySequenceIdentity(message, {
    kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT,
    key: sourceMessageId,
  });
}

function markStableProtocolMessage(message = {}, key = "") {
  return declareAuxiliarySequenceIdentity(message, {
    kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.STABLE_PROTOCOL,
    key,
  });
}

function markRequestMessage(message = {}) {
  return declareAuxiliarySequenceIdentity(message, {
    kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST,
  });
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
    decorateMessage: (normalized, source) => markContextMessage(normalized, source),
  });
  const constraintMessages = normalizeTextList(constraints).map((content, index) =>
    markStableProtocolMessage({ role: "system", content }, `constraint:${index}`),
  );
  const protocolSystemMessages = [...constraintMessages];
  const taskMessages = [];
  const resolvedTaskRole = normalizeModelMessageRole(taskRole, "user");
  const resolvedPostTaskRole = normalizeModelMessageRole(postTaskRole, resolvedTaskRole);
  if (normalizedTask) {
    const target = isSystemLikeRole(resolvedTaskRole) ? protocolSystemMessages : taskMessages;
    target.push(
      isSystemLikeRole(resolvedTaskRole)
        ? markStableProtocolMessage({ role: resolvedTaskRole, content: normalizedTask }, "task")
        : markRequestMessage({ role: resolvedTaskRole, content: normalizedTask }),
    );
  }
  for (const [index, content] of normalizedPostTaskSystemMessages.entries()) {
    protocolSystemMessages.push(
      markStableProtocolMessage({ role: "system", content }, `post-system:${index}`),
    );
  }
  for (const [index, content] of normalizedPostTaskMessages.entries()) {
    const target = isSystemLikeRole(resolvedPostTaskRole) ? protocolSystemMessages : taskMessages;
    target.push(
      isSystemLikeRole(resolvedPostTaskRole)
        ? markStableProtocolMessage(
            { role: resolvedPostTaskRole, content },
            `post-message:${index}`,
          )
        : markRequestMessage({ role: resolvedPostTaskRole, content }),
    );
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
