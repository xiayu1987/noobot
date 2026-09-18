/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isTransferEnvelopeField,
  TRANSFER_MODE,
  TRANSFER_PROTOCOL,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  TRANSFER_VERSION,
  transferIdentityKey,
} from "@noobot/semantic-transfer-protocol";

const HISTORICAL_MULTIMODAL_PARSE_REASON = "multimodal_parse_tool";
const MULTIMODAL_PARSE_TOOL_NAME = "multimodal_parse";
const MULTIMODAL_PARSE_REASON_MIGRATION = "semantic-transfer-multimodal-parse-reason-v1";

function text(value) {
  return String(value || "").trim();
}

function isHistoricalMultimodalParseEnvelope(envelope) {
  const candidate = Object(envelope);
  const identity = Object(candidate.identity);
  const producer = Object(identity.producer);
  const payload = Object(candidate.payload);
  const intent = Object(candidate.intent);
  return [
    candidate.protocol === TRANSFER_PROTOCOL,
    candidate.version === TRANSFER_VERSION,
    text(candidate.transferId),
    text(candidate.messageId),
    producer.type === "tool",
    text(producer.id),
    payload.mode === TRANSFER_MODE.ATTACHMENT,
    intent.source === TRANSFER_SOURCE.TOOL,
    intent.reason === HISTORICAL_MULTIMODAL_PARSE_REASON,
    intent.scenario === "tool",
    intent.strategy === "tool_result_text",
  ].every(Boolean);
}

function visitTransferCollections(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitTransferCollections(item, visitor);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isTransferEnvelopeField(key) && Array.isArray(child)) {
      for (const envelope of child) visitor(envelope);
      continue;
    }
    visitTransferCollections(child, visitor);
  }
}

function verifiedMultimodalParseTransferIdentities(messages = []) {
  const identities = new Set();
  for (const message of messages) {
    if (
      message?.role !== "tool" ||
      text(message?.toolName) !== MULTIMODAL_PARSE_TOOL_NAME ||
      !text(message?.tool_call_id)
    ) {
      continue;
    }
    visitTransferCollections(message, (envelope) => {
      if (
        isHistoricalMultimodalParseEnvelope(envelope) &&
        text(envelope.identity.producer.id) === text(message.tool_call_id)
      ) {
        identities.add(transferIdentityKey(envelope));
      }
    });
  }
  return identities;
}

export function createSemanticTransferMigration(document) {
  const messages = [
    ...(Array.isArray(document?.messages) ? document.messages : []),
    ...(document?.message &&
    typeof document.message === "object" &&
    !Array.isArray(document.message)
      ? [document.message]
      : []),
  ];
  return {
    verifiedIdentities: verifiedMultimodalParseTransferIdentities(messages),
    migrated: 0,
  };
}

export function migrateSemanticTransfers(value, migration) {
  let migrated = 0;
  visitTransferCollections(value, (envelope) => {
    if (
      isHistoricalMultimodalParseEnvelope(envelope) &&
      migration.verifiedIdentities.has(transferIdentityKey(envelope))
    ) {
      envelope.intent.reason = TRANSFER_REASON.MULTIMODAL_PARSE_ARTIFACT;
      migrated += 1;
    }
  });
  migration.migrated += migrated;
  return migrated > 0;
}

export function completedSemanticTransferMigrationNames(migration) {
  return migration.migrated > 0 ? [MULTIMODAL_PARSE_REASON_MIGRATION] : [];
}
