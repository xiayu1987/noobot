/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const SNAPSHOT_VERSION = 2;
const IDENTITY_FIELDS = [
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
];
const ROUND_IDENTITY_FIELDS = ["dialogProcessId", "turnScopeId"];
const SESSION_IDENTITY_FIELDS = [
  "userName",
  "sessionId",
  "parentSessionId",
  "parentDialogProcessId",
];
const SERIALIZATION_KEYS = new Set([
  "lc",
  "id",
  "kwargs",
  "type",
  "lc_namespace",
  "lc_serializable",
  "lc_aliases",
  "lc_attributes",
  "lc_secrets",
]);

function cloneJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function messageType(message = {}) {
  if (typeof message?._getType === "function")
    return String(message._getType() || "").toLowerCase();
  return String(message?.type || message?.role || message?.lc_kwargs?.type || "").toLowerCase();
}

export function normalizeSnapshotIdentity(identity = {}) {
  return Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, String(identity?.[field] || "").trim()]),
  );
}

export function serializeContextMessage(message = {}) {
  const type = messageType(message);
  const normalizedType =
    type === "system"
      ? "system"
      : type === "ai" || type === "assistant"
        ? "ai"
        : type === "tool" || type === "tool_result"
          ? "tool"
          : "human";
  const additionalKwargs =
    message?.additional_kwargs || message?.lc_kwargs?.additional_kwargs || {};
  const serialized = {
    raw: {},
    type: normalizedType,
    content: typeof message?.content === "string" ? message.content : (message?.content ?? ""),
    additional_kwargs: cloneJson(additionalKwargs) || {},
    lc_kwargs: cloneJson(message?.lc_kwargs) || {},
    summarized:
      message?.summarized === true ||
      message?.lc_kwargs?.summarized === true ||
      additionalKwargs?.summarized === true,
  };
  for (const key of Object.keys(message || {})) {
    if (
      key in serialized ||
      ["content", "additional_kwargs", "lc_kwargs"].includes(key) ||
      SERIALIZATION_KEYS.has(key) ||
      String(key).startsWith("lc_")
    )
      continue;
    const value = cloneJson(message[key]);
    if (value !== undefined) serialized.raw[key] = value;
  }
  if (normalizedType === "ai") {
    if (Array.isArray(message?.tool_calls))
      serialized.tool_calls = cloneJson(message.tool_calls) || [];
    if (Array.isArray(message?.invalid_tool_calls))
      serialized.invalid_tool_calls = cloneJson(message.invalid_tool_calls) || [];
  }
  if (normalizedType === "tool") {
    serialized.tool_call_id =
      message?.tool_call_id ||
      message?.lc_kwargs?.tool_call_id ||
      additionalKwargs?.tool_call_id ||
      "";
    if (message?.name) serialized.name = message.name;
    if (message?.status) serialized.status = message.status;
    if (message?.artifact !== undefined) serialized.artifact = cloneJson(message.artifact);
  }
  return serialized;
}

export function deserializeContextMessageRecord(item = {}) {
  const raw = item?.raw && typeof item.raw === "object" ? cloneJson(item.raw) : {};
  const message = {
    ...raw,
    type: item?.type || "human",
    content: item?.content ?? "",
    additional_kwargs: {
      ...(raw?.additional_kwargs || {}),
      ...(cloneJson(item?.additional_kwargs) || {}),
    },
    lc_kwargs: cloneJson(item?.lc_kwargs) || raw?.lc_kwargs || {},
  };
  if (item?.type === "ai") {
    message.tool_calls = cloneJson(item?.tool_calls) || [];
    message.invalid_tool_calls = cloneJson(item?.invalid_tool_calls) || [];
  }
  if (item?.type === "tool") {
    message.tool_call_id = item?.tool_call_id || "";
    if (item?.name) message.name = item.name;
    if (item?.status) message.status = item.status;
    if (item?.artifact !== undefined) message.artifact = cloneJson(item.artifact);
  }
  if (item?.summarized === true || raw?.summarized === true || raw?.lc_kwargs?.summarized === true)
    message.summarized = true;
  return message;
}

function serializeList(messages = []) {
  return (Array.isArray(messages) ? messages : []).map(serializeContextMessage);
}

