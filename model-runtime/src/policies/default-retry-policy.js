/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";

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

export function classifyTransportError(error = {}) {
  const name = String(error?.name || error?.cause?.name || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const status =
    Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.cause?.status) ||
    0;
  if (name.includes("abort") || code.includes("abort") || message.includes("abort")) {
    return { kind: MODEL_ERROR_KIND.ABORTED, retryable: false };
  }
  if (status === 401 || status === 403)
    return { kind: MODEL_ERROR_KIND.AUTHENTICATION, retryable: false };
  if (status === 429) return { kind: MODEL_ERROR_KIND.RATE_LIMIT, retryable: true };
  if (status === 408 || TIMEOUT_ERROR_CODES.has(code) || message.includes("timeout"))
    return { kind: MODEL_ERROR_KIND.TIMEOUT, retryable: true };
  if (
    [409, 500, 502, 503, 504].includes(status) ||
    TEMPORARY_NETWORK_ERROR_CODES.has(code) ||
    message.includes("temporarily unavailable") ||
    message.includes("internal server error") ||
    message.includes("server error")
  ) {
    return { kind: MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE, retryable: true };
  }
  if (status === 400) return { kind: MODEL_ERROR_KIND.INVALID_REQUEST, retryable: false };
  return { kind: MODEL_ERROR_KIND.UNKNOWN, retryable: false };
}

export function shouldRetryTransport({ classification, attempt, maxAttempts, streamedTokens = 0 }) {
  return (
    classification?.retryable === true && attempt < maxAttempts && Number(streamedTokens || 0) === 0
  );
}
