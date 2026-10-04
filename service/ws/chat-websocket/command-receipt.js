/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
  validateAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";

const clean = (value) => String(value || "").trim();

export function sendFailedCommandReceipt(sendEvent, command, error = {}) {
  const identity = command?.identity || {};
  const draft = {
    protocolVersion: 1,
    commandId: clean(command?.commandId),
    commandType: clean(command?.commandType),
    outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
    identity: {
      sessionId: clean(identity.sessionId),
      turnScopeId: clean(identity.turnScopeId),
      dialogProcessId: clean(identity.dialogProcessId),
    },
    occurredAt: new Date().toISOString(),
    error: {
      code: clean(error.code) || "command_failed",
      message: String(error.message || error.code || "command failed"),
    },
  };
  if (!validateAgentCommandReceipt(draft).valid) return false;
  sendEvent(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, createAgentCommandReceipt(draft));
  return true;
}
