/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import {
  assertToolResultObject as assertBaseResult,
  decodeToolResultText as decodeBaseResult,
  isNonEmptyText,
} from "./tool-result-v24.js";
export { TOOL_RESULT_ERROR, isToolResultError } from "./tool-result-v24.js";

export function assertToolResultObject(value) {
  assertBaseResult(value);
  if (Object.hasOwn(value, "overflowed")) {
    if (value.overflowed !== true) throw new TypeError("tool_result_overflow_flag_invalid");
    toolResultOverflow(value);
  }
  return value;
}

export function decodeToolResultText(value) {
  return assertToolResultObject(decodeBaseResult(value));
}

export function encodeToolResultObject(value) {
  return JSON.stringify(assertToolResultObject(value));
}

export function toolResultOverflow({ message, transferEnvelopes }) {
  if (!isNonEmptyText(message)) throw new TypeError("tool_result_overflow_message_required");
  if (!Array.isArray(transferEnvelopes) || !transferEnvelopes.length) {
    throw new TypeError("tool_result_overflow_transfers_required");
  }
  return {
    overflowed: true,
    message,
    transferEnvelopes: mergeTransferEnvelopes(transferEnvelopes),
  };
}
