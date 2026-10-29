/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  getAgentCommandIdentity,
} from "@noobot/agent-transport-protocol";
import { text } from "@noobot/shared/value";

export function normalizeTrimmedString(value = "") {
  return text(value);
}

export function isEventForStreamScope(data, payload, channelSessionId) {
  const identity = getAgentCommandIdentity(payload);
  if (channelSessionId !== undefined && channelSessionId !== identity.sessionId) return false;
  return ["turnScopeId", "dialogProcessId"].every(
    (key) => !identity[key] || !data[key] || data[key] === identity[key],
  );
}

export const COMMAND_RESULT_EVENTS = new Set([
  AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
  AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
]);

export function isCommandResultForPayload(event, data, payload) {
  return COMMAND_RESULT_EVENTS.has(event) && data.commandId === payload.commandId;
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

export function isCommandResultError(error) {
  return error instanceof Error && COMMAND_RESULT_EVENTS.has(error.event);
}
