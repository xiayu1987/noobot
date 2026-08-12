/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireModelContextSequencePolicy } from "../policy/context-policy.js";

function text(value) {
  return String(value ?? "").trim();
}
export function normalizeInvocationIdentity(input = {}) {
  return Object.freeze({
    requestId: text(input.requestId),
    invocationId: text(input.invocationId),
    sessionId: text(input.sessionId),
    parentSessionId: text(input.parentSessionId),
    dialogProcessId: text(input.dialogProcessId),
    turnScopeId: text(input.turnScopeId),
    runId: text(input.runId),
    flow: text(input.flow),
    purpose: text(input.purpose),
    domain: text(input.domain),
    contextSequencePolicy: requireModelContextSequencePolicy(input.contextSequencePolicy),
  });
}
export function requireInvocationIdentity(input = {}) {
  const out = normalizeInvocationIdentity(input);
  for (const key of [
    "requestId",
    "invocationId",
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "runId",
    "flow",
    "purpose",
    "domain",
  ])
    if (!out[key]) throw new TypeError(`model invocation.${key} is required`);
  return out;
}
