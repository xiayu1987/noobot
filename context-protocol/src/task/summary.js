/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseTaskProtocolContent } from "./protocol-content-parser.js";
import {
  TASK_PROTOCOL_STATE,
  createTaskProtocolReceipt,
  parseTaskProtocolReceipt,
} from "./protocol-receipt.js";

export const TASK_SUMMARY_PROTOCOL_VERSION = 1;
export const TASK_SUMMARY_PROTOCOL_HEADER = "NOOBOT_TASK_SUMMARY/1";
export const TASK_SUMMARY_STATE = TASK_PROTOCOL_STATE;

function protocolError(message) {
  const error = new TypeError(`invalid ${TASK_SUMMARY_PROTOCOL_HEADER} content: ${message}`);
  error.code = "INVALID_TASK_SUMMARY_PROTOCOL";
  return error;
}

export function parseTaskSummaryContent(value) {
  const { content, sections } = parseTaskProtocolContent(value, {
    protocolHeader: TASK_SUMMARY_PROTOCOL_HEADER,
    protocolError,
    validStates: Object.values(TASK_SUMMARY_STATE),
  });
  return Object.freeze({
    protocolVersion: TASK_SUMMARY_PROTOCOL_VERSION,
    state: sections.STATE,
    abstract: sections.ABSTRACT,
    details: sections.DETAILS,
    nextAction: sections.NEXT_ACTION,
    content,
  });
}

export function createTaskSummaryReceipt(parsedSummary) {
  const parsed = parsedSummary?.content ? parsedSummary : parseTaskSummaryContent(parsedSummary);
  return createTaskProtocolReceipt(parsed);
}

export function parseTaskSummaryReceipt(value) {
  return parseTaskProtocolReceipt(value, {
    protocolError,
    subject: "summary receipt",
    fieldPrefix: "summary receipt ",
  });
}
