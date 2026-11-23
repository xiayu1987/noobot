/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AttachmentProtocolError,
  parseAttachmentDescriptor,
  parseAttachmentIdentity,
  attachmentIdentityKey,
  projectAttachmentIdentity,
  dedupeAttachmentsByIdentity,
  formatAttachmentIdentityRef,
} from "@noobot/attachment-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { assertSemanticTransferRegistration } from "./registry.js";
import { assertTransferIntentVocabulary } from "./policies/transfer-intent.js";
import { TransferEnvelopeInputError } from "./errors.js";
import {
  TRANSFER_PROTOCOL,
  TRANSFER_VERSION,
  TRANSFER_DIRECTION,
  TRANSFER_MODE,
  TRANSFER_ERROR_CODE,
} from "./constants.js";
export * from "./registry.js";
export * from "./policy.js";
export * from "./constants.js";
export { TransferEnvelopeInputError } from "./errors.js";
export * from "./vocabulary.js";
export * from "./policies/transfer-envelope-fields.js";
export * from "./policies/transfer-intent.js";
export * from "./policies/transfer-result.js";
export * from "./migrations.js";

const PRODUCER_KEYS = new Set(["type", "id"]);
const INTENT_KEYS = new Set([
  "source",
  "reason",
  "scenario",
  "strategy",
  "category",
  "businessPoint",
]);
const META_KEYS = new Set([
  "mimeType",
  "originalLength",
  "previewLength",
  "persisted",
  "attributes",
]);
const REF_KEYS = new Set(["identity", "role", "name", "mimeType", "size", "preview"]);
const SOURCE_REFERENCE_KEYS = new Set([
  "address",
  "name",
  "mimeType",
  "size",
  "startLine",
  "endLine",
  "totalLines",
]);
const FORBIDDEN_PATH_KEYS = new Set([
  "path",
  "filePath",
  "hostPath",
  "relativePath",
  "sandboxPath",
  "transferFilePath",
  "pathView",
  "attachmentMeta",
]);

function required(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new TransferEnvelopeInputError(code);
  return value.trim();
}
function normalizeSourceReferenceAddress(value) {
  if (typeof value === "string") return required(value, "invalid_source_reference_address");
  return parseAttachmentIdentity(value);
}
function known(value, keys, code) {
  for (const key of Object.keys(value))
    if (!keys.has(key)) throw new TransferEnvelopeInputError(`${code}:${key}`);
}
function clean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const v = value.map(clean).filter((x) => x !== undefined);
    return v.length ? v : undefined;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([k, x]) => [k, clean(x)])
      .filter(([, y]) => y !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}
