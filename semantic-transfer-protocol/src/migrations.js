/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { TRANSFER_ENVELOPE_V2, TRANSFER_PROTOCOL, TRANSFER_VERSION } from "./constants.js";

function migrationError(code, envelope) {
  const error = new Error(`semantic_transfer_migration:${code}`);
  error.code = "SEMANTIC_TRANSFER_MIGRATION_INVALID";
  error.details = { transferId: envelope?.transferId, version: envelope?.version };
  return error;
}

function upgradeV2ToV3(envelope) {
  if (Object.hasOwn(envelope, "presentationMessageId")) {
    throw migrationError("v2_has_presentation_message_id", envelope);
  }
  const { [TRANSFER_ENVELOPE_V2.presentationField]: presentationMessageId, ...rest } = envelope;
  if (
    typeof presentationMessageId !== "string" ||
    !presentationMessageId.startsWith(TRANSFER_ENVELOPE_V2.presentationPrefix)
  ) {
    throw migrationError("v2_message_id_not_presentation_id", envelope);
  }
  return { ...rest, version: TRANSFER_VERSION, presentationMessageId };
}

export function isTransferEnvelopeCandidate(value) {
  return isPlainObject(value) && value.protocol === TRANSFER_PROTOCOL;
}

export function upgradeTransferEnvelope(envelope) {
  if (!isTransferEnvelopeCandidate(envelope)) {
    throw migrationError("not_transfer_envelope", envelope);
  }
  if (envelope.version === TRANSFER_VERSION) return envelope;
  if (envelope.version === TRANSFER_ENVELOPE_V2.version) return upgradeV2ToV3(envelope);
  throw migrationError("unsupported_version", envelope);
}

export function upgradeTransferEnvelopesInValue(value) {
  if (Array.isArray(value)) {
    let upgraded = 0;
    const next = value.map((item) => {
      const result = upgradeTransferEnvelopesInValue(item);
      upgraded += result.upgraded;
      return result.value;
    });
    return upgraded ? { value: next, upgraded } : { value, upgraded: 0 };
  }
  if (!isPlainObject(value)) return { value, upgraded: 0 };
  if (isTransferEnvelopeCandidate(value)) {
    const next = upgradeTransferEnvelope(value);
    return next === value ? { value, upgraded: 0 } : { value: next, upgraded: 1 };
  }
  let upgraded = 0;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const result = upgradeTransferEnvelopesInValue(item);
    upgraded += result.upgraded;
    next[key] = result.value;
  }
  return upgraded ? { value: next, upgraded } : { value, upgraded: 0 };
}

export const TRANSFER_DOCUMENT_FORMAT = Object.freeze({
  JSON: "json",
  JSONL: "jsonl",
});

export function upgradeTransferEnvelopesInDocumentText({ text, format } = {}) {
  const source = String(text ?? "");
  if (format === TRANSFER_DOCUMENT_FORMAT.JSON) {
    const result = upgradeTransferEnvelopesInValue(JSON.parse(source));
    if (!result.upgraded) return { text: null, upgraded: 0 };
    return { text: `${JSON.stringify(result.value, null, 2)}\n`, upgraded: result.upgraded };
  }
  if (format === TRANSFER_DOCUMENT_FORMAT.JSONL) {
    let upgraded = 0;
    const lines = source.split("\n").map((line) => {
      if (!line.trim()) return line;
      const result = upgradeTransferEnvelopesInValue(JSON.parse(line));
      upgraded += result.upgraded;
      return result.upgraded ? JSON.stringify(result.value) : line;
    });
    return upgraded ? { text: lines.join("\n"), upgraded } : { text: null, upgraded: 0 };
  }
  throw new TypeError(`unsupported transfer document format: ${format}`);
}
