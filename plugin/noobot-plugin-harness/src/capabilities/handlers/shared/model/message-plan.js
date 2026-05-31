/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildCapabilityModelMessages } from "./message-factory.js";

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
  return (Array.isArray(plan) ? plan : []).map((item = {}) => ({
    role: String(item.injectRole || "").trim() || "system",
    content: String(item.content || "").trim(),
  }));
}

export function renderMessagePlanForSeparateModel({
  locale = "zh-CN",
  agentMessages = [],
  plan = [],
} = {}) {
  const normalizedPlan = Array.isArray(plan) ? plan : [];
  const constraints = [];
  const tasks = [];
  for (const item of normalizedPlan) {
    const role = String(item?.separateRole || "").trim();
    const content = String(item?.content || "").trim();
    if (!content) continue;
    if (role === "task") {
      tasks.push(content);
      continue;
    }
    constraints.push(content);
  }
  return buildCapabilityModelMessages({
    locale,
    agentMessages,
    constraints,
    task: tasks[0] || "",
    postTaskMessages: tasks.slice(1),
  });
}
