/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";

export const TASK_PROTOCOL_STATE = Object.freeze({
  CONTINUE: "CONTINUE",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

export const TASK_PROTOCOL_RECEIPT_FIELDS = Object.freeze([
  "abstract",
  "contentHash",
  "nextAction",
  "state",
]);

const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function createTaskProtocolReceipt(parsed = {}) {
  return Object.freeze({
    state: parsed.state,
    abstract: parsed.abstract,
    nextAction: parsed.nextAction,
    contentHash: `sha256:${crypto.createHash("sha256").update(parsed.content).digest("hex")}`,
  });
}

export function parseTaskProtocolReceipt(value, { protocolError, subject, fieldPrefix = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(`${subject} must be a plain object`);
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== TASK_PROTOCOL_RECEIPT_FIELDS.length ||
    keys.some((key, index) => key !== TASK_PROTOCOL_RECEIPT_FIELDS[index])
  ) {
    throw protocolError(
      `${subject} must contain exactly ${TASK_PROTOCOL_RECEIPT_FIELDS.join(", ")}`,
    );
  }
  const states = Object.values(TASK_PROTOCOL_STATE);
  const state = String(value.state || "").trim();
  if (!states.includes(state)) {
    throw protocolError(`${fieldPrefix}state must be one of ${states.join(", ")}`);
  }
  const abstract = String(value.abstract || "").trim();
  const nextAction = String(value.nextAction || "").trim();
  const contentHash = String(value.contentHash || "").trim();
  if (!abstract) throw protocolError(`${fieldPrefix}abstract must not be empty`);
  if (!nextAction) throw protocolError(`${fieldPrefix}nextAction must not be empty`);
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw protocolError(`${fieldPrefix}contentHash must be a sha256 digest`);
  }
  return Object.freeze({ state, abstract, nextAction, contentHash });
}
