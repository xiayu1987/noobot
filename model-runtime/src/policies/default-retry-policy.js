/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_ERROR_KIND,
  MODEL_RECOVERY_ACTION,
  resolveModelFailureRecovery,
  createModelFailureClassification,
} from "@noobot/model-protocol";
import { isObjectLike } from "@noobot/shared/value";

const TIMEOUT_ERROR_CODES = new Set([
  "etimedout",
  "und_err_connect_timeout",
  "und_err_headers_timeout",
]);

const TEMPORARY_NETWORK_ERROR_CODES = new Set([
  "eai_again",
  "econnrefused",
  "econnreset",
  "ehostunreach",
  "enetunreach",
  "epipe",
  "und_err_socket",
]);

function* errorChain(error) {
  const seen = new Set();
  for (let current = error; isObjectLike(current); current = current.cause) {
    if (seen.has(current)) return;
    seen.add(current);
    yield current;
  }
}

function classifyLink(link) {
  const name = String(link.name || "").toLowerCase();
  const code = String(link.code || "").toLowerCase();
  if (name === "aborterror" || code === "abort_err") {
    return createModelFailureClassification(MODEL_ERROR_KIND.ABORTED);
  }
  if (name === "timeouterror" || TIMEOUT_ERROR_CODES.has(code)) {
    return createModelFailureClassification(MODEL_ERROR_KIND.TIMEOUT);
  }
  if (TEMPORARY_NETWORK_ERROR_CODES.has(code)) {
    return createModelFailureClassification(MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE);
  }
  return null;
}

export function classifyTransportError(error) {
  for (const link of errorChain(error)) {
    const classification = classifyLink(link);
    if (classification) return classification;
  }
  return createModelFailureClassification(MODEL_ERROR_KIND.UNKNOWN);
}

export function shouldRetryTransport({ classification, attempt, maxAttempts }) {
  return (
    resolveModelFailureRecovery(classification).action === MODEL_RECOVERY_ACTION.RETRY_SAME &&
    attempt < maxAttempts
  );
}
