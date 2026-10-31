/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "@noobot/shared/value";

export const TOOL_RESULT_ERROR = Object.freeze({
  NOT_TEXT: "tool_result_not_text",
  NOT_JSON: "tool_result_not_json",
  NOT_OBJECT: "tool_result_not_object",
  OK_NOT_BOOLEAN: "tool_result_ok_not_boolean",
  FAILURE_ERROR_REQUIRED: "tool_result_failure_error_required",
  FAILURE_CODE_REQUIRED: "tool_result_failure_code_required",
  CODE_NOT_TEXT: "tool_result_code_not_text",
});

function toolResultError(code, cause) {
  const error = new TypeError(code, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

const TOOL_RESULT_ERROR_CODES = new Set(Object.values(TOOL_RESULT_ERROR));

export function isToolResultError(error) {
  return error instanceof TypeError && TOOL_RESULT_ERROR_CODES.has(error.code);
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function assertToolResultObject(value) {
  if (!isPlainObject(value)) throw toolResultError(TOOL_RESULT_ERROR.NOT_OBJECT);
  if (typeof value.ok !== "boolean") throw toolResultError(TOOL_RESULT_ERROR.OK_NOT_BOOLEAN);
  if (value.code !== undefined && !isNonEmptyText(value.code)) {
    throw toolResultError(TOOL_RESULT_ERROR.CODE_NOT_TEXT);
  }
  if (value.ok === false) {
    if (!isNonEmptyText(value.error)) {
      throw toolResultError(TOOL_RESULT_ERROR.FAILURE_ERROR_REQUIRED);
    }
    if (value.code === undefined) throw toolResultError(TOOL_RESULT_ERROR.FAILURE_CODE_REQUIRED);
  }
  return value;
}

export function decodeToolResultText(value) {
  if (typeof value !== "string") throw toolResultError(TOOL_RESULT_ERROR.NOT_TEXT);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw toolResultError(TOOL_RESULT_ERROR.NOT_JSON, error);
  }
  return assertToolResultObject(parsed);
}

export function encodeToolResultObject(value) {
  return JSON.stringify(assertToolResultObject(value));
}
