/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
export {
  TASK_PROTOCOL_RECEIPT_FIELDS,
  TASK_PROTOCOL_STATE,
  parseTaskProtocolReceipt,
} from "./receipt-contract.js";

export function createTaskProtocolReceipt(parsed = {}) {
  return Object.freeze({
    state: parsed.state,
    abstract: parsed.abstract,
    nextAction: parsed.nextAction,
    contentHash: `sha256:${crypto.createHash("sha256").update(parsed.content).digest("hex")}`,
  });
}
