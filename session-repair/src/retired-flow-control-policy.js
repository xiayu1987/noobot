/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const RETIRED_FLOW_CONTROL_ROLE = "checkpoint_boundary";

export function withoutRetiredFlowControlPolicy(value) {
  if (value?.contextPolicy?.flowControlRole !== RETIRED_FLOW_CONTROL_ROLE) return value;
  const next = { ...value };
  delete next.contextPolicy;
  return next;
}

export function withoutRetiredToolCallPolicies(calls) {
  if (!Array.isArray(calls)) return calls;
  const next = calls.map(withoutRetiredFlowControlPolicy);
  return next.some((call, index) => call !== calls[index]) ? next : calls;
}
