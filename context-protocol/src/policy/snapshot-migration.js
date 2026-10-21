/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createMigrationError,
  defineVersionChain,
  runVersionChain,
} from "@noobot/shared/migration";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { MESSAGE_REMOVED_FIELD_NAME } from "@noobot/session-protocol/message-identity-schema";
import { isPlainObject, text } from "@noobot/shared/value";
import {
  SNAPSHOT_VERSION,
  composeMessagesFromBlocks,
  hydrateModelContextSnapshot,
} from "./snapshot.js";

export const MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND = "model-context-snapshot";
export const V3_MESSAGE_IDENTITY_KEY = MESSAGE_REMOVED_FIELD_NAME.NOOBOT_MESSAGE_ID;

const V3_MESSAGE_KEYS = new Set([
  "type",
  "content",
  "additional_kwargs",
  "tool_calls",
  "invalid_tool_calls",
  "tool_call_id",
  "response_metadata",
  "raw",
  "lc_kwargs",
  "summarized",
]);
const V3_LC_MIRROR_KEYS = new Set([
  "content",
  "additional_kwargs",
  "tool_calls",
  "invalid_tool_calls",
  "tool_call_id",
  V3_MESSAGE_IDENTITY_KEY,
]);
const V3_RAW_METADATA_KEYS = new Set([
  "dialogProcessId",
  "turnScopeId",
  "injectedMessage",
  "injectedBy",
  "injectedMessageType",
  "relayCorrelationId",
]);
const V3_RAW_DROPPED_KEYS = new Set([
  "role",
  "promptInjectionId",
  "messageBlockPolicy",
  "purpose",
  "pluginFlow",
  "chain",
]);
const V3_RAW_ROLE_BY_TYPE = Object.freeze({
  system: "system",
  human: "user",
  ai: "assistant",
  tool: "tool",
});
const SNAPSHOT_BLOCKS = Object.freeze(["system", "history", "incremental"]);

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unmappable(fromVersion, reason, details = {}) {
  return createMigrationError({
    kind: MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND,
    fromVersion,
    reason,
    details,
  });
}

function mergeMetadata(metadata, key, value, at) {
  if (key in metadata && !sameJson(metadata[key], value)) {
    throw unmappable(3, "metadata_conflict", { at, key });
  }
  metadata[key] = value;
}

function assertLcMirror(message, at) {
  const lc = message.lc_kwargs;
  if (!isPlainObject(lc)) throw unmappable(3, "lc_kwargs_missing", { at });
  for (const [key, value] of Object.entries(lc)) {
    if (key === "contextPolicy" || key === "response_metadata") continue;
    if (!V3_LC_MIRROR_KEYS.has(key)) throw unmappable(3, "lc_kwargs_unknown_key", { at, key });
    const original =
      key === V3_MESSAGE_IDENTITY_KEY
        ? message.additional_kwargs?.[V3_MESSAGE_IDENTITY_KEY]
        : message[key];
    if (!sameJson(value, original)) throw unmappable(3, "lc_kwargs_mirror_mismatch", { at, key });
  }
  const mirroredMetadata = lc.response_metadata;
  if (
    mirroredMetadata !== undefined &&
    !sameJson(mirroredMetadata, {}) &&
    !sameJson(mirroredMetadata, message.response_metadata)
  ) {
    throw unmappable(3, "lc_kwargs_mirror_mismatch", { at, key: "response_metadata" });
  }
}

function assertV3MessageKeys(message, at) {
  if (!isPlainObject(message)) throw unmappable(3, "message_not_object", { at });
  for (const key of Object.keys(message)) {
    if (!V3_MESSAGE_KEYS.has(key)) throw unmappable(3, "message_unknown_key", { at, key });
  }
}

function mergeV3Raw(metadata, message, sourceId, at) {
  const raw = isPlainObject(message.raw) ? message.raw : {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "messageUid") {
      if (value !== sourceId) throw unmappable(3, "raw_identity_mismatch", { at });
    } else if (key === "role") {
      if (value !== V3_RAW_ROLE_BY_TYPE[message.type])
        throw unmappable(3, "raw_role_mismatch", { at });
    } else if (V3_RAW_METADATA_KEYS.has(key)) {
      mergeMetadata(metadata, key, value, at);
    } else if (!V3_RAW_DROPPED_KEYS.has(key)) {
      throw unmappable(3, "raw_unknown_key", { at, key });
    }
  }
}

