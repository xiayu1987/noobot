/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import { parseTaskProtocolContent } from "./protocol-content-parser.js";

export const TASK_SUMMARY_PROTOCOL_VERSION = 1;
export const TASK_SUMMARY_PROTOCOL_HEADER = "NOOBOT_TASK_SUMMARY/1";
export const TASK_SUMMARY_STATE = Object.freeze({
  CONTINUE: "CONTINUE",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

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
  return Object.freeze({
    state: parsed.state,
    abstract: parsed.abstract,
    nextAction: parsed.nextAction,
    contentHash: `sha256:${crypto.createHash("sha256").update(parsed.content).digest("hex")}`,
  });
}

export function parseTaskSummaryReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("summary receipt must be a plain object");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = ["abstract", "contentHash", "nextAction", "state"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw protocolError(`summary receipt must contain exactly ${expectedKeys.join(", ")}`);
  }
  const state = String(value.state || "").trim();
  if (!Object.values(TASK_SUMMARY_STATE).includes(state)) {
    throw protocolError(
      `summary receipt state must be one of ${Object.values(TASK_SUMMARY_STATE).join(", ")}`,
    );
  }
  const abstract = String(value.abstract || "").trim();
  const nextAction = String(value.nextAction || "").trim();
  const contentHash = String(value.contentHash || "").trim();
  if (!abstract) throw protocolError("summary receipt abstract must not be empty");
  if (!nextAction) throw protocolError("summary receipt nextAction must not be empty");
  if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    throw protocolError("summary receipt contentHash must be a sha256 digest");
  }
  return Object.freeze({ state, abstract, nextAction, contentHash });
}
