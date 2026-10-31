/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isObjectLike } from "@noobot/shared/value";
import { createContextMessageId } from "@noobot/session-protocol/message-identity";
import { MESSAGE_ORIGIN } from "@noobot/session-protocol";

export const CONTEXT_MESSAGE_ROLE = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
});

export const CONTEXT_MESSAGE_METADATA_KEY = "additional_kwargs";

export const CONTEXT_MESSAGE_NATIVE_FIELDS = Object.freeze([
  "type",
  "role",
  "content",
  CONTEXT_MESSAGE_METADATA_KEY,
  "id",
  "name",
  "tool_calls",
  "invalid_tool_calls",
  "tool_call_id",
  "status",
  "artifact",
  "response_metadata",
  "usage_metadata",

  "metadata",
]);

function readContextMessageMetadata(message = {}) {
  const metadata = isObjectLike(message) ? message[CONTEXT_MESSAGE_METADATA_KEY] : null;
  return isObjectLike(metadata) ? metadata : {};
}

export function readContextMessageValue(message = {}, field = "") {
  const key = text(field);
  if (!key) return undefined;
  return readContextMessageMetadata(message)[key];
}

export function readContextMessageField(message = {}, field = "") {
  return text(readContextMessageValue(message, field) ?? "");
}

function readContextMessageFlag(message = {}, field = "") {
  return readContextMessageMetadata(message)[field] === true;
}

export function writeContextMessageMetadata(message = {}, patch = {}) {
  if (!isObjectLike(message)) {
    throw new TypeError("context message must be an object");
  }
  if (!isObjectLike(patch)) {
    throw new TypeError("context message metadata patch must be an object");
  }
  if (!isObjectLike(message[CONTEXT_MESSAGE_METADATA_KEY])) {
    message[CONTEXT_MESSAGE_METADATA_KEY] = {};
  }
  const metadata = message[CONTEXT_MESSAGE_METADATA_KEY];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  assertContextMessageInjectionMetadata(message);
  return message;
}

export function withContextMessageMetadata(message = {}, patch = {}) {
  if (!isObjectLike(message)) {
    throw new TypeError("context message must be an object");
  }
  const copy = {
    ...message,
    [CONTEXT_MESSAGE_METADATA_KEY]: { ...readContextMessageMetadata(message) },
  };
  return writeContextMessageMetadata(copy, patch);
}

export function assertContextMessageInjectionMetadata(message = {}) {
  const metadata = readContextMessageMetadata(message);
  const declaresInjection =
    text(metadata.injectedMessageType) !== "" || text(metadata.injectedBy) !== "";
  if (declaresInjection && metadata.injectedMessage !== true) {
    throw new Error("injected context message requires additional_kwargs.injectedMessage");
  }
  if (metadata.injectedMessage === true && !text(metadata.injectedMessageType)) {
    throw new Error("injected context message requires additional_kwargs.injectedMessageType");
  }
}

const CONTEXT_MESSAGE_ROLE_ALIASES = Object.freeze({
  system: CONTEXT_MESSAGE_ROLE.SYSTEM,
  developer: CONTEXT_MESSAGE_ROLE.SYSTEM,
  user: CONTEXT_MESSAGE_ROLE.USER,
  human: CONTEXT_MESSAGE_ROLE.USER,
  assistant: CONTEXT_MESSAGE_ROLE.ASSISTANT,
  ai: CONTEXT_MESSAGE_ROLE.ASSISTANT,
  tool: CONTEXT_MESSAGE_ROLE.TOOL,
  tool_result: CONTEXT_MESSAGE_ROLE.TOOL,
});

export function readDeclaredContextMessageRole(message = {}) {
  return text(message?.role || message?.type).toLowerCase();
}

export function normalizeContextMessageRole(role = "") {
  return CONTEXT_MESSAGE_ROLE_ALIASES[text(role).toLowerCase()] || "";
}

export function resolveContextMessageRole(message = {}) {
  return normalizeContextMessageRole(readDeclaredContextMessageRole(message));
}

