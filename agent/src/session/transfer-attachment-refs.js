/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import {
  dedupeAttachmentsByIdentity,
  parseAttachmentRelations,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validatedEnvelopes(value) {
  const source = Array.isArray(value)
    ? value
    : isPlainObject(value) && Array.isArray(value.transferEnvelopes)
      ? value.transferEnvelopes
      : value
        ? [value]
        : [];
  const seen = new Set();
  return source.map(assertTransferEnvelope).filter((envelope) => {
    const key = `${envelope.transferId}:${envelope.messageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compactAttachmentRef(reference = {}) {
  if (!isPlainObject(reference) || !isPlainObject(reference.identity)) return null;
  const envelopeRef = {
    identity: reference.identity,
    ...(reference.role ? { role: reference.role } : {}),
    ...(reference.name ? { name: reference.name } : {}),
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    ...(reference.size === undefined ? {} : { size: reference.size }),
    ...(reference.preview === undefined ? {} : { preview: reference.preview }),
  };
  return envelopeRef;
}

export function compactSessionAttachmentRef(reference = {}) {
  if (!isPlainObject(reference)) return null;
  const identity = projectAttachmentIdentity(reference);
  const name = String(reference.name || "").trim();
  const mimeType = String(reference.mimeType || "").trim();
  if (!name || !mimeType) return null;
  const output = { ...identity, name, mimeType };
  for (const key of [
    "size", "relativePath", "sandboxPath", "path",
    "previewUrl", "downloadUrl", "isSandbox", "generationSource",
  ]) {
    if (reference[key] !== undefined && reference[key] !== null && reference[key] !== "") output[key] = reference[key];
  }
  const relations = parseAttachmentRelations(reference.relations);
  if (relations.length) output.relations = relations;
  if (isPlainObject(reference.owner)) {
    const type = String(reference.owner.type || "").trim();
    const id = String(reference.owner.id || "").trim();
    if (type || id) output.owner = { ...(type ? { type } : {}), ...(id ? { id } : {}) };
  }
  return output;
}

export function dedupeSessionAttachmentRefs(refs = []) {
  return dedupeAttachmentsByIdentity(
    (Array.isArray(refs) ? refs : []).map(compactSessionAttachmentRef).filter(Boolean),
  );
}

export function compactTransferEnvelope(envelope = {}) {
  const validated = validatedEnvelopes(envelope)[0];
  if (!validated) return null;
  const output = {
    protocol: validated.protocol,
    version: validated.version,
    transferId: validated.transferId,
    messageId: validated.messageId,
    identity: validated.identity,
    direction: validated.direction,
    payload: validated.payload,
    intent: validated.intent,
    meta: validated.meta,
  };
  if (output.payload.mode === "attachment") {
    output.payload = {
      mode: "attachment",
      attachments: output.payload.attachments.map(compactAttachmentRef),
    };
  }
  return output;
}

export function compactTransferEnvelopes(envelopes = []) {
  return validatedEnvelopes(envelopes).map((envelope) => compactTransferEnvelope(envelope));
}

export function collectAttachmentRefsFromTransferEnvelopes(envelopes = []) {
  return dedupeAttachmentsByIdentity(compactTransferEnvelopes(envelopes).flatMap((envelope) =>
    envelope.payload.mode === "attachment"
      ? envelope.payload.attachments
      : [],
  ), (reference) => reference.identity);
}

export function dedupeAttachmentRefs(refs = []) {
  return dedupeAttachmentsByIdentity(
    (Array.isArray(refs) ? refs : []).map(compactAttachmentRef).filter(Boolean),
    (reference) => reference.identity,
  );
}

export { compactAttachmentRef as compactRef };
