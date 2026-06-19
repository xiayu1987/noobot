/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildCapabilityProtocolModelMessages } from "./message-factory.js";

export function createMessagePlan(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      kind: String(item?.kind || "").trim(),
      content: String(item?.content || "").trim(),
      injectRole: String(item?.injectRole || "").trim() || "system",
      separateRole: String(item?.separateRole || "").trim() || "constraint",
    }))
    .filter((item = {}) => item.kind && item.content);
}

export function renderMessagePlanForInject(plan = []) {
  return (Array.isArray(plan) ? plan : [])
    .filter((item = {}) => String(item?.separateRole || "").trim() !== "workflow_policy")
    .map((item = {}) => ({
      kind: String(item.kind || "").trim(),
      role: String(item.injectRole || "").trim() || "system",
      content: String(item.content || "").trim(),
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
    const role = String(item?.separateRole || "").trim();
    const content = String(item?.content || "").trim();
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
