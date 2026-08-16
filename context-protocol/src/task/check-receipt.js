/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_CHECK_PROTOCOL_VERSION = 1;
export const TASK_CHECK_STATE = Object.freeze({
  CONTINUE: "CONTINUE",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

function receiptError(message) {
  const error = new TypeError(`invalid NOOBOT_TASK_CHECK/1 receipt: ${message}`);
  error.code = "INVALID_TASK_CHECK_PROTOCOL";
  return error;
}

export function parseTaskCheckReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw receiptError("receipt must be a plain object");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = ["abstract", "contentHash", "nextAction", "state"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw receiptError(`receipt must contain exactly ${expectedKeys.join(", ")}`);
  }
  const state = String(value.state || "").trim();
  if (!Object.values(TASK_CHECK_STATE).includes(state)) {
    throw receiptError(`state must be one of ${Object.values(TASK_CHECK_STATE).join(", ")}`);
  }
  const abstract = String(value.abstract || "").trim();
  const nextAction = String(value.nextAction || "").trim();
  const contentHash = String(value.contentHash || "").trim();
  if (!abstract) throw receiptError("abstract must not be empty");
  if (!nextAction) throw receiptError("nextAction must not be empty");
  if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    throw receiptError("contentHash must be a sha256 digest");
  }
  return Object.freeze({ state, abstract, nextAction, contentHash });
}
