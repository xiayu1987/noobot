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

export function sendCommandReceipt(sendEvent, command, outcome, error) {
  sendEvent(
    AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    createAgentCommandReceipt({ command, outcome, error, occurredAt: new Date().toISOString() }),
  );
}

export function sendFailedCommandReceipt(sendEvent, command, error) {
  sendCommandReceipt(sendEvent, command, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED, error);
}
