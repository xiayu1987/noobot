/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  parseAttachmentDescriptor,
  parseAttachmentIdentity,
  attachmentIdentityKey,
} from "@noobot/attachment-protocol";
import { assertSemanticTransferRegistration } from "./registry.mjs";
export * from "./registry.mjs";

export const TRANSFER_PROTOCOL = "noobot.semantic-transfer";
export const TRANSFER_VERSION = 2;
export const TRANSFER_DIRECTION = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
});
export const TRANSFER_MODE = Object.freeze({
  DIRECT: "direct",
  ATTACHMENT: "attachment",
  SOURCE_REFERENCE: "source_reference",
});
export const TRANSFER_SOURCE = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  AGENT: "agent",
  SUBAGENT: "subagent",
  MODEL: "model",
  TOOL: "tool",
  PLUGIN: "plugin",
  SERVICE: "service",
  CONNECTOR: "connector",
});

const IDENTITY_KEYS = new Set([
  "sessionId",
  "turnScopeId",
  "runId",
  "producer",
]);
const PRODUCER_KEYS = new Set(["type", "id"]);
const INTENT_KEYS = new Set(["source", "reason", "scenario", "strategy", "category", "businessPoint"]);
const META_KEYS = new Set([
  "mimeType",
  "originalLength",
  "previewLength",
  "persisted",
  "attributes",
]);
const REF_KEYS = new Set([
  "identity",
  "role",
  "name",
  "mimeType",
  "size",
  "preview",
]);
const SOURCE_REFERENCE_KEYS = new Set(["address", "name", "mimeType", "size", "startLine", "endLine"]);
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

