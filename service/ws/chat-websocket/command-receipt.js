/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandReceipt,
} from "@noobot/agent-transport-protocol";

const clean = (value) => String(value || "").trim();

export function sendFailedCommandReceipt(sendEvent, command, error = {}) {
  const identity = command?.identity || {};
  return sendEvent(
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({
      commandId: command?.commandId,
      commandType: command?.commandType,
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      identity: {
        sessionId: identity.sessionId,
        turnScopeId: identity.turnScopeId,
        dialogProcessId: identity.dialogProcessId,
      },
      error: {
        code: clean(error.code) || "command_failed",
        message: String(error.message || error.code || "command failed"),
      },
    }),
  );
}