function mergeV3Flags(metadata, message, at) {
  if (message.lc_kwargs.contextPolicy !== undefined) {
    mergeMetadata(metadata, "contextPolicy", message.lc_kwargs.contextPolicy, at);
  }
  if (message.summarized === true) mergeMetadata(metadata, "summarized", true, at);
  else if (message.summarized !== false && message.summarized !== undefined) {
    throw unmappable(3, "summarized_not_boolean", { at });
  }
  if (text(metadata.injectedMessageType) && metadata.injectedMessage === undefined) {
    metadata.injectedMessage = true;
  }
}

function migrateV3Message(message, at, replaceProcessId) {
  assertV3MessageKeys(message, at);
  assertLcMirror(message, at);
  const { [V3_MESSAGE_IDENTITY_KEY]: sourceIdentity, ...rest } = isPlainObject(
    message.additional_kwargs,
  )
    ? message.additional_kwargs
    : {};
  const metadata = { ...rest };
  const sourceId = text(sourceIdentity);
  if (!sourceId) throw unmappable(3, "message_identity_missing", { at });
  mergeMetadata(metadata, "messageUid", replaceProcessId(sourceId), at);
  mergeV3Raw(metadata, message, sourceId, at);
  mergeV3Flags(metadata, message, at);
  const migrated = {
    type: message.type,
    content: message.content ?? "",
    additional_kwargs: metadata,
  };
  for (const key of ["tool_calls", "invalid_tool_calls", "tool_call_id", "response_metadata"]) {
    if (message[key] !== undefined) migrated[key] = message[key];
  }
  return migrated;
}

function createAssemblyIdReplacer() {
  const replaced = new Map();
  return (sourceId) => {
    if (!sourceId.startsWith("am_")) return sourceId;
    if (!replaced.has(sourceId)) replaced.set(sourceId, createMessageUid());
    return replaced.get(sourceId);
  };
}

function migrateSnapshotV3(snapshot) {
  if (!isPlainObject(snapshot?.messageBlocks)) throw unmappable(3, "message_blocks_missing");
  const replaceAssemblyId = createAssemblyIdReplacer();
  const messageBlocks = {};
  for (const block of SNAPSHOT_BLOCKS) {
    const messages = snapshot.messageBlocks[block];
    if (!Array.isArray(messages)) throw unmappable(3, "message_block_missing", { block });
    messageBlocks[block] = messages.map((message, index) =>
      migrateV3Message(message, `${block}[${index}]`, replaceAssemblyId),
    );
  }
  if (!sameJson(snapshot.messages, composeMessagesFromBlocks(snapshot.messageBlocks))) {
    throw unmappable(3, "messages_not_composed_from_blocks");
  }
  return {
    ...snapshot,
    version: 4,
    messageBlocks,
    messages: composeMessagesFromBlocks(messageBlocks),
    userMetaBackwrites: snapshot.userMetaBackwrites ?? [],
    turnProgress: snapshot.turnProgress ?? {},
  };
}

export const MODEL_CONTEXT_SNAPSHOT_VERSION_CHAIN = defineVersionChain({
  kind: MODEL_CONTEXT_SNAPSHOT_MIGRATION_KIND,
  currentVersion: SNAPSHOT_VERSION,
  readVersion: (snapshot) => snapshot?.version,
  steps: [{ from: 3, to: 4, migrate: migrateSnapshotV3 }],
});

export function migrateModelContextSnapshot(snapshot) {
  const result = runVersionChain(MODEL_CONTEXT_SNAPSHOT_VERSION_CHAIN, snapshot);
  try {
    hydrateModelContextSnapshot(result.document, result.document);
  } catch (error) {
    throw Object.assign(
      unmappable(result.fromVersion, "current_protocol_rejected", { message: error.message }),
      { cause: error },
    );
  }
  return result;
}
