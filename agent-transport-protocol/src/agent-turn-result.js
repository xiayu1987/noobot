/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isObjectLike, isPlainObject } from "@noobot/shared/value";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { isMessageIdentity } from "@noobot/session-protocol/message-identity";

export const AGENT_TURN_RESULT_ERROR_CODE = "AGENT_TURN_RESULT_INVALID";

const capturedMessages = new WeakSet();

const isString = (value) => typeof value === "string";
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isTurnMessage = (message) => isPlainObject(message) && isMessageIdentity(message.messageUid);
const isTurnMessageList = (value) =>
  Array.isArray(value) &&
  Array.from(value).every(isTurnMessage) &&
  new Set(value.map((message) => message.messageUid)).size === value.length;

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

export function assertAgentTurnMessages(messages) {
  if (!isTurnMessageList(messages)) throw rejectAgentTurnResult("has invalid turnMessages");
  return messages;
}

export function captureAgentTurnMessageValue(message) {
  if (capturedMessages.has(message)) return message;
  if (!isTurnMessage(message)) throw rejectAgentTurnResult("has invalid turnMessages");
  const messageUid = message.messageUid;
  const captured = JSON.parse(JSON.stringify(message));
  if (!isTurnMessage(captured) || captured.messageUid !== messageUid)
    throw rejectAgentTurnResult("serialization changed message identity");
  deepFreeze(captured);
  capturedMessages.add(captured);
  return captured;
}

export function appendAgentTurnMessageContent(message, content) {
  if (!capturedMessages.has(message))
    throw rejectAgentTurnResult("append requires a captured message");
  if (typeof message.content !== "string" || typeof content !== "string" || !content.length)
    throw new TypeError("Message content append requires string content and a non-empty fragment");
  const next = Object.freeze({ ...message, content: message.content + content });
  capturedMessages.add(next);
  return next;
}

function captureSerializedMessagePatch(message, entries) {
  const candidate = { ...message };
  for (const [key, value] of entries) {
    if (value === undefined) delete candidate[key];
    else Object.defineProperty(candidate, key, { value, enumerable: true, configurable: true });
  }
  const captured = captureAgentTurnMessageValue(candidate);
  return JSON.stringify(captured) === JSON.stringify(message) ? message : captured;
}

export function patchAgentTurnMessageValue(message, patch) {
  if (!capturedMessages.has(message))
    throw rejectAgentTurnResult("patch requires a captured message");
  if (!isPlainObject(patch))
    throw new TypeError("current turn message patch must be a plain object");
  const entries = Object.entries(patch);
  const changes = Object.fromEntries(entries);
  const messageUid = Object.hasOwn(changes, "messageUid") ? changes.messageUid : message.messageUid;
  if (!isMessageIdentity(messageUid)) throw rejectAgentTurnResult("has invalid turnMessages");

  if (isFunction(changes.toJSON)) return captureSerializedMessagePatch(message, entries);
  const changedEntries = entries.filter(
    ([key, value]) => !Object.hasOwn(message, key) || value !== message[key],
  );
  const normalized = JSON.parse(JSON.stringify(Object.fromEntries(changedEntries)));
  let changed = false;
  const next = { ...message };
  for (const [key] of changedEntries) {
    if (!Object.hasOwn(normalized, key)) {
      changed = Object.hasOwn(next, key) || changed;
      delete next[key];
      continue;
    }
    const value = normalized[key];
    const previous = message[key];
    if (
      Object.hasOwn(message, key) &&
      (value === previous ||
        (isObjectLike(value) && JSON.stringify(value) === JSON.stringify(previous)))
    )
      continue;
    Object.defineProperty(next, key, { value, enumerable: true, configurable: true });
    changed = true;
  }
  if (!isTurnMessage(next)) throw rejectAgentTurnResult("has invalid turnMessages");
  if (!changed) return message;
  deepFreeze(next);
  capturedMessages.add(next);
  return next;
}

export function captureAgentTurnMessages(messages) {
  if (!Array.isArray(messages)) throw rejectAgentTurnResult("has invalid turnMessages");
  return assertAgentTurnMessages(Array.from(messages, captureAgentTurnMessageValue));
}

export function assertAgentTurnMessageAppend(message, messageUids) {
  if (!isTurnMessage(message) || messageUids.has(message.messageUid))
    throw rejectAgentTurnResult("has invalid turnMessages");
  return message;
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
