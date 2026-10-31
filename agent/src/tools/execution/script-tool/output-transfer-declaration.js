/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { toolResultOverflow } from "@noobot/event-protocol/tool-result";

const OUTPUT_TRANSFER_MESSAGE = Object.freeze({
  [TRANSFER_REASON.EXECUTE_SCRIPT_BACKGROUND]:
    "Command finished; stdout/stderr are not inlined in this result and were transferred to the returned attachments. Read them through the returned attachment references.",
  [TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW]:
    "Command output exceeded the inline limit; the inlined stdout/stderr are truncated previews and the full output was transferred to the returned attachments. Read the complete output through the returned attachment references.",
});

function resolveMessage(reason, outputLimitExceeded, outputLimitBytes) {
  const base = OUTPUT_TRANSFER_MESSAGE[reason];
  if (!base) throw new Error(`unsupported_output_transfer_reason:${reason}`);
  if (!outputLimitExceeded) return base;
  return `Command output exceeded ${outputLimitBytes} bytes and execution was terminated; ${base}`;
}

export function buildOutputTransferDeclaration({
  reason,
  transferEnvelopes,
  outputLimitExceeded,
  outputLimitBytes,
}) {
  const message = resolveMessage(reason, outputLimitExceeded, outputLimitBytes);
  return reason === TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW
    ? toolResultOverflow({ message, transferEnvelopes })
    : { message, transferEnvelopes };
}
