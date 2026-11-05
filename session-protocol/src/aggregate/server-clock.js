/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

/**
 * Server clock observation contract.
 *
 * Session read responses carry `serverNow`: the instant the service produced the
 * response, taken from the session service's injected clock. It is a transport
 * envelope field, never part of a cacheable document, so cached or rebuilt
 * documents never have to fabricate a clock reading.
 */
export const SERVER_CLOCK_FIELD = "serverNow";

function serverClockInvalid(reason) {
  return Object.assign(new TypeError(`server clock observation is invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SERVER_CLOCK_INVALID,
  });
}

/** Returns epoch ms for a canonical ISO-8601 UTC instant, otherwise throws. */
export function requireServerNow(value) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw serverClockInvalid(`${SERVER_CLOCK_FIELD} must be a canonical ISO instant`);
  }
  return ms;
}

/** Attaches the server clock observation to a response body. */
export function withServerNow(body, serverNow) {
  if (!isPlainObject(body)) throw serverClockInvalid("response body must be an object");
  if (Object.hasOwn(body, SERVER_CLOCK_FIELD)) {
    throw serverClockInvalid(`response body already carries ${SERVER_CLOCK_FIELD}`);
  }
  requireServerNow(serverNow);
  return { ...body, [SERVER_CLOCK_FIELD]: serverNow };
}

/** Splits a response body into its server clock observation and the remaining document. */
export function splitServerNow(body) {
  if (!isPlainObject(body)) throw serverClockInvalid("response body must be an object");
  const { [SERVER_CLOCK_FIELD]: serverNow, ...document } = body;
  return { serverNowMs: requireServerNow(serverNow), document };
}
