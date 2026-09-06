/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import { TASK_CHECK_PROTOCOL_VERSION, TASK_CHECK_STATE } from "./check-receipt.js";
import { parseTaskProtocolContent } from "./protocol-content-parser.js";

export {
  TASK_CHECK_PROTOCOL_VERSION,
  TASK_CHECK_STATE,
  parseTaskCheckReceipt,
} from "./check-receipt.js";

export const TASK_CHECK_PROTOCOL_HEADER = "NOOBOT_TASK_CHECK/1";

function protocolError(message) {
  const error = new TypeError(`invalid ${TASK_CHECK_PROTOCOL_HEADER} content: ${message}`);
  error.code = "INVALID_TASK_CHECK_PROTOCOL";
  return error;
}

export function parseTaskCheckContent(value) {
  const { content, sections } = parseTaskProtocolContent(value, {
    protocolHeader: TASK_CHECK_PROTOCOL_HEADER,
    protocolError,
    validStates: Object.values(TASK_CHECK_STATE),
  });
  return Object.freeze({
    protocolVersion: TASK_CHECK_PROTOCOL_VERSION,
    state: sections.STATE,
    abstract: sections.ABSTRACT,
    details: sections.DETAILS,
    nextAction: sections.NEXT_ACTION,
    content,
  });
}

export function createTaskCheckReceipt(parsedCheck) {
  const parsed = parsedCheck?.content ? parsedCheck : parseTaskCheckContent(parsedCheck);
  return Object.freeze({
    state: parsed.state,
    abstract: parsed.abstract,
    nextAction: parsed.nextAction,
    contentHash: `sha256:${crypto.createHash("sha256").update(parsed.content).digest("hex")}`,
  });
}
