/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildCapabilityProtocolModelMessages } from "./message-factory.js";
import { text } from "@noobot/shared/value";

export function createMessagePlan(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      kind: text(item?.kind),
      content: text(item?.content),
      injectRole: text(item?.injectRole) || "system",
      separateRole: text(item?.separateRole) || "constraint",
    }))
    .filter((item = {}) => item.kind && item.content);
}

export function renderMessagePlanForInject(plan = []) {
  return (Array.isArray(plan) ? plan : [])
    .filter((item = {}) => text(item?.separateRole) !== "workflow_policy")
    .map((item = {}) => ({
      kind: text(item.kind),
      role: text(item.injectRole) || "system",
      content: text(item.content),
    }));
}

export function renderMessagePlanForSeparateModel({
  locale = "zh-CN",
  agentMessages = [],
  plan = [],
  workflowPolicyPrompt = "",
} = {}) {
  const normalizedPlan = Array.isArray(plan) ? plan : [];
  const constraints = [];
  const tasks = [];
  const workflowPolicies = [];
  for (const item of normalizedPlan) {
    const role = text(item?.separateRole);
    const content = text(item?.content);
    if (!content) continue;
    if (role === "task") {
      tasks.push(content);
      continue;
    }
    if (role === "workflow_policy") {
      workflowPolicies.push(content);
      continue;
    }
    constraints.push(content);
  }
  return buildCapabilityProtocolModelMessages({
    locale,
    agentMessages,
    contextMessages: constraints,
    protocolPrompt: tasks[0] || "",
    workflowPolicyPrompt: workflowPolicyPrompt || workflowPolicies.join("\n\n"),
    responsibilityPrompt: tasks.slice(1).join("\n\n"),
  });
}
