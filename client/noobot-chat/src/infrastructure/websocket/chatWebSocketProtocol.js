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
} from "@noobot/agent-transport-protocol";
import { text } from "@noobot/shared/value";

export function normalizeTrimmedString(value = "") {
  return text(value);
}

export function normalizeErrorMessage(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (!value || typeof value !== "object") return fallback;
  for (const candidate of [value.message, value.reason, value.description, value.error]) {
    const normalized = normalizeErrorMessage(candidate, "");
    if (normalized) return normalized;
  }
  return fallback;
}

export function isEventForStreamScope(data = {}, payload = {}, channelSessionId = "") {
  const identity = getAgentCommandIdentity(payload);
  const payloadSessionId = normalizeTrimmedString(identity.sessionId);
  const eventSessionId =
    normalizeTrimmedString(data?.sessionId) || normalizeTrimmedString(channelSessionId);
  if (payloadSessionId && eventSessionId && payloadSessionId !== eventSessionId) return false;
  const payloadTurnScopeId = normalizeTrimmedString(identity.turnScopeId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  if (payloadTurnScopeId && eventTurnScopeId && payloadTurnScopeId !== eventTurnScopeId)
    return false;
  const payloadDialogProcessId = normalizeTrimmedString(identity.dialogProcessId);
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  return !(
    payloadDialogProcessId &&
    eventDialogProcessId &&
    payloadDialogProcessId !== eventDialogProcessId
  );
}

export function isCommandReceiptForPayload(event = "", data = {}, payload = {}) {
  if (normalizeTrimmedString(event) !== AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT) return false;
  const validation = validateAgentCommandReceipt(data);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return normalizeTrimmedString(data.commandId) === normalizeTrimmedString(payload?.commandId);
}

export function createCommandReceiptError(data = {}, translateText = (key = "") => key) {
  const fallback =
    normalizeTrimmedString(data?.error?.code) || translateText("infra.websocketStreamError");
  const error = new Error(normalizeErrorMessage(data?.error?.message, fallback));
  error.event = AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT;
  error.data = data || {};
  return error;
}

export function isFailedCommandReceipt(data = {}) {
  return normalizeTrimmedString(data?.outcome) === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED;
}
