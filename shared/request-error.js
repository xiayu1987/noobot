/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const API_REQUEST_ERROR_NAME = "ApiRequestError";

export const API_REQUEST_ERROR_CODE = Object.freeze({
  NETWORK: "network",
  HTTP: "http",
  NOT_FOUND: "not_found",
});

const KNOWN_CODES = new Set(Object.values(API_REQUEST_ERROR_CODE));
const JSON_CONTENT_TYPE = "application/json";
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const SECOND_MS = 1000;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function readRetryAfterMs(response) {
  const seconds = Number(response.headers.get("retry-after"));
  if (!isPositiveInteger(seconds)) {
    throw new TypeError("api 429 response violates contract: retry-after seconds required");
  }
  return seconds * SECOND_MS;
}

export class ApiRequestError extends Error {
  constructor(message, { code, status, serverErrorCode = "", retryAfterMs, cause }) {
    if (!KNOWN_CODES.has(code)) throw new TypeError(`unknown api request error code: ${code}`);
    if (status !== null && !Number.isInteger(status)) {
      throw new TypeError("api request error status must be an integer or null");
    }
    if (code === API_REQUEST_ERROR_CODE.HTTP && status === HTTP_NOT_FOUND) {
      throw new TypeError("api request error for http 404 must use the not_found code");
    }
    if (typeof serverErrorCode !== "string") {
      throw new TypeError("api request error serverErrorCode must be a string");
    }
    if (
      status === HTTP_TOO_MANY_REQUESTS
        ? !isPositiveInteger(retryAfterMs)
        : retryAfterMs !== undefined
    ) {
      throw new TypeError("api request error retryAfterMs is required only for http 429");
    }
    super(message, { cause });
    this.name = API_REQUEST_ERROR_NAME;
    this.code = code;
    this.status = status;
    this.serverErrorCode = serverErrorCode;
    if (status === HTTP_TOO_MANY_REQUESTS) this.retryAfterMs = retryAfterMs;
  }
}

export function isApiRequestError(error) {
  return (
    error instanceof Error && error.name === API_REQUEST_ERROR_NAME && KNOWN_CODES.has(error.code)
  );
}

export function isApiRequestNotFound(error) {
  return isApiRequestError(error) && error.code === API_REQUEST_ERROR_CODE.NOT_FOUND;
}

function isJsonResponse(response) {
  return response.headers.get("content-type")?.includes(JSON_CONTENT_TYPE) === true;
}

async function readFailureEnvelope(response) {
  if (!isJsonResponse(response)) return { error: `http ${response.status}`, errorCode: "" };
  const payload = await response.json();
  const hasErrorCode = Object.hasOwn(payload ?? {}, "errorCode");
  if (
    payload?.ok !== false ||
    typeof payload.error !== "string" ||
    !payload.error ||
    (hasErrorCode && (typeof payload.errorCode !== "string" || !payload.errorCode))
  ) {
    throw new TypeError(`api failure envelope violates contract: http ${response.status}`);
  }
  return { error: payload.error, errorCode: hasErrorCode ? payload.errorCode : "" };
}

export async function readApiResponseEnvelope(response) {
  if (!response.ok) {
    const retryAfterMs =
      response.status === HTTP_TOO_MANY_REQUESTS ? readRetryAfterMs(response) : undefined;
    const { error, errorCode } = await readFailureEnvelope(response);
    throw new ApiRequestError(error, {
      code:
        response.status === HTTP_NOT_FOUND
          ? API_REQUEST_ERROR_CODE.NOT_FOUND
          : API_REQUEST_ERROR_CODE.HTTP,
      status: response.status,
      serverErrorCode: errorCode,
      retryAfterMs,
    });
  }
  const payload = await response.json();
  if (payload?.ok !== true) {
    throw new TypeError(`api success envelope violates contract: http ${response.status}`);
  }
  return payload;
}
