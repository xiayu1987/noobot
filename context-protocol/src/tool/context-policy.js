/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

const TOOL_SEMANTIC_CLASS = Object.freeze({
  FLOW_CONTROL: "flow_control",
});

export const FLOW_CONTROL_ROLE = Object.freeze({
  CHECKPOINT_BOUNDARY: "checkpoint_boundary",
  CHECKPOINT_EVIDENCE: "checkpoint_evidence",
});

const flowControlRoles = new Set(Object.values(FLOW_CONTROL_ROLE));

export function createFlowControlContextPolicy(flowControlRole) {
  const normalizedRole = text(flowControlRole);
  if (!flowControlRoles.has(normalizedRole)) {
    throw new Error(`invalid flow-control role: ${normalizedRole || "missing"}`);
  }
  return Object.freeze({
    semanticClass: TOOL_SEMANTIC_CLASS.FLOW_CONTROL,
    flowControlRole: normalizedRole,
  });
}

function normalizeToolContextPolicy(value = null) {
  const candidate = isPlainObject(value) ? value : null;
  if (!candidate) return null;
  const semanticClass = text(candidate.semanticClass);
  const flowControlRole = text(candidate.flowControlRole);
  if (semanticClass !== TOOL_SEMANTIC_CLASS.FLOW_CONTROL) return null;
  if (!flowControlRoles.has(flowControlRole)) return null;
  return Object.freeze({ semanticClass, flowControlRole });
}

export function resolveToolContextPolicy(value = null) {
  if (!isPlainObject(value)) return null;
  return normalizeToolContextPolicy(
    value.contextPolicy || value.metadata?.contextPolicy || value.lc_kwargs?.contextPolicy,
  );
}

export function hasFlowControlRole(value = null, role = "") {
  return resolveToolContextPolicy(value)?.flowControlRole === text(role);
}

export function projectToolContextPolicy(target = {}, source = null) {
  const contextPolicy = resolveToolContextPolicy(source) || resolveToolContextPolicy(target);
  return contextPolicy ? { ...target, contextPolicy } : target;
}
