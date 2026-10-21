/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isPlainObject, isObjectLike } from "@noobot/shared/value";
import { Buffer } from "node:buffer";
import {
  createAttachmentReference,
  createTransferEnvelope,
  DEFAULT_TRANSFER_MIME_TYPE,
  directTransfer,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { resolveRuntimeUserId } from "../../context/agent-context-accessor.js";

function requireIdentity(identity = {}) {
  if (!isPlainObject(identity)) {
    throw new Error("semantic_transfer_identity_required");
  }
  for (const key of ["transferId", "presentationMessageId", "sessionId", "turnScopeId", "runId"]) {
    if (!safeStr(identity[key])) throw new Error(`semantic_transfer_${key}_required`);
  }
  if (!isObjectLike(identity.producer)) {
    throw new Error("semantic_transfer_producer_required");
  }
  if (!safeStr(identity.producer.type) || !safeStr(identity.producer.id)) {
    throw new Error("semantic_transfer_producer_identity_required");
  }
  return {
    transferId: safeStr(identity.transferId),
    presentationMessageId: safeStr(identity.presentationMessageId),
    identity: {
      sessionId: safeStr(identity.sessionId),
      turnScopeId: safeStr(identity.turnScopeId),
      runId: safeStr(identity.runId),
      producer: { type: safeStr(identity.producer.type), id: safeStr(identity.producer.id) },
    },
  };
}

function encodeContentBase64({
  content = "",
  encodedContent = "",
  bytes = null,
  contentEncoding = "utf8",
} = {}) {
  if (safeStr(encodedContent)) return safeStr(encodedContent);
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  if (bytes instanceof Uint8Array) return Buffer.from(bytes).toString("base64");
  if (Array.isArray(bytes)) return Buffer.from(bytes).toString("base64");
  const value = String(content ?? "");
  return contentEncoding === "base64" ? value : Buffer.from(value, "utf8").toString("base64");
}

function serviceFrom(runtime) {
  const service = runtime?.attachmentService;
  if (!isFunction(service?.ingestGeneratedArtifacts)) {
    throw new Error("semantic_transfer_attachment_service_required");
  }
  return service;
}

function resolveAttachmentUserId(runtime = {}) {
  const resolved = resolveRuntimeUserId(runtime);
  if (!resolved) throw new Error("semantic_transfer_user_id_required");
  return resolved;
}

function recordIdentity(record = {}, sessionId = "") {
  const identity = {
    attachmentId: safeStr(record.attachmentId),
    sessionId: safeStr(record.sessionId || sessionId),
    attachmentSource: safeStr(record.attachmentSource),
  };
  if (!identity.attachmentId || !identity.sessionId || !identity.attachmentSource) {
    throw new Error("semantic_transfer_attachment_identity_missing");
  }
  return identity;
}

export function createDirectTransferEnvelope({
  identity,
  direction = TRANSFER_DIRECTION.OUTPUT,
  content,
  intent = {},
  meta = {},
} = {}) {
  const ids = requireIdentity(identity);
  return directTransfer({ ...ids, direction, content: String(content ?? ""), intent, meta });
}

export async function persistTransferArtifacts({
  runtime = {},
  artifacts = [],
  attachmentSource = "model",
  generationSource = "semantic_transfer_output",
  source = "service",
  reason = "semantic_transfer_output",
  identity,
  direction = TRANSFER_DIRECTION.OUTPUT,
  intent = null,
  meta = {},
} = {}) {
  const ids = requireIdentity(identity);
  const resolvedUserId = resolveAttachmentUserId(runtime);
  if (!Array.isArray(artifacts) || artifacts.length === 0)
    throw new Error("semantic_transfer_artifacts_required");
  const service = serviceFrom(runtime);
  const records = await service.ingestGeneratedArtifacts({
    userId: resolvedUserId,
    sessionId: ids.identity.sessionId,
    attachmentSource: safeStr(attachmentSource) || "model",
    generationSource: safeStr(generationSource) || "semantic_transfer_output",
    turnScope: {
      sessionId: ids.identity.sessionId,
      turnScopeId: ids.identity.turnScopeId,
    },
    turnScopeId: ids.identity.turnScopeId,
    artifacts,
  });
  if (!Array.isArray(records) || records.length !== artifacts.length) {
    throw new Error(
      `semantic_transfer_attachment_cardinality_mismatch:${artifacts.length}:${Array.isArray(records) ? records.length : 0}`,
    );
  }
  const attachments = records.map((record, index) =>
    createAttachmentReference({
      identity: recordIdentity(record, ids.identity.sessionId),
      role: index === 0 ? "primary" : "secondary",
      name: safeStr(record.name) || `attachment-${index + 1}`,
      mimeType: safeStr(record.mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
      size: Number.isSafeInteger(record.size) && record.size >= 0 ? record.size : undefined,
    }),
  );
  const envelope = createTransferEnvelope({
    ...ids,
    direction,
    payload: { mode: "attachment", attachments },
    intent: intent || { source, reason },
    meta: {
      ...meta,
      persisted: true,
      originalLength: artifacts.reduce(
        (sum, item) => sum + Buffer.from(encodeContentBase64(item), "base64").length,
        0,
      ),
    },
  });
  return { transferEnvelopes: [envelope] };
}

export async function persistTransferFile({
  runtime = {},
  content = "",
  contentBase64: encodedContent = "",
  bytes = null,
  contentEncoding = "utf8",
  name = "output.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_output",
  source = "service",
  reason = "semantic_transfer_output",
  identity,
  direction = TRANSFER_DIRECTION.OUTPUT,
  intent = null,
  meta = {},
} = {}) {
  const encoded = encodeContentBase64({ content, encodedContent, bytes, contentEncoding });
  if (!encoded) throw new Error("semantic_transfer_content_required");
  return persistTransferArtifacts({
    runtime,
    identity,
    direction,
    attachmentSource,
    generationSource,
    source,
    reason,
    intent,
    meta,
    artifacts: [
      {
        name: safeStr(name) || "output.txt",
        mimeType: safeStr(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
        contentBase64: encoded,
      },
    ],
  });
}
