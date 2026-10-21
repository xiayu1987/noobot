/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_NATIVE_FIELDS,
  CONTEXT_MESSAGE_ROLE,
  readContextMessageField,
  resolveContextMessageFlags,
  resolveContextMessageId,
  withContextMessageMetadata,
  resolveContextMessageRole,
  resolveContextToolResultCallId,
} from "../message/codec.js";
import { normalizeUserMetaBackwrites } from "./user-meta-backwrite.js";
import { text, isObjectLike, isPlainObject } from "@noobot/shared/value";

const SNAPSHOT_VERSION = 4;
const IDENTITY_FIELDS = [
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
];

const NATIVE_TOP_LEVEL_KEYS = new Set(CONTEXT_MESSAGE_NATIVE_FIELDS);

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

const SNAPSHOT_TYPE_BY_ROLE = Object.freeze({
  [CONTEXT_MESSAGE_ROLE.SYSTEM]: "system",
  [CONTEXT_MESSAGE_ROLE.ASSISTANT]: "ai",
  [CONTEXT_MESSAGE_ROLE.TOOL]: "tool",
  [CONTEXT_MESSAGE_ROLE.USER]: "human",
});

export function normalizeSnapshotIdentity(identity = {}) {
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, text(identity?.[field])]));
}

function assertProtocolTopLevelKeys(message = {}) {
  for (const key of Object.keys(message || {})) {
    if (NATIVE_TOP_LEVEL_KEYS.has(key) || key.startsWith("lc_")) continue;
    throw new Error(`context message top-level field is not part of the protocol: ${key}`);
  }
}

export function serializeContextMessage(message = {}) {
  assertProtocolTopLevelKeys(message);
  const normalizedType = SNAPSHOT_TYPE_BY_ROLE[resolveContextMessageRole(message)];
  if (!normalizedType) {
    throw new Error("context message snapshot requires a declared role");
  }
  const serialized = {
    type: normalizedType,
    content: message?.content ?? "",
    additional_kwargs: cloneJson(message?.additional_kwargs) || {},
  };
  if (normalizedType === "ai") {
    serialized.tool_calls = Array.isArray(message?.tool_calls) ? cloneJson(message.tool_calls) : [];
    serialized.invalid_tool_calls = Array.isArray(message?.invalid_tool_calls)
      ? cloneJson(message.invalid_tool_calls)
      : [];
    if (
      isObjectLike(message?.response_metadata) &&
      Array.isArray(message.response_metadata.output)
    ) {
      serialized.response_metadata = { output: cloneJson(message.response_metadata.output) };
    }
  }
  if (normalizedType === "tool") {
    serialized.tool_call_id = resolveContextToolResultCallId(message);
    if (message?.name) serialized.name = message.name;
    if (message?.status) serialized.status = message.status;
    if (message?.artifact !== undefined) serialized.artifact = cloneJson(message.artifact);
  }
  return serialized;
}

function deserializeContextMessageRecord(item = {}) {
  const message = {
    type: item.type,
    content: item.content ?? "",
    additional_kwargs: cloneJson(item.additional_kwargs) || {},
  };
  if (item.type === "ai") {
    message.tool_calls = cloneJson(item.tool_calls) || [];
    message.invalid_tool_calls = cloneJson(item.invalid_tool_calls) || [];
    if (isObjectLike(item.response_metadata) && Array.isArray(item.response_metadata.output)) {
      message.response_metadata = { output: cloneJson(item.response_metadata.output) };
    }
  }
  if (item.type === "tool") {
    message.tool_call_id = text(item.tool_call_id);
    if (item.name) message.name = item.name;
    if (item.status) message.status = item.status;
    if (item.artifact !== undefined) message.artifact = cloneJson(item.artifact);
  }
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

function normalizeTurnProgress(turnProgress) {
  if (!isPlainObject(turnProgress)) return {};
  return cloneJson(turnProgress) || {};
}

export function createModelContextSnapshot({
  identity = {},
  messageBlocks = {},
  userMetaBackwrites = [],
  turnProgress = {},
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
    turnProgress: normalizeTurnProgress(turnProgress),
  };
}

function assertModelContextSnapshotIdentity(snapshot = {}, identity = {}) {
  const normalized = normalizeSnapshotIdentity(identity);
  for (const field of ["userId", "sessionId", "dialogProcessId", "turnScopeId"]) {
    if (text(snapshot?.[field]) !== normalized[field]) {
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
    turnProgress: normalizeTurnProgress(snapshot?.turnProgress),
  };
}

function indexAuthoritativeSessionMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError("Session authority messages must be an array");
  }
  const indexed = new Map();
  for (const message of messages) {
    const messageUid = text(message?.messageUid);
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
      return withContextMessageMetadata(message, {
        attachments: cloneJson(authoritative.attachments || []),
      });
    });
  return {
    system: Array.isArray(messageBlocks?.system) ? messageBlocks.system : [],
    history: restore(messageBlocks?.history),
    incremental: restore(messageBlocks?.incremental),
  };
}

export function projectSnapshotIncrementalToContinuation(messages = [], identity = {}) {
  const currentDialogProcessId = text(identity?.dialogProcessId);
  const currentTurnScopeId = text(identity?.turnScopeId);
  if (!currentDialogProcessId || !currentTurnScopeId) {
    throw new Error("Continuation projection requires dialogProcessId and turnScopeId");
  }

  return (Array.isArray(messages) ? messages : []).map((source) => cloneJson(source));
}