export function isContextSystemMessage(message = {}) {
  return resolveContextMessageRole(message) === CONTEXT_MESSAGE_ROLE.SYSTEM;
}

export const CONTEXT_MESSAGE_PROJECTION_TYPE = Object.freeze({
  USER_META: "user_meta",
  PHASE_SUMMARY: "phase_summary",
  TERMINAL_STATUS: "terminal_status",
});

export const CONTEXT_MESSAGE_IDENTITY_SHAPE = Object.freeze({
  SESSION: "session",
  CONTEXT: "context",
  MESSAGE_PROJECTION: "message_projection",
  TURN_PROJECTION: "turn_projection",
});

const PROJECTION_SOURCE_FIELD = Object.freeze({
  [CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META]: "sourceMessageUid",
  [CONTEXT_MESSAGE_PROJECTION_TYPE.PHASE_SUMMARY]: "sourceMessageUid",
  [CONTEXT_MESSAGE_PROJECTION_TYPE.TERMINAL_STATUS]: "sourceTurnScopeId",
});

const IDENTITY_FIELDS = Object.freeze([
  "messageUid",
  "contextMessageId",
  "projectionType",
  "sourceMessageUid",
  "sourceTurnScopeId",
]);

function identityShapeOf(present) {
  const fields = Object.keys(present).sort().join(",");
  if (fields === "messageUid") return CONTEXT_MESSAGE_IDENTITY_SHAPE.SESSION;
  if (fields === "contextMessageId") return CONTEXT_MESSAGE_IDENTITY_SHAPE.CONTEXT;
  const sourceField = PROJECTION_SOURCE_FIELD[present.projectionType];
  if (!sourceField || fields !== ["projectionType", sourceField].sort().join(",")) return "";
  return sourceField === "sourceMessageUid"
    ? CONTEXT_MESSAGE_IDENTITY_SHAPE.MESSAGE_PROJECTION
    : CONTEXT_MESSAGE_IDENTITY_SHAPE.TURN_PROJECTION;
}

function readIdentityFields(message) {
  const present = {};
  for (const field of IDENTITY_FIELDS) {
    const value = readContextMessageField(message, field);
    if (value) present[field] = value;
  }
  return present;
}

function keyOfIdentity(identity) {
  if (identity.shape === CONTEXT_MESSAGE_IDENTITY_SHAPE.SESSION) return identity.messageUid;
  if (identity.shape === CONTEXT_MESSAGE_IDENTITY_SHAPE.CONTEXT) return identity.contextMessageId;
  return composeContextProjectionKey(
    identity.projectionType,
    identity.sourceMessageUid || identity.sourceTurnScopeId,
  );
}

export function inspectContextMessageIdentity(message = {}) {
  const present = readIdentityFields(message);
  const shape = identityShapeOf(present);
  return Object.freeze({
    shape,
    key: shape ? keyOfIdentity({ shape, ...present }) : "",
    fields: Object.freeze(present),
  });
}

export function resolveContextMessageIdentity(message = {}) {
  const present = readIdentityFields(message);
  const shape = identityShapeOf(present);
  if (!shape) {
    const fields = Object.keys(present).join(", ") || "none";
    throw new Error(`context message identity must be exactly one shape, got: ${fields}`);
  }
  return Object.freeze({ shape, ...present });
}

export function assignContextMessageIdentity(message) {
  const present = Object.keys(readIdentityFields(message));
  if (present.length) {
    throw new TypeError(`context message already carries identity: ${present.join(", ")}`);
  }
  return writeContextMessageMetadata(message, { contextMessageId: createContextMessageId() });
}

export function resolveContextMessageKey(message = {}) {
  return keyOfIdentity(resolveContextMessageIdentity(message));
}

export function composeContextProjectionKey(projectionType = "", source = "") {
  const type = text(projectionType);
  const sourceId = text(source);
  if (!PROJECTION_SOURCE_FIELD[type] || !sourceId) {
    throw new Error(`context projection key requires a known type and source: ${type}`);
  }
  return `${type}\u0000${sourceId}`;
}

