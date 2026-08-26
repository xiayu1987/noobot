/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_ROLE,
  readContextMessageField,
  resolveContextMessageFlags,
  resolveContextMessageId,
  resolveContextMessageRole,
} from "../message/codec.js";
import { normalizeUserMetaBackwrites } from "./user-meta-backwrite.js";

const SNAPSHOT_VERSION = 3;
const IDENTITY_FIELDS = [
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
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
  "tool_calls",
  "invalid_tool_calls",
  "tool_call_id",
  "name",
  "status",
  "artifact",
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
    serialized.tool_calls = Array.isArray(message?.tool_calls)
      ? cloneJson(message.tool_calls) || []
      : [];
    serialized.invalid_tool_calls = Array.isArray(message?.invalid_tool_calls)
      ? cloneJson(message.invalid_tool_calls) || []
      : [];
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
  userMetaBackwrites = [],
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
    userMetaBackwrites: normalizeUserMetaBackwrites(userMetaBackwrites),
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
  if (Number(snapshot?.version) !== SNAPSHOT_VERSION) {
    throw new Error(`Stopped model message snapshot version must equal ${SNAPSHOT_VERSION}`);
  }
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
    userMetaBackwrites: normalizeUserMetaBackwrites(snapshot?.userMetaBackwrites || []),
  };
}

function indexAuthoritativeSessionMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError("Session authority messages must be an array");
  }
  const indexed = new Map();
  for (const message of messages) {
    const messageUid = String(message?.messageUid || "").trim();
    if (!messageUid) {
      throw new Error("Session authority message requires messageUid");
    }
    if (indexed.has(messageUid)) {
      throw new Error(`duplicate Session authority messageUid: ${messageUid}`);
    }
    indexed.set(messageUid, message);
  }
  return indexed;
}

function isPersistedFrontendUserSource(message = {}) {
  return (
    resolveContextMessageRole(message) === CONTEXT_MESSAGE_ROLE.USER &&
    resolveContextMessageFlags(message).naturalUser &&
    !readContextMessageField(message, "noobotInternalMessageType")
  );
}

export function restoreSnapshotUserAttachmentFactsFromSessionAuthority(
  messageBlocks = {},
  authoritativeMessages,
) {
  const authorityByMessageUid = indexAuthoritativeSessionMessages(authoritativeMessages);
  const restore = (messages) =>
    (Array.isArray(messages) ? messages : []).map((message) => {
      if (!isPersistedFrontendUserSource(message)) return message;
      const messageUid = resolveContextMessageId(message);
      if (!messageUid) {
        throw new Error("Persisted snapshot user source requires canonical message identity");
      }
      const authoritative = authorityByMessageUid.get(messageUid);
      if (!authoritative) {
        throw new Error(`Snapshot user source is missing from Session authority: ${messageUid}`);
      }
      if (resolveContextMessageRole(authoritative) !== CONTEXT_MESSAGE_ROLE.USER) {
        throw new Error(
          `Snapshot user source conflicts with Session authority role: ${messageUid}`,
        );
      }
      if (authoritative.attachments !== undefined && !Array.isArray(authoritative.attachments)) {
        throw new TypeError(`Session authority attachments must be an array: ${messageUid}`);
      }
      return {
        ...message,
        attachments: cloneJson(authoritative.attachments || []),
      };
    });
  return {
    system: Array.isArray(messageBlocks?.system) ? messageBlocks.system : [],
    history: restore(messageBlocks?.history),
    incremental: restore(messageBlocks?.incremental),
  };
}

export function projectSnapshotIncrementalToContinuation(messages = [], identity = {}) {
  const currentDialogProcessId = String(identity?.dialogProcessId || "").trim();
  const currentTurnScopeId = String(identity?.turnScopeId || "").trim();
  if (!currentDialogProcessId || !currentTurnScopeId) {
    throw new Error("Continuation projection requires dialogProcessId and turnScopeId");
  }
  // A stopped snapshot is an immutable model-input prefix. The continuation
  // identity belongs to the new natural user message appended after it; old
  // messages and user_meta projections retain their original facts.
  return (Array.isArray(messages) ? messages : []).map((source) => cloneJson(source));
}
