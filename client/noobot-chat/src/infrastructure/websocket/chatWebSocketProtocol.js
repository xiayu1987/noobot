/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  getAgentCommandIdentity,
  validateAgentCommandReceipt,
  validateAgentCommandRejection,
} from "@noobot/agent-transport-protocol";
import { text, isObjectLike } from "@noobot/shared/value";

export function normalizeTrimmedString(value = "") {
  return text(value);
}

export function normalizeErrorMessage(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (!isObjectLike(value)) return fallback;
  for (const candidate of [value.message, value.reason, value.description, value.error]) {
    const normalized = normalizeErrorMessage(candidate, "");
    if (normalized) return normalized;
  }
  return fallback;
}

export function isEventForStreamScope(data, payload, channelSessionId) {
  const identity = getAgentCommandIdentity(payload);
  if (channelSessionId !== undefined && channelSessionId !== identity.sessionId) return false;
  return ["turnScopeId", "dialogProcessId"].every(
    (key) => !identity[key] || !data[key] || data[key] === identity[key],
  );
}

const COMMAND_RESULT_VALIDATORS = new Map([
  [AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, validateAgentCommandReceipt],
  [AGENT_TRANSPORT_EVENT.COMMAND_REJECTED, validateAgentCommandRejection],
]);

export function isCommandResultForPayload(event, data, payload) {
  const validator = COMMAND_RESULT_VALIDATORS.get(event);
  if (!validator) return false;
  const validation = validator(data);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return data.commandId === payload.commandId;
}

export function isCommandFailureResult(event, data) {
  if (event === AGENT_TRANSPORT_EVENT.COMMAND_REJECTED) return true;
  return data.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED;
}

export function createCommandResultError(event, data) {
  const error = new Error(data.error.message);
  error.event = event;
  error.data = data;
  return error;
}
