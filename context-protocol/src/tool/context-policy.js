/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TOOL_SEMANTIC_CLASS = Object.freeze({
  FLOW_CONTROL: "flow_control",
});

export const FLOW_CONTROL_ROLE = Object.freeze({
  CHECKPOINT_BOUNDARY: "checkpoint_boundary",
  CHECKPOINT_EVIDENCE: "checkpoint_evidence",
});

const flowControlRoles = new Set(Object.values(FLOW_CONTROL_ROLE));

export function createFlowControlContextPolicy(flowControlRole) {
  const normalizedRole = String(flowControlRole || "").trim();
  if (!flowControlRoles.has(normalizedRole)) {
    throw new Error(`invalid flow-control role: ${normalizedRole || "missing"}`);
  }
  return Object.freeze({
    semanticClass: TOOL_SEMANTIC_CLASS.FLOW_CONTROL,
    flowControlRole: normalizedRole,
  });
}

export function normalizeToolContextPolicy(value = null) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!candidate) return null;
  const semanticClass = String(candidate.semanticClass || "").trim();
  const flowControlRole = String(candidate.flowControlRole || "").trim();
  if (semanticClass !== TOOL_SEMANTIC_CLASS.FLOW_CONTROL) return null;
  if (!flowControlRoles.has(flowControlRole)) return null;
  return Object.freeze({ semanticClass, flowControlRole });
}

export function resolveToolContextPolicy(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return normalizeToolContextPolicy(
    value.contextPolicy || value.metadata?.contextPolicy || value.lc_kwargs?.contextPolicy,
  );
}

export function hasFlowControlRole(value = null, role = "") {
  return resolveToolContextPolicy(value)?.flowControlRole === String(role || "").trim();
}

export function projectToolCallContextPolicy(call = {}, tool = null) {
  const contextPolicy = resolveToolContextPolicy(tool) || resolveToolContextPolicy(call);
  return contextPolicy ? { ...call, contextPolicy } : call;
}
