/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import {
  TASK_CHECK_PROTOCOL_VERSION,
  TASK_CHECK_STATE,
} from "./task-check-receipt.js";

export {
  TASK_CHECK_PROTOCOL_VERSION,
  TASK_CHECK_STATE,
  parseTaskCheckReceipt,
} from "./task-check-receipt.js";

export const TASK_CHECK_PROTOCOL_HEADER = "NOOBOT_TASK_CHECK/1";

const SECTION_NAMES = Object.freeze(["STATE", "ABSTRACT", "DETAILS", "NEXT_ACTION"]);
const SECTION_MARKERS = new Set(SECTION_NAMES.map((name) => `[${name}]`));

function protocolError(message) {
  const error = new TypeError(`invalid ${TASK_CHECK_PROTOCOL_HEADER} content: ${message}`);
  error.code = "INVALID_TASK_CHECK_PROTOCOL";
  return error;
}

function normalizeProtocolText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function parseTaskCheckContent(value) {
  const content = normalizeProtocolText(value);
  if (!content) throw protocolError("content is empty");
  const lines = content.split("\n");
  if (lines[0] !== TASK_CHECK_PROTOCOL_HEADER) {
    throw protocolError(`first line must be ${TASK_CHECK_PROTOCOL_HEADER}`);
  }

  const sections = {};
  let lineIndex = 1;
  for (const sectionName of SECTION_NAMES) {
    const marker = `[${sectionName}]`;
    if (lines[lineIndex] !== marker) {
      throw protocolError(`${marker} is missing or out of order`);
    }
    lineIndex += 1;
    const body = [];
    while (lineIndex < lines.length && !SECTION_MARKERS.has(lines[lineIndex])) {
      if (/^\[[A-Z][A-Z0-9_]*\]$/.test(lines[lineIndex])) {
        throw protocolError(`unknown section ${lines[lineIndex]}`);
      }
      body.push(lines[lineIndex]);
      lineIndex += 1;
    }
    const text = body.join("\n").trim();
    if (!text) throw protocolError(`${marker} must not be empty`);
    sections[sectionName] = text;
  }
  if (lineIndex !== lines.length) {
    throw protocolError(`duplicate or unexpected section ${lines[lineIndex]}`);
  }

  const state = sections.STATE;
  if (!Object.values(TASK_CHECK_STATE).includes(state)) {
    throw protocolError(`[STATE] must be one of ${Object.values(TASK_CHECK_STATE).join(", ")}`);
  }
  return Object.freeze({
    protocolVersion: TASK_CHECK_PROTOCOL_VERSION,
    state,
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
