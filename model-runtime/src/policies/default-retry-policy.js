/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";
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

const TEMPORARY_UNAVAILABLE_STATUSES = new Set([409, 500, 502, 503, 504]);

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
  const { status } = link;
  if (name === "aborterror" || code === "abort_err") {
    return { kind: MODEL_ERROR_KIND.ABORTED, retryable: false };
  }
  if (status === 401 || status === 403) {
    return { kind: MODEL_ERROR_KIND.AUTHENTICATION, retryable: false };
  }
  if (status === 429) return { kind: MODEL_ERROR_KIND.RATE_LIMIT, retryable: true };
  if (name === "timeouterror" || status === 408 || TIMEOUT_ERROR_CODES.has(code)) {
    return { kind: MODEL_ERROR_KIND.TIMEOUT, retryable: true };
  }
  if (TEMPORARY_UNAVAILABLE_STATUSES.has(status) || TEMPORARY_NETWORK_ERROR_CODES.has(code)) {
    return { kind: MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE, retryable: true };
  }
  if (status === 400) return { kind: MODEL_ERROR_KIND.INVALID_REQUEST, retryable: false };
  return null;
}

export function classifyTransportError(error) {
  for (const link of errorChain(error)) {
    const classification = classifyLink(link);
    if (classification) return classification;
  }
  return { kind: MODEL_ERROR_KIND.UNKNOWN, retryable: false };
}

export function shouldRetryTransport({ classification, attempt, maxAttempts, streamedTokens = 0 }) {
  return (
    classification?.retryable === true && attempt < maxAttempts && Number(streamedTokens || 0) === 0
  );
}
