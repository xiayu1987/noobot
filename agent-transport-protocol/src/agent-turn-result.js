/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";

export const AGENT_TURN_RESULT_ERROR_CODE = "AGENT_TURN_RESULT_INVALID";

const isString = (value) => typeof value === "string";
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isTurnMessage = (message) => isPlainObject(message) && Boolean(text(message.messageUid));
const isTurnMessageList = (value) => Array.isArray(value) && value.every(isTurnMessage);

const REQUIRED_FIELDS = Object.freeze({
  output: isString,
  traces: Array.isArray,
  turnMessages: isTurnMessageList,
  modelLoopRound: isNonNegativeInteger,
  modelMessages: Array.isArray,
});

const OPTIONAL_FIELDS = Object.freeze({
  modelMessageId: isString,
});

function rejectAgentTurnResult(reason) {
  const error = new TypeError(`agent turn result ${reason}`);
  error.code = AGENT_TURN_RESULT_ERROR_CODE;
  return error;
}

export function assertAgentTurnResult(result) {
  if (!isPlainObject(result)) throw rejectAgentTurnResult("must be a plain object");
  for (const [field, isValid] of Object.entries(REQUIRED_FIELDS)) {
    if (!isValid(result[field])) throw rejectAgentTurnResult(`has invalid ${field}`);
  }
  for (const [field, value] of Object.entries(result)) {
    if (Object.hasOwn(REQUIRED_FIELDS, field)) continue;
    if (!Object.hasOwn(OPTIONAL_FIELDS, field)) {
      throw rejectAgentTurnResult(`has unknown field ${field}`);
    }
    if (!OPTIONAL_FIELDS[field](value)) throw rejectAgentTurnResult(`has invalid ${field}`);
  }
  return result;
}

export function createAgentTurnResult(fields) {
  return assertAgentTurnResult({ ...fields });
}
