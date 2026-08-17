/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import {
  attachmentTransfer,
  createAttachmentReference,
  createTransferEnvelope,
  directTransfer,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";
import { AttachmentService } from "../../artifacts/service/attachment-service.js";
import { DEFAULT_TRANSFER_MIME_TYPE } from "../core/constants.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function requireIdentity(identity = {}) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("semantic_transfer_identity_required");
  }
  for (const key of ["transferId", "messageId", "sessionId", "turnScopeId", "runId"]) {
    if (!text(identity[key])) throw new Error(`semantic_transfer_${key}_required`);
  }
  if (!identity.producer || typeof identity.producer !== "object") {
    throw new Error("semantic_transfer_producer_required");
  }
  if (!text(identity.producer.type) || !text(identity.producer.id)) {
    throw new Error("semantic_transfer_producer_identity_required");
  }
  return {
    transferId: text(identity.transferId),
    messageId: text(identity.messageId),
    identity: {
      sessionId: text(identity.sessionId),
      turnScopeId: text(identity.turnScopeId),
      runId: text(identity.runId),
      producer: { type: text(identity.producer.type), id: text(identity.producer.id) },
    },
  };
}

function encodeContentBase64({
  content = "",
  encodedContent = "",
  bytes = null,
  contentEncoding = "utf8",
} = {}) {
  if (text(encodedContent)) return text(encodedContent);
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  if (bytes instanceof Uint8Array) return Buffer.from(bytes).toString("base64");
  if (Array.isArray(bytes)) return Buffer.from(bytes).toString("base64");
  const value = String(content ?? "");
  return contentEncoding === "base64" ? value : Buffer.from(value, "utf8").toString("base64");
}

function serviceFrom(runtime, attachmentService) {
  const service = attachmentService || runtime?.attachmentService;
  if (service && typeof service.ingestGeneratedArtifacts === "function") return service;
  const config = runtime?.globalConfig;
  if (config && typeof config === "object") return new AttachmentService(config);
  throw new Error("semantic_transfer_attachment_service_required");
}

function resolveAttachmentUserId({ runtime = {}, agentContext = null, userId = "" } = {}) {
  const resolved = text(
    runtime?.userId || runtime?.systemRuntime?.userId || agentContext?.userId || userId,
  );
  if (!resolved) throw new Error("semantic_transfer_user_id_required");
  return resolved;
}

function recordIdentity(record = {}, sessionId = "") {
  const identity = {
    attachmentId: text(record.attachmentId),
    sessionId: text(record.sessionId || sessionId),
    attachmentSource: text(record.attachmentSource),
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
  agentContext = null,
  attachmentService = null,
  userId = "",
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
  const resolvedUserId = resolveAttachmentUserId({ runtime, agentContext, userId });
  if (!Array.isArray(artifacts) || artifacts.length === 0)
    throw new Error("semantic_transfer_artifacts_required");
  const service = serviceFrom(runtime, attachmentService);
  const records = await service.ingestGeneratedArtifacts({
    userId: resolvedUserId,
    sessionId: ids.identity.sessionId,
    attachmentSource: text(attachmentSource) || "model",
    generationSource: text(generationSource) || "semantic_transfer_output",
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
      name: text(record.name) || `attachment-${index + 1}`,
      mimeType: text(record.mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
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
  agentContext = null,
  attachmentService = null,
  userId = "",
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
    agentContext,
    attachmentService,
    userId,
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
        name: text(name) || "output.txt",
        mimeType: text(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
        contentBase64: encoded,
      },
    ],
  });
}

export { requireIdentity };
