/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

export const SERVER_CLOCK_FIELD = "serverNow";

function serverClockInvalid(reason) {
  return Object.assign(new TypeError(`server clock observation is invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SERVER_CLOCK_INVALID,
  });
}

export function requireServerNow(value) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw serverClockInvalid(`${SERVER_CLOCK_FIELD} must be a canonical ISO instant`);
  }
  return ms;
}

export function readServerClock(now) {
  if (!isFunction(now)) throw serverClockInvalid("now must be a function");
  const instant = now();
  requireServerNow(instant);
  return instant;
}

export function withServerNow(body, serverNow) {
  if (!isPlainObject(body)) throw serverClockInvalid("response body must be an object");
  if (Object.hasOwn(body, SERVER_CLOCK_FIELD)) {
    throw serverClockInvalid(`response body already carries ${SERVER_CLOCK_FIELD}`);
  }
  requireServerNow(serverNow);
  return { ...body, [SERVER_CLOCK_FIELD]: serverNow };
}

export function splitServerNow(body) {
  if (!isPlainObject(body)) throw serverClockInvalid("response body must be an object");
  const { [SERVER_CLOCK_FIELD]: serverNow, ...document } = body;
  return { serverNowMs: requireServerNow(serverNow), document };
}
