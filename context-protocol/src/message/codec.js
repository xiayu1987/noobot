/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isObjectLike } from "@noobot/shared/value";

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

export function resolveContextMessageId(message = {}) {
  return readContextMessageField(message, "messageUid");
}

export const CONTEXT_MESSAGE_PROJECTION_TYPE = Object.freeze({
  USER_META: "user_meta",
  PHASE_SUMMARY: "phase_summary",
  TERMINAL_STATUS: "terminal_status",
});

export function deriveContextMessageProjectionId(sourceMessageId = "", projectionType = "") {
  const sourceId = text(sourceMessageId);
  const type = text(projectionType);
  return sourceId && type ? `${sourceId}::${type}` : "";
}

export function resolveContextMessageDialogProcessId(message = {}) {
  return readContextMessageField(message, "dialogProcessId");
}

export function resolveContextMessageOrigin(message = {}) {
  return readContextMessageField(message, "messageOrigin").toLowerCase();
}

export function resolveContextUserMetaMaterialized(message = {}) {
  return readContextMessageFlag(message, "userMetaMaterialized");
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
    naturalUser: resolveContextMessageOrigin(message) === "natural",
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
  "messageUid",
  "dialogProcessId",
  "parentDialogProcessId",
  "turnScopeId",
  "messageOrigin",
  "userMetaMaterialized",
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
