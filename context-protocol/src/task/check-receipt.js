/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TASK_PROTOCOL_STATE, parseTaskProtocolReceipt } from "./protocol-receipt.js";

export const TASK_CHECK_PROTOCOL_VERSION = 1;
export const TASK_CHECK_STATE = TASK_PROTOCOL_STATE;

function receiptError(message) {
  const error = new TypeError(`invalid NOOBOT_TASK_CHECK/1 receipt: ${message}`);
  error.code = "INVALID_TASK_CHECK_PROTOCOL";
  return error;
}

export function parseTaskCheckReceipt(value) {
  return parseTaskProtocolReceipt(value, { protocolError: receiptError, subject: "receipt" });
}