function assertNoPaths(value, location = "envelope") {
  if (!isPlainObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    value.forEach((x, i) => assertNoPaths(x, `${location}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PATH_KEYS.has(key))
      throw new TransferEnvelopeInputError(`forbidden_path_field:${location}.${key}`);
    assertNoPaths(child, `${location}.${key}`);
  }
}

function normalizeMeta(meta = {}) {
  if (!isPlainObject(meta)) throw new TransferEnvelopeInputError("invalid_meta");
  assertNoPaths(meta, "meta");
  const normalized = {};
  const attributes = isPlainObject(meta.attributes) ? { ...meta.attributes } : {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === "attributes") continue;
    if (META_KEYS.has(key)) normalized[key] = value;
    else attributes[key] = value;
  }
  if (Object.keys(attributes).length) normalized.attributes = attributes;
  return clean(normalized) || {};
}

export function createTransferIdentity(value = {}) {
  if (!isPlainObject(value)) throw new TransferEnvelopeInputError("invalid_transfer_identity");
  const { sessionId, turnScopeId, runId, producer } = value;
  if (!isPlainObject(producer)) throw new TransferEnvelopeInputError("invalid_transfer_producer");
  known(producer, PRODUCER_KEYS, "unknown_transfer_producer_field");
  return Object.freeze({
    sessionId: required(sessionId, "invalid_transfer_session_id"),
    ...(turnScopeId === undefined
      ? {}
      : {
          turnScopeId: required(turnScopeId, "invalid_transfer_turn_scope_id"),
        }),
    ...(runId === undefined ? {} : { runId: required(runId, "invalid_transfer_run_id") }),
    producer: Object.freeze({
      type: required(producer.type, "invalid_transfer_producer_type"),
      id: required(producer.id, "invalid_transfer_producer_id"),
    }),
  });
}

export function createTransferPartIdentity(identity, partKey) {
  return Object.freeze({
    ...createTransferIdentity(identity),
    transferId: `${required(identity.transferId, "invalid_transfer_id")}:part:${encodeURIComponent(required(partKey, "invalid_transfer_part_key"))}`,
    presentationMessageId: required(
      identity.presentationMessageId,
      "invalid_presentation_message_id",
    ),
  });
}

export function createAttachmentReference({
  identity,
  role = "primary",
  name,
  mimeType = "text/plain",
  size,
  preview,
} = {}) {
  const descriptor = parseAttachmentDescriptor({
    identity,
    name,
    mimeType,
    ...(size === undefined ? {} : { size }),
  });
  const reference = {
    identity: descriptor.identity,
    role: required(role, "invalid_transfer_attachment_role"),
    name: descriptor.name,
    mimeType: descriptor.mimeType,
  };
  if (descriptor.size !== undefined) reference.size = descriptor.size;
  if (preview !== undefined) reference.preview = String(preview);
  known(reference, REF_KEYS, "unknown_transfer_attachment_field");
  return Object.freeze(reference);
}

export function createTransferEnvelope({
  transferId,
  presentationMessageId,
  identity,
  direction,
  payload,
  intent,
  meta = {},
} = {}) {
  assertSemanticTransferRegistration({
    scenario: intent?.scenario,
    strategy: intent?.strategy,
    category: intent?.category,
    businessPoint: intent?.businessPoint,
  });
  const envelope = Object.freeze({
    protocol: TRANSFER_PROTOCOL,
    version: TRANSFER_VERSION,
    transferId: required(transferId, "invalid_transfer_id"),
    presentationMessageId: required(
      presentationMessageId,
      "invalid_transfer_presentation_message_id",
    ),
    identity: createTransferIdentity(identity),
    direction: required(direction, "invalid_transfer_direction"),
    payload: clean(payload),
    intent: clean(intent),
    meta: normalizeMeta(meta),
  });
  validateTransferEnvelope(envelope, { strict: true });
  return envelope;
}

export function directTransfer({ content, ...options } = {}) {
  return createTransferEnvelope({
    ...options,
    payload: { mode: TRANSFER_MODE.DIRECT, content },
  });
}
export function attachmentTransfer({ attachments, ...options } = {}) {
  if (!Array.isArray(attachments)) throw new Error("invalid_attachment_transfer_attachments");
  return createTransferEnvelope({
    ...options,
    payload: {
      mode: TRANSFER_MODE.ATTACHMENT,
      attachments: attachments.map(createAttachmentReference),
    },
  });
}

export function sourceReferenceTransfer({ reference, ...options } = {}) {
  if (!isPlainObject(reference)) throw new Error("invalid_source_reference");
  known(reference, SOURCE_REFERENCE_KEYS, "unknown_source_reference_field");
  const address = normalizeSourceReferenceAddress(reference.address);
  return createTransferEnvelope({
    ...options,
    payload: {
      mode: TRANSFER_MODE.SOURCE_REFERENCE,
      reference: clean({ ...reference, address }),
    },
  });
}

function validateDirectPayload(payload) {
  if (typeof payload.content !== "string")
    throw new TransferEnvelopeInputError("direct_content_required");
  if (payload.attachments !== undefined)
    throw new TransferEnvelopeInputError("direct_attachments_forbidden");
}

function validateAttachmentPayload(payload) {
  if (!Array.isArray(payload.attachments) || !payload.attachments.length)
    throw new TransferEnvelopeInputError("attachment_list_required");
  if (payload.content !== undefined)
    throw new TransferEnvelopeInputError("attachment_content_forbidden");
  const { attachments } = payload;
  for (let index = 0; index < attachments.length; index += 1) {
    if (!Object.hasOwn(attachments, index))
      throw new TransferEnvelopeInputError("invalid_transfer_attachment");
    const x = attachments[index];
    if (!isPlainObject(x)) throw new TransferEnvelopeInputError("invalid_transfer_attachment");
    known(x, REF_KEYS, "unknown_attachment_field");
    createAttachmentReference(x);
  }
}

function validateSourceReferencePayload(payload) {
  if (!isPlainObject(payload.reference))
    throw new TransferEnvelopeInputError("source_reference_required");
  known(payload.reference, SOURCE_REFERENCE_KEYS, "unknown_source_reference_field");
  normalizeSourceReferenceAddress(payload.reference.address);
  if (payload.content !== undefined || payload.attachments !== undefined) {
    throw new TransferEnvelopeInputError("source_reference_payload_exclusive");
  }
}

const PAYLOAD_VALIDATORS = Object.freeze({
  [TRANSFER_MODE.DIRECT]: validateDirectPayload,
  [TRANSFER_MODE.ATTACHMENT]: validateAttachmentPayload,
  [TRANSFER_MODE.SOURCE_REFERENCE]: validateSourceReferencePayload,
});

export function validateTransferEnvelope(value, { strict = false } = {}) {
  try {
    if (!isPlainObject(value)) throw new TransferEnvelopeInputError("envelope_not_object");
    assertNoPaths(value);
    known(
      value,
      new Set([
        "protocol",
        "version",
        "transferId",
        "presentationMessageId",
        "identity",
        "direction",
        "payload",
        "intent",
        "meta",
      ]),
      "unknown_envelope_field",
    );
    if (value.protocol !== TRANSFER_PROTOCOL)
      throw new TransferEnvelopeInputError("invalid_protocol");
    if (value.version !== TRANSFER_VERSION) throw new TransferEnvelopeInputError("invalid_version");
    required(value.transferId, "invalid_transfer_id");
    required(value.presentationMessageId, "invalid_presentation_message_id");
    createTransferIdentity(value.identity);
    if (!Object.values(TRANSFER_DIRECTION).includes(value.direction))
      throw new TransferEnvelopeInputError("invalid_direction");
    if (!isPlainObject(value.payload)) throw new TransferEnvelopeInputError("invalid_payload");
    known(
      value.payload,
      new Set(["mode", "content", "attachments", "reference"]),
      "unknown_payload_field",
    );
    if (
      typeof value.payload.mode !== "string" ||
      !Object.hasOwn(PAYLOAD_VALIDATORS, value.payload.mode)
    )
      throw new TransferEnvelopeInputError("invalid_payload_mode");
    PAYLOAD_VALIDATORS[value.payload.mode](value.payload);
    if (!isPlainObject(value.intent)) throw new TransferEnvelopeInputError("invalid_intent");
    known(value.intent, INTENT_KEYS, "unknown_intent_field");
    assertTransferIntentVocabulary({
      source: value.intent.source,
      reason: value.intent.reason,
    });
    assertSemanticTransferRegistration({
      scenario: value.intent.scenario,
      strategy: value.intent.strategy,
      category: value.intent.category,
      businessPoint: value.intent.businessPoint,
    });
    if (!isPlainObject(value.meta)) throw new TransferEnvelopeInputError("invalid_meta");
    known(value.meta, META_KEYS, "unknown_meta_field");
    if (value.meta.attributes !== undefined && !isPlainObject(value.meta.attributes))
      throw new TransferEnvelopeInputError("invalid_meta_attributes");
  } catch (error) {
    if (!(error instanceof TransferEnvelopeInputError || error instanceof AttachmentProtocolError))
      throw error;
    if (strict)
      throw new TransferEnvelopeInputError(`invalid_transfer_envelope:${error.message}`, {
        cause: error,
      });
    return { ok: false, errors: [error.message] };
  }
  return { ok: true, errors: [] };
}

export function assertTransferEnvelope(value) {
  validateTransferEnvelope(value, { strict: true });
  return value;
}
export function transferIdentityKey(value) {
  return JSON.stringify([
    required(value.transferId, "invalid_transfer_id"),
    required(value.presentationMessageId, "invalid_presentation_message_id"),
  ]);
}

function collectTransferEnvelopeCandidates(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableProtocolValue(value) {
  if (Array.isArray(value)) return value.map(stableProtocolValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableProtocolValue(value[key])]),
  );
}

export function transferProtocolValueKey(value) {
  return JSON.stringify(stableProtocolValue(value));
}

function identityConflictError(code, identityKey) {
  const error = new Error(`${code}:${identityKey}`);
  error.code = code;
  return error;
}

export function isTransferIdentityConflict(error) {
  return (
    error?.code === TRANSFER_ERROR_CODE.IDENTITY_CONFLICT ||
    error?.code === TRANSFER_ERROR_CODE.ATTACHMENT_IDENTITY_CONFLICT
  );
}

function dedupeByIdentity(items, identityKeyOf, conflictCode) {
  const result = [];
  const identities = new Map();
  for (const item of items) {
    const identityKey = identityKeyOf(item);
    const existing = identities.get(identityKey);
    if (existing === undefined) {
      identities.set(identityKey, item);
      result.push(item);
    } else if (
      existing !== item &&
      transferProtocolValueKey(existing) !== transferProtocolValueKey(item)
    ) {
      throw identityConflictError(conflictCode, identityKey);
    }
  }
  return Object.freeze(result);
}

export function mergeTransferEnvelopes(...values) {
  const envelopes = values
    .flatMap(collectTransferEnvelopeCandidates)
    .map((candidate) => assertTransferEnvelope(candidate));
  return dedupeByIdentity(envelopes, transferIdentityKey, TRANSFER_ERROR_CODE.IDENTITY_CONFLICT);
}

export function normalizeTransferEnvelopes(value = null) {
  return mergeTransferEnvelopes(value);
}

export function getTransferAttachmentReferences(value = null) {
  const references = normalizeTransferEnvelopes(value)
    .filter((envelope) => envelope.payload.mode === TRANSFER_MODE.ATTACHMENT)
    .flatMap((envelope) => envelope.payload.attachments);
  return dedupeByIdentity(
    references,
    (reference) => attachmentIdentityKey(reference.identity),
    TRANSFER_ERROR_CODE.ATTACHMENT_IDENTITY_CONFLICT,
  );
}

export function getTransferSourceReferences(value = null) {
  return Object.freeze(
    normalizeTransferEnvelopes(value)
      .filter((envelope) => envelope.payload.mode === TRANSFER_MODE.SOURCE_REFERENCE)
      .map((envelope) => envelope.payload.reference),
  );
}

export function projectTransferEnvelopesForModel(value) {
  return normalizeTransferEnvelopes(value).map(({ direction, payload, intent }) => {
    const transfer = { direction, reason: intent.reason, mode: payload.mode };
    if (payload.mode === TRANSFER_MODE.ATTACHMENT) {
      transfer.attachments = payload.attachments.map(({ identity, ...descriptor }) => ({
        attachmentRef: formatAttachmentIdentityRef(identity),
        ...descriptor,
      }));
    } else if (payload.mode === TRANSFER_MODE.SOURCE_REFERENCE) {
      const { address, ...descriptor } = payload.reference;
      transfer.reference = {
        ...(typeof address === "string"
          ? { filePath: address }
          : { attachmentRef: formatAttachmentIdentityRef(address) }),
        ...descriptor,
      };
    } else {
      transfer.content = payload.content;
    }
    return transfer;
  });
}
export function selectUntransferredAttachments(attachments, envelopes) {
  const transferred = new Set(
    normalizeTransferEnvelopes(envelopes).flatMap((envelope) =>
      envelope.payload.mode === "attachment"
        ? envelope.payload.attachments.map((item) => attachmentIdentityKey(item.identity))
        : [],
    ),
  );
  return dedupeAttachmentsByIdentity(attachments).filter(
    (attachment) => !transferred.has(attachmentIdentityKey(projectAttachmentIdentity(attachment))),
  );
}

export { attachmentIdentityKey };
