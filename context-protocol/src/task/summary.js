/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";

export const TASK_SUMMARY_PROTOCOL_VERSION = 1;
export const TASK_SUMMARY_PROTOCOL_HEADER = "NOOBOT_TASK_SUMMARY/1";
export const TASK_SUMMARY_STATE = Object.freeze({
  CONTINUE: "CONTINUE",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

const SECTION_NAMES = Object.freeze(["STATE", "ABSTRACT", "DETAILS", "NEXT_ACTION"]);
const SECTION_MARKERS = new Set(SECTION_NAMES.map((name) => `[${name}]`));

function protocolError(message) {
  const error = new TypeError(`invalid ${TASK_SUMMARY_PROTOCOL_HEADER} content: ${message}`);
  error.code = "INVALID_TASK_SUMMARY_PROTOCOL";
  return error;
}

function normalizeProtocolText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function parseTaskSummaryContent(value) {
  const content = normalizeProtocolText(value);
  if (!content) throw protocolError("content is empty");
  const lines = content.split("\n");
  if (lines[0] !== TASK_SUMMARY_PROTOCOL_HEADER) {
    throw protocolError(`first line must be ${TASK_SUMMARY_PROTOCOL_HEADER}`);
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
  if (!Object.values(TASK_SUMMARY_STATE).includes(state)) {
    throw protocolError(`[STATE] must be one of ${Object.values(TASK_SUMMARY_STATE).join(", ")}`);
  }
  return Object.freeze({
    protocolVersion: TASK_SUMMARY_PROTOCOL_VERSION,
    state,
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
