/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TRANSFER_ENVELOPE_V2,
  TRANSFER_REASON,
  directTransfer,
} from "@noobot/semantic-transfer-protocol";

export function legacyV2TransferEnvelope(id, { sessionId, turnScopeId }) {
  const { presentationMessageId, ...rest } = directTransfer({
    transferId: `transfer:${id}`,
    presentationMessageId: `msg_${id}`,
    identity: {
      sessionId,
      turnScopeId,
      runId: "run-1",
      producer: { type: "tool", id: `call-${id}` },
    },
    direction: "output",
    content: `content ${id}`,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  return { ...rest, version: 2, [TRANSFER_ENVELOPE_V2.presentationField]: presentationMessageId };
}