function plain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function required(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}
function normalizeSourceReferenceAddress(value) {
  if (typeof value === "string") return required(value, "invalid_source_reference_address");
  const identity = parseAttachmentIdentity(value);
  if (!identity) throw new Error("invalid_source_reference_address");
  return identity;
}
function known(value, keys, code) {
  for (const key of Object.keys(value))
    if (!keys.has(key)) throw new Error(`${code}:${key}`);
}
function clean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const v = value.map(clean).filter((x) => x !== undefined);
    return v.length ? v : undefined;
  }
  if (plain(value)) {
    const v = {};
    for (const [k, x] of Object.entries(value)) {
      const y = clean(x);
      if (y !== undefined) v[k] = y;
    }
    return Object.keys(v).length ? v : undefined;
  }
  return value;
}
function assertNoPaths(value, location = "envelope") {
  if (!plain(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    value.forEach((x, i) => assertNoPaths(x, `${location}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PATH_KEYS.has(key))
      throw new Error(`forbidden_path_field:${location}.${key}`);
    assertNoPaths(child, `${location}.${key}`);
  }
}

function normalizeMeta(meta = {}) {
  if (!plain(meta)) throw new Error("invalid_meta");
  assertNoPaths(meta, "meta");
  const normalized = {};
  const attributes = plain(meta.attributes) ? { ...meta.attributes } : {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === "attributes") continue;
    if (META_KEYS.has(key)) normalized[key] = value;
    else attributes[key] = value;
  }
  if (Object.keys(attributes).length) normalized.attributes = attributes;
  return clean(normalized) || {};
}

export function createTransferIdentity({
  sessionId,
  turnScopeId,
  runId,
  producer,
} = {}) {
  if (!plain(producer)) throw new Error("invalid_transfer_producer");
  known(producer, PRODUCER_KEYS, "unknown_transfer_producer_field");
  return Object.freeze({
    sessionId: required(sessionId, "invalid_transfer_session_id"),
    ...(turnScopeId === undefined
      ? {}
      : {
          turnScopeId: required(turnScopeId, "invalid_transfer_turn_scope_id"),
        }),
    ...(runId === undefined
      ? {}
      : { runId: required(runId, "invalid_transfer_run_id") }),
    producer: Object.freeze({
      type: required(producer.type, "invalid_transfer_producer_type"),
      id: required(producer.id, "invalid_transfer_producer_id"),
    }),
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
  messageId,
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
    messageId: required(messageId, "invalid_transfer_message_id"),
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
  return createTransferEnvelope({
    ...options,
    payload: {
      mode: TRANSFER_MODE.ATTACHMENT,
      attachments: (Array.isArray(attachments) ? attachments : []).map(
        createAttachmentReference,
      ),
    },
  });
}

export function sourceReferenceTransfer({ reference, ...options } = {}) {
  if (!plain(reference)) throw new Error("invalid_source_reference");
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

export function validateTransferEnvelope(value, { strict = false } = {}) {
  const errors = [];
  try {
    if (!plain(value)) throw new Error("envelope_not_object");
    assertNoPaths(value);
    known(
      value,
      new Set([
        "protocol",
        "version",
        "transferId",
        "messageId",
        "identity",
        "direction",
        "payload",
        "intent",
        "meta",
      ]),
      "unknown_envelope_field",
    );
    if (value.protocol !== TRANSFER_PROTOCOL)
      throw new Error("invalid_protocol");
    if (value.version !== TRANSFER_VERSION) throw new Error("invalid_version");
    required(value.transferId, "invalid_transfer_id");
    required(value.messageId, "invalid_message_id");
    createTransferIdentity(value.identity);
    if (!Object.values(TRANSFER_DIRECTION).includes(value.direction))
      throw new Error("invalid_direction");
    if (!plain(value.payload)) throw new Error("invalid_payload");
    known(
      value.payload,
      new Set(["mode", "content", "attachments", "reference"]),
      "unknown_payload_field",
    );
    if (value.payload.mode === TRANSFER_MODE.DIRECT) {
      if (typeof value.payload.content !== "string")
        throw new Error("direct_content_required");
      if (value.payload.attachments !== undefined)
        throw new Error("direct_attachments_forbidden");
    } else if (value.payload.mode === TRANSFER_MODE.ATTACHMENT) {
      if (
        !Array.isArray(value.payload.attachments) ||
        !value.payload.attachments.length
      )
        throw new Error("attachment_list_required");
      if (value.payload.content !== undefined)
        throw new Error("attachment_content_forbidden");
      value.payload.attachments.forEach((x) => {
        known(x, REF_KEYS, "unknown_attachment_field");
        createAttachmentReference(x);
      });
    } else if (value.payload.mode === TRANSFER_MODE.SOURCE_REFERENCE) {
      if (!plain(value.payload.reference)) throw new Error("source_reference_required");
      known(value.payload.reference, SOURCE_REFERENCE_KEYS, "unknown_source_reference_field");
      normalizeSourceReferenceAddress(value.payload.reference.address);
      if (value.payload.content !== undefined || value.payload.attachments !== undefined) {
        throw new Error("source_reference_payload_exclusive");
      }
    } else throw new Error("invalid_payload_mode");
    if (!plain(value.intent)) throw new Error("invalid_intent");
    known(value.intent, INTENT_KEYS, "unknown_intent_field");
    if (!plain(value.meta)) throw new Error("invalid_meta");
    known(value.meta, META_KEYS, "unknown_meta_field");
    if (value.meta.attributes !== undefined && !plain(value.meta.attributes))
      throw new Error("invalid_meta_attributes");
  } catch (error) {
    errors.push(error.message);
  }
  const result = { ok: errors.length === 0, errors };
  if (!result.ok && strict)
    throw new Error(`invalid_transfer_envelope:${errors.join(";")}`);
  return result;
}

export function assertTransferEnvelope(value) {
  validateTransferEnvelope(value, { strict: true });
  return value;
}
export function transferIdentityKey(value) {
  return `${required(value.transferId, "invalid_transfer_id")}:${required(value.messageId, "invalid_message_id")}`;
}
export { attachmentIdentityKey };