export function resolveContextSourceMessageUid(message = {}) {
  const identity = resolveContextMessageIdentity(message);
  if (identity.shape === CONTEXT_MESSAGE_IDENTITY_SHAPE.SESSION) return identity.messageUid;
  if (identity.shape === CONTEXT_MESSAGE_IDENTITY_SHAPE.MESSAGE_PROJECTION) {
    return identity.sourceMessageUid;
  }
  return "";
}

export function resolveContextSessionMessageUid(message = {}) {
  const identity = resolveContextMessageIdentity(message);
  return identity.shape === CONTEXT_MESSAGE_IDENTITY_SHAPE.SESSION ? identity.messageUid : "";
}

export function resolveContextMessageDialogProcessId(message = {}) {
  return readContextMessageField(message, "dialogProcessId");
}

export function resolveContextMessageOrigin(message) {
  return readContextMessageValue(message, "messageOrigin");
}

export function resolveContextMessageTurnScopeId(message = {}) {
  return readContextMessageField(message, "turnScopeId");
}

export function resolveContextMessageContent(message = {}) {
  const content = message?.content ?? "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isObjectLike(item)) return "";
      return String(item.text ?? item.content ?? item.value ?? "");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function resolveContextToolCalls(message = {}) {
  return Array.isArray(message?.tool_calls) ? message.tool_calls : [];
}

export function resolveContextToolCallDeclarationId(call = {}) {
  return text(call?.id);
}

function requireContextToolCall(call) {
  if (!isObjectLike(call) || Array.isArray(call)) {
    throw new TypeError("context tool call must be an object");
  }
  return call;
}

export function resolveContextToolCallName(call = {}) {
  const source = requireContextToolCall(call);
  const name = text(source.name) || text(source.function?.name);
  if (!name) throw new TypeError("context tool call requires a tool name");
  return name;
}

export function resolveContextToolCallArgs(call = {}) {
  const source = requireContextToolCall(call);
  const declared = Object.hasOwn(source, "args") ? source.args : source.function?.arguments;
  if (typeof declared === "string") {
    const parsed = JSON.parse(declared);
    if (!isObjectLike(parsed) || Array.isArray(parsed)) {
      throw new TypeError("context tool call arguments must encode an object");
    }
    return parsed;
  }
  if (!isObjectLike(declared) || Array.isArray(declared)) {
    throw new TypeError("context tool call requires object arguments");
  }
  return declared;
}

export function resolveContextToolResultCallId(message = {}) {
  return text(message?.tool_call_id);
}

export function resolveContextMessageSummarized(message = {}) {
  return readContextMessageFlag(message, "summarized");
}

export function markContextMessageSummarized(message = {}) {
  return writeContextMessageMetadata(message, { summarized: true });
}

export function resolveContextMessageFlags(message = {}) {
  return {
    summarized: resolveContextMessageSummarized(message),
    naturalUser: resolveContextMessageOrigin(message) === MESSAGE_ORIGIN.NATURAL,
    injected: readContextMessageFlag(message, "injectedMessage"),
    plugin: readContextMessageFlag(message, "pluginMessage"),
  };
}

export function resolveContextInjectedMessageType(message = {}) {
  return readContextMessageFlag(message, "injectedMessage")
    ? readContextMessageField(message, "injectedMessageType")
    : "";
}

export const CONTEXT_MESSAGE_MODEL_METADATA_FIELDS = Object.freeze([
  ...IDENTITY_FIELDS,
  "userName",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "parentDialogProcessId",
  "turnScopeId",
  "messageOrigin",
  "injectedMessage",
  "injectedBy",
  "injectedMessageType",
  "pluginMessage",
  "noobotInternalMessageType",
]);

export function projectContextMessageModelMetadata(message = {}) {
  const metadata = readContextMessageMetadata(message);
  const projected = {};
  for (const key of CONTEXT_MESSAGE_MODEL_METADATA_FIELDS) {
    const value = metadata[key];
    if (value === undefined || value === null || value === "" || value === false) continue;
    projected[key] = value;
  }
  return projected;
}