export function composeMessagesFromBlocks(blocks = {}) {
  return [
    ...(Array.isArray(blocks?.system) ? blocks.system : []),
    ...(Array.isArray(blocks?.history) ? blocks.history : []),
    ...(Array.isArray(blocks?.incremental) ? blocks.incremental : []),
  ];
}

export function createModelContextSnapshot({
  identity = {},
  messageBlocks = {},
  now = new Date().toISOString(),
} = {}) {
  const normalizedIdentity = normalizeSnapshotIdentity(identity);
  const blocks = {
    system: serializeList(messageBlocks?.system),
    history: serializeList(messageBlocks?.history),
    incremental: serializeList(messageBlocks?.incremental),
  };
  return {
    version: SNAPSHOT_VERSION,
    ...normalizedIdentity,
    createdAt: now,
    updatedAt: now,
    messageBlocks: blocks,
    messages: serializeList(composeMessagesFromBlocks(messageBlocks)),
  };
}

export function assertModelContextSnapshotIdentity(snapshot = {}, identity = {}) {
  const normalized = normalizeSnapshotIdentity(identity);
  for (const field of ["userId", "sessionId", "dialogProcessId", "turnScopeId"]) {
    if (String(snapshot?.[field] || "").trim() !== normalized[field]) {
      throw new Error(`Stopped model message snapshot identity mismatch: ${field}`);
    }
  }
}

export function hydrateModelContextSnapshot(
  snapshot = {},
  identity = {},
  { deserializeMessage = (message) => message } = {},
) {
  assertModelContextSnapshotIdentity(snapshot, identity);
  const hydrate = (messages) =>
    (Array.isArray(messages) ? messages : [])
      .map(deserializeContextMessageRecord)
      .map(deserializeMessage);
  return {
    ...snapshot,
    messageBlocks: {
      system: hydrate(snapshot?.messageBlocks?.system),
      history: hydrate(snapshot?.messageBlocks?.history),
      incremental: hydrate(snapshot?.messageBlocks?.incremental),
    },
    messages: hydrate(snapshot?.messages),
  };
}

function clearNestedIdentity(message = {}, fields = []) {
  for (const holder of [
    message?.additional_kwargs,
    message?.lc_kwargs,
    message?.lc_kwargs?.additional_kwargs,
  ]) {
    if (!holder || typeof holder !== "object" || Array.isArray(holder)) continue;
    for (const field of fields) delete holder[field];
  }
}

function rebindUserMetaContent(message = {}, identity = {}) {
  const internalType = String(
    message?.noobotInternalMessageType ||
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      "",
  ).trim();
  if (internalType !== "user_meta") return;
  if (typeof message?.content !== "string") {
    throw new Error("Recovered user_meta message requires structured JSON content");
  }
  const start = message.content.indexOf("{");
  const end = message.content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Recovered user_meta message requires structured JSON content");
  }
  let parsed;
  try {
    parsed = JSON.parse(message.content.slice(start, end + 1));
  } catch {
    throw new Error("Recovered user_meta message requires structured JSON content");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Recovered user_meta message requires structured JSON content");
  }
  for (const field of [...SESSION_IDENTITY_FIELDS, ...ROUND_IDENTITY_FIELDS]) {
    parsed[field] = identity[field];
  }
  message.content = `${message.content.slice(0, start)}${JSON.stringify(parsed, null, 2)}${message.content.slice(end + 1)}`;
}

export function projectRecoveredMessagesToIdentity(messages = [], identity = {}) {
  const current = Object.fromEntries(
    [...SESSION_IDENTITY_FIELDS, ...ROUND_IDENTITY_FIELDS].map((field) => [
      field,
      String(identity?.[field] || "").trim(),
    ]),
  );
  if (!current.dialogProcessId || !current.turnScopeId) {
    throw new Error("Recovery target requires dialogProcessId and turnScopeId as one identity");
  }
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== "object") return message;
    clearNestedIdentity(message, [...SESSION_IDENTITY_FIELDS, ...ROUND_IDENTITY_FIELDS]);
    for (const field of SESSION_IDENTITY_FIELDS) message[field] = current[field];
    for (const field of ROUND_IDENTITY_FIELDS) message[field] = current[field];
    rebindUserMetaContent(message, current);
    return message;
  });
}
