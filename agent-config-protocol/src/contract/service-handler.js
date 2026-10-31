/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isPlainObject, text } from "@noobot/shared/value";

export const SERVICE_FAILURE_CODE = Object.freeze({
  INPUT_INVALID: "service_input_invalid",
  DEPENDENCY_MISSING: "service_dependency_missing",
  UPSTREAM_FAILED: "service_upstream_failed",
  UPSTREAM_UNREACHABLE: "service_upstream_unreachable",
});

const SERVICE_FAILURE_CODES = new Set(Object.values(SERVICE_FAILURE_CODE));
const SUCCESS_KEYS = new Set(["ok", "output"]);
const FAILURE_KEYS = new Set(["ok", "error", "code", "output"]);
const LABEL = "service handler result";

function rejectUnknownKeys(source, allowed) {
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${LABEL} contains unsupported field: ${key}`);
  }
}

function frozenOutput(output) {
  if (!isPlainObject(output)) throw new TypeError(`${LABEL} output must be an object`);
  return Object.freeze({ ...output });
}

export function resolveServiceHandler(module) {
  if (!isFunction(module?.default)) {
    throw new TypeError("service handler module must default-export a function");
  }
  return module.default;
}

export function normalizeServiceHandlerResult(result) {
  if (!isPlainObject(result)) throw new TypeError(`${LABEL} must be an object`);
  if (typeof result.ok !== "boolean") throw new TypeError(`${LABEL} ok must be boolean`);
  if (result.ok) {
    rejectUnknownKeys(result, SUCCESS_KEYS);
    return Object.freeze({ ok: true, output: frozenOutput(result.output) });
  }
  rejectUnknownKeys(result, FAILURE_KEYS);
  if (!text(result.error)) throw new TypeError(`${LABEL} failure error is required`);
  if (!SERVICE_FAILURE_CODES.has(result.code)) {
    throw new TypeError(`${LABEL} failure code is invalid: ${result.code}`);
  }
  return Object.freeze({
    ok: false,
    error: result.error,
    code: result.code,
    ...(result.output === undefined ? {} : { output: frozenOutput(result.output) }),
  });
}
